<script lang="ts">
  import '@shared/tokens.css'
  import type { ContentEvent } from '@shared/messages'
  import type { Settings, Transform, TransformRuntimeState } from '@shared/types'
  import { activeTab, BackgroundError, send } from './lib/messaging'
  import { Flow } from './lib/flow.svelte'
  import Describing from './components/Describing.svelte'
  import ErrorCard from './components/ErrorCard.svelte'
  import Generating from './components/Generating.svelte'
  import Picking from './components/Picking.svelte'
  import Refining from './components/Refining.svelte'
  import Reviewing from './components/Reviewing.svelte'
  import Saving from './components/Saving.svelte'
  import TransformRow from './components/TransformRow.svelte'

  let settings = $state<Settings | null>(null)
  let transforms = $state<Transform[]>([])
  let runtimeStates = $state<TransformRuntimeState[]>([])
  let url = $state('')
  let expandedId = $state<string | null>(null)
  let loadError = $state<{ message: string; retryable: boolean } | null>(null)

  const flow = new Flow(() => void refresh())

  let host = $derived.by(() => {
    try {
      return new URL(url).hostname
    } catch {
      return ''
    }
  })

  let activeCount = $derived(transforms.filter((t) => t.enabled).length)
  let brokenCount = $derived(runtimeStates.filter((s) => s.status === 'broken').length)

  let providerLabel = $derived(
    settings?.providers.find((p) => p.id === settings?.activeProviderId)?.label ??
      'the provider',
  )

  /** Rough, and labelled as such in the panel — it is a progress hint. */
  let contextSize = $derived(
    flow.picked ? JSON.stringify(flow.picked.context).length : 0,
  )

  function stateFor(id: string): TransformRuntimeState | undefined {
    return runtimeStates.find((s) => s.id === id)
  }

  async function refresh() {
    if (!url) return
    transforms = await send<Transform[]>({ type: 'get-transforms-for-url', url })
  }

  async function load() {
    loadError = null
    try {
      settings = await send<Settings>({ type: 'get-settings' })
      // Accent is a user setting; tokens.css keys the palette off this.
      document.documentElement.dataset['accent'] = settings.accent

      const tab = await activeTab()
      url = tab?.url ?? ''
      flow.bindTab(tab?.id, url)
      await refresh()
    } catch (cause) {
      loadError =
        cause instanceof BackgroundError
          ? { message: cause.message, retryable: cause.retryable }
          : { message: String(cause), retryable: false }
    }
  }

  async function setEnabled(transform: Transform, enabled: boolean) {
    await send({ type: 'set-enabled', id: transform.id, enabled })
    transforms = transforms.map((t) => (t.id === transform.id ? { ...t, enabled } : t))
  }

  function openSettings() {
    void browser.runtime.openOptionsPage()
  }

  $effect(() => {
    void load()

    const onMessage = (message: ContentEvent) => {
      flow.receive(message)
    }
    browser.runtime.onMessage.addListener(onMessage)

    // Held open for the lifetime of the panel. The background watches for it
    // to drop, which is how "closing this panel discards it" is kept true —
    // a closed sidebar gets no chance to run cleanup of its own.
    const port = browser.runtime.connect({ name: 'wa-sidebar' })

    return () => {
      browser.runtime.onMessage.removeListener(onMessage)
      port.disconnect()
    }
  })
</script>

<div class="panel">
  {#if loadError}
    <div class="load-error" role="alert">
      <p>{loadError.message}</p>
      <div class="load-actions">
        {#if loadError.retryable}
          <button type="button" onclick={load}>Try again</button>
        {/if}
        <button type="button" onclick={openSettings}>Settings</button>
      </div>
    </div>
  {/if}

  {#if flow.error}
    <ErrorCard
      error={flow.error}
      onretry={() => void flow.retry()}
      onsettings={openSettings}
      ondismiss={() => flow.dismissError()}
    />
  {/if}

  {#if flow.step === 'picking'}
    <Picking hover={flow.hover} oncancel={() => void flow.cancelPicking()} />
  {:else if flow.step === 'describing' && flow.picked}
    <Describing
      target={flow.picked.target}
      crop={flow.picked.crop}
      cropClipped={flow.picked.cropClipped}
      instruction={flow.instruction}
      sendScreenshot={flow.sendScreenshot}
      visionSupported={flow.visionSupported}
      {providerLabel}
      onchange={(value) => (flow.instruction = value)}
      onscreenshot={(value) => (flow.sendScreenshot = value)}
      onrepick={() => void flow.startPicking()}
      ongenerate={() => void flow.generate()}
    />
  {:else if flow.step === 'generating'}
    <Generating
      stage={flow.stage}
      reached={(stage) => flow.stageReached(stage)}
      elapsed={flow.elapsed}
      kind={flow.result?.kind ?? null}
      code={flow.result?.code ?? ''}
      withScreenshot={flow.sendScreenshot}
      {contextSize}
      oncancel={() => void flow.discard()}
    />
  {:else if flow.step === 'refining' && flow.result}
    <Refining
      result={flow.result}
      analysis={flow.analysis}
      intent={flow.instruction}
      history={flow.history}
      followUp={flow.followUp}
      jsRan={flow.jsRan}
      onfollowup={(value) => (flow.followUp = value)}
      onregenerate={() => void flow.regenerate()}
      onrun={() => void flow.runJs()}
      onreload={() => void flow.reloadAndRetry()}
      ondiscard={() => void flow.discard()}
      onkeep={() => flow.toSaving()}
    />
  {:else if flow.step === 'saving' && flow.result}
    <Saving
      result={flow.result}
      intent={flow.intent}
      consolidated={flow.history.length > 0}
      presets={flow.matchPresets}
      match={flow.matchPattern}
      onintent={(value) => (flow.intent = value)}
      onmatch={(value) => (flow.matchPattern = value)}
      oncontinue={() => void flow.toReview()}
    />
  {:else if flow.step === 'reviewing' && flow.result}
    <Reviewing
      result={flow.result}
      review={flow.review}
      intent={flow.intent}
      onrefuse={() => void flow.refuseCapabilities()}
      onsave={() => void flow.save()}
      onback={() => flow.toSaving()}
    />
  {:else if transforms.length === 0}
    <div class="empty">
      <div class="diagram" aria-hidden="true">
        <span class="bar"></span>
        <span class="bar mid"></span>
        <span class="bar target"></span>
      </div>
      <h1>Point at something on this page and say what you want changed.</h1>
      <p>
        An AI writes the CSS or JavaScript. It is saved for {host || 'this site'} and
        applied on every visit. You approve the code before it runs.
      </p>
      <div class="cta">
        <button type="button" class="primary" onclick={() => void flow.startPicking()}>
          Select an element
        </button>
        <p class="hint">Or drag a rectangle on the page</p>
      </div>
    </div>
    <footer class="idle-foot">
      <span>{host}</span>
      <button type="button" class="link" onclick={openSettings}>Settings</button>
    </footer>
  {:else}
    <header class="site">
      <span class="site-dot" aria-hidden="true"></span>
      <span class="host">{host}</span>
      <span class="count">{activeCount} active</span>
    </header>

    {#if brokenCount > 0}
      <p class="broken-banner">
        {brokenCount}
        {brokenCount === 1 ? 'transform' : 'transforms'} stopped working
      </p>
    {/if}

    <ul class="rows">
      {#each transforms as transform (transform.id)}
        <TransformRow
          {transform}
          state={stateFor(transform.id)}
          expanded={expandedId === transform.id}
          ontoggle={(enabled) => void setEnabled(transform, enabled)}
          onexpand={() =>
            (expandedId = expandedId === transform.id ? null : transform.id)}
          onrepair={() => {}}
          onedit={() => {}}
        />
      {/each}
    </ul>

    <footer>
      <button type="button" class="primary" onclick={() => void flow.startPicking()}>
        Select an element
      </button>
      <p class="hint">Order decides conflicts — later wins</p>
    </footer>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--surface);
    color: var(--text);
  }

  .site {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 12px var(--gutter-sidebar) 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .site-dot {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: var(--neutral);
  }

  .host {
    font: 12.5px var(--font-ui);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    margin-left: auto;
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  .broken-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-6);
    margin: 0;
    padding: 9px var(--gutter-sidebar);
    border-bottom: 1px solid var(--border-subtle);
    background: rgb(from var(--attention) r g b / 0.09);
    font: 11px/1.5 var(--font-ui);
    color: var(--attention);
  }

  .rows {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
  }

  footer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: auto;
    padding: 11px var(--gutter-sidebar);
    border-top: 1px solid var(--border-subtle);
  }

  .idle-foot {
    flex-direction: row;
    justify-content: space-between;
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  .empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: var(--sp-16);
    padding: var(--sp-20) 18px;
  }

  /* A page, and the part you point at. */
  .diagram {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-5);
    height: 40px;
  }

  .bar {
    width: 52px;
    height: 9px;
    border-radius: var(--r-progress);
    background: var(--border);
  }

  .bar.mid {
    width: 30px;
    height: 26px;
  }

  .bar.target {
    width: 14px;
    height: 26px;
    border: 1.5px dashed var(--attention);
    background: rgb(from var(--attention) r g b / 0.14);
  }

  h1 {
    margin: 0;
    font: 600 14.5px/1.4 var(--font-ui);
  }

  .empty p {
    margin: 0;
    font: 12.5px/1.6 var(--font-ui);
    color: var(--text-dim);
  }

  .cta {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
  }

  .hint {
    font: 11px/1.5 var(--font-ui) !important;
    color: var(--text-faint) !important;
    text-align: center;
  }

  .load-error {
    padding: 11px var(--gutter-sidebar);
    border-bottom: 1px solid rgb(from var(--block) r g b / 0.4);
    background: rgb(from var(--block) r g b / 0.09);
  }

  .load-error p {
    margin: 0 0 7px;
    font: 12.5px/1.55 var(--font-ui);
  }

  .load-actions {
    display: flex;
    gap: 6px;
  }

  .load-actions button {
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-button);
    background: transparent;
    font: 600 11.5px var(--font-ui);
    color: var(--text);
    cursor: pointer;
  }

  button.primary {
    width: 100%;
    padding: 9px 10px;
    border: none;
    border-radius: var(--r-button);
    background: var(--accent);
    font: 600 12.5px var(--font-ui);
    color: var(--accent-text);
    cursor: pointer;
  }

  button.link {
    padding: 0;
    border: none;
    background: none;
    font: 11px var(--font-ui);
    color: var(--text-faint);
    cursor: pointer;
  }
</style>
