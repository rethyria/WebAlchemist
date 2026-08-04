<script lang="ts">
  import '@shared/tokens.css'
  import type { ContentEvent } from '@shared/messages'
  import { originPermissionFor } from '@shared/match'
  import type {
    CredentialStatus,
    Settings,
    Transform,
    TransformRuntimeState,
  } from '@shared/types'
  import { activeTab, BackgroundError, send } from './lib/messaging.svelte'
  import { Flow } from './lib/flow.svelte'
  import Describing from './components/Describing.svelte'
  import ErrorCard from './components/ErrorCard.svelte'
  import Generating from './components/Generating.svelte'
  import Picking from './components/Picking.svelte'
  import Refining from './components/Refining.svelte'
  import Reviewing from './components/Reviewing.svelte'
  import Saving from './components/Saving.svelte'
  import SettingsPanel from './components/Settings.svelte'
  import TransformRow from './components/TransformRow.svelte'

  let settings = $state<Settings | null>(null)
  let statuses = $state<CredentialStatus[]>([])
  let transforms = $state<Transform[]>([])
  let runtimeStates = $state<TransformRuntimeState[]>([])
  let url = $state('')
  let expandedId = $state<string | null>(null)
  let loadError = $state<{ message: string; retryable: boolean } | null>(null)
  let checking = $state(false)
  let showSettings = $state(false)

  const flow = new Flow(() => void refresh())

  /**
   * Whether the active tab is a page we could actually transform.
   *
   * about:, moz-extension: and view-source: are not. Without this check the
   * panel offers to transform its own options page and shows the extension's
   * UUID as the site name, which is how this was found.
   */
  let transformable = $derived(
    url.startsWith('http://') || url.startsWith('https://'),
  )

  let host = $derived.by(() => {
    if (!transformable) return ''
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
    if (!transformable) {
      transforms = []
      return
    }
    transforms = await send<Transform[]>({ type: 'get-transforms-for-url', url })
  }

  function applySettings(next: Settings) {
    settings = next
    // Accent is a user setting; tokens.css keys the palette off this.
    document.documentElement.dataset['accent'] = next.accent
  }

  async function saveSettings(next: Settings) {
    applySettings(next)
    await send({ type: 'save-settings', settings: next })
  }

  async function load() {
    loadError = null
    try {
      applySettings(await send<Settings>({ type: 'get-settings' }))
      statuses = await send<CredentialStatus[]>({ type: 'get-credential-statuses' })

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

  /*
   * Development affordance for the one claim in the safety model that cannot
   * be established by reading code: whether the world CSP actually contains
   * network egress. Behind a build flag so it never reaches a release.
   */
  const cspProbeEnabled = import.meta.env['VITE_CSP_PROBE'] === '1'

  async function runCspProbe() {
    const tab = await activeTab()
    if (tab?.id === undefined) return
    // Both grants, from this click while the gesture is still live.
    const granted = await browser.permissions.request({
      origins: ['http://localhost:8787/*'],
      permissions: ['userScripts'],
    } as unknown as browser.permissions.Permissions)
    if (!granted) return
    await send({ type: 'run-csp-probe', tabId: tab.id })
  }

  async function checkNow() {
    const tab = await activeTab()
    if (tab?.id === undefined || !url) return
    checking = true
    try {
      runtimeStates = await send<TransformRuntimeState[]>({
        type: 'check-now',
        tabId: tab.id,
        url,
      })
    } finally {
      checking = false
    }
  }

  async function setEnabled(transform: Transform, enabled: boolean) {
    /*
     * Re-enabling a JS transform registers a user script again, which needs
     * the permission. If it was revoked since the transform was saved, the
     * toggle would otherwise fail with an error telling the user to grant it
     * from the sidebar — from the sidebar, with no way to.
     *
     * Before any await, so the gesture behind the toggle is still live.
     */
    if (enabled && transform.kind === 'js') {
      const granted = await browser.permissions.request(
        flow.permissionsFor('js', transform.match),
      )
      if (!granted) return
    }

    await send({ type: 'set-enabled', id: transform.id, enabled })
    transforms = transforms.map((t) => (t.id === transform.id ? { ...t, enabled } : t))
  }

  function openSettingsPage() {
    void browser.runtime.openOptionsPage()
  }

  $effect(() => {
    void load()

    const onMessage = (message: ContentEvent) => {
      // Health results are the one content event the list owns rather than
      // the flow — they describe saved transforms, not the draft.
      if (message.type === 'health-check-result') runtimeStates = message.states
      else flow.receive(message)
    }
    browser.runtime.onMessage.addListener(onMessage)

    /*
     * The full settings page is a separate document, so a change made there
     * reaches this panel only through storage. Without this the accent looked
     * like it had no effect on the sidebar until it was reopened.
     */
    const onStored = (
      changes: Record<string, browser.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local' || !changes['settings']) return
      applySettings(changes['settings'].newValue as Settings)
    }
    browser.storage.onChanged.addListener(onStored)

    /*
     * The panel persists while tabs come and go. Bound once, it kept showing
     * the site it opened on — and offered to save transforms against it.
     */
    const onTabChange = () => void load()
    browser.tabs.onActivated.addListener(onTabChange)
    const onTabUpdated = (
      _id: number,
      change: browser.tabs._OnUpdatedChangeInfo,
      tab: browser.tabs.Tab,
    ) => {
      if (change.url && tab.active) void load()
    }
    browser.tabs.onUpdated.addListener(onTabUpdated)

    // A run whose page has gone is not recoverable, and its outline went with
    // the tab, so there is nothing left to clean up either.
    const onTabRemoved = (id: number) => flow.tabClosed(id)
    browser.tabs.onRemoved.addListener(onTabRemoved)

    // Held open for the lifetime of the panel. The background watches for it
    // to drop, which is how "closing this panel discards it" is kept true —
    // a closed sidebar gets no chance to run cleanup of its own.
    const port = browser.runtime.connect({ name: 'wa-sidebar' })

    return () => {
      browser.runtime.onMessage.removeListener(onMessage)
      browser.storage.onChanged.removeListener(onStored)
      browser.tabs.onActivated.removeListener(onTabChange)
      browser.tabs.onUpdated.removeListener(onTabUpdated)
      browser.tabs.onRemoved.removeListener(onTabRemoved)
      port.disconnect()
    }
  })
</script>

<div class="panel">
  <header class="chrome">
    <span class="brand">Web Alchemist</span>
    <button
      type="button"
      class="chrome-link"
      onclick={() => (showSettings = !showSettings)}
    >
      {showSettings ? 'Done' : 'Settings'}
    </button>
  </header>

  {#if loadError}
    <div class="load-error" role="alert">
      <p>{loadError.message}</p>
      <div class="load-actions">
        {#if loadError.retryable}
          <button type="button" onclick={load}>Try again</button>
        {/if}
        <button type="button" onclick={openSettingsPage}>Settings</button>
      </div>
    </div>
  {/if}

  {#if flow.error}
    <ErrorCard
      error={flow.error}
      onretry={() => void flow.retry()}
      onsettings={openSettingsPage}
      ondismiss={() => flow.dismissError()}
    />
  {/if}

  {#if showSettings && settings}
    <SettingsPanel
      {settings}
      {statuses}
      onsave={(next: Settings) => void saveSettings(next)}
      onfullpage={openSettingsPage}
    />
  {:else if flow.awayFromOwner}
    <div class="paused">
      <h1>Still describing something on {flow.ownerHost}</h1>
      <p>
        This run is about an element on that page, so it stays there rather than
        following you here. Go back to carry on, or discard it and start fresh.
      </p>
      <div class="paused-actions">
        <button type="button" class="primary" onclick={() => void flow.returnToOwner()}>
          Back to {flow.ownerHost}
        </button>
        <button type="button" class="secondary" onclick={() => void flow.discard()}>
          Discard it
        </button>
      </div>
    </div>
  {:else if !transformable}
    <div class="empty">
      <h1>Nothing to change here</h1>
      <p>
        This is a browser page, not a website. Open a site and the panel will show
        what can be changed on it.
      </p>
    </div>
  {:else if flow.step === 'picking'}
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
      chain={flow.chain}
      depth={flow.chainDepth}
      onretarget={(levelsUp: number) => void flow.retarget(levelsUp)}
      onpreview={(levelsUp: number | null) => void flow.previewAncestor(levelsUp)}
      scopeDepth={flow.scopeDepth}
      scopeCount={flow.scopeCount}
      scopeContainer={flow.scopeContainer}
      onscope={(depth: number) => void flow.setScopeDepth(depth)}
      oncancel={() => void flow.discard()}
      ongenerate={() => void flow.generate()}
    />
  {:else if flow.step === 'generating'}
    <Generating
      stage={flow.stage}
      reached={(stage) => flow.stageReached(stage)}
      elapsed={flow.elapsed}
      kind={flow.result?.kind ?? null}
      code={flow.streamed}
      withScreenshot={flow.sendScreenshot}
      {contextSize}
      oncancel={() => flow.cancelGenerating()}
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
      origin={originPermissionFor(flow.matchPattern)}
      permissionDenied={flow.permissionDenied}
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
        {#if cspProbeEnabled}
          <button type="button" class="link" onclick={() => void runCspProbe()}>
            Run CSP probe
          </button>
        {/if}
      </div>
    </div>
    <footer class="idle-foot">
      <span>{host}</span>
    </footer>
  {:else}
    <header class="site">
      <span class="site-dot" aria-hidden="true"></span>
      <span class="host">{host}</span>
      <button
        type="button"
        class="check"
        disabled={checking}
        title="Check whether these still work"
        onclick={() => void checkNow()}
      >
        {checking ? 'Checking…' : 'Check'}
      </button>
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
  /*
   * A fixed-height frame, not a growing column. The panel scrolling as a whole
   * pushed the composer and the Keep it / Discard buttons off the bottom as a
   * conversation grew — the controls have to stay put, so each step owns its
   * own scroll region instead.
   */
  .panel {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--surface);
    color: var(--text);
  }

  .chrome {
    display: flex;
    align-items: center;
    gap: var(--sp-7);
    padding: 8px var(--gutter-sidebar);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--chrome);
  }

  .brand {
    font: 600 11.5px var(--font-ui);
  }

  .chrome-link {
    margin-left: auto;
    padding: 0;
    border: none;
    background: none;
    font: 11px var(--font-ui);
    color: var(--text-faint);
    cursor: pointer;
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
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  .check {
    margin-left: auto;
    padding: 0;
    border: none;
    background: none;
    font: 11px var(--font-ui);
    color: var(--accent-fg);
    cursor: pointer;
  }

  .check:disabled {
    color: var(--text-faint);
    cursor: default;
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
    flex: 1;
    flex-direction: column;
    margin: 0;
    padding: 0;
    min-height: 0;
    overflow-y: auto;
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

  /* Top-aligned. The sidebar is a tall column and vertically centring a
     short block leaves it floating with no relationship to the header. */
  .paused {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--sp-12);
    padding: var(--sp-20) 18px;
    min-height: 0;
    overflow-y: auto;
  }

  .paused p {
    margin: 0;
    font: 12.5px/1.6 var(--font-ui);
    color: var(--text-dim);
  }

  .paused-actions {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
  }

  button.secondary {
    width: 100%;
    padding: 9px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-button);
    background: transparent;
    font: 600 12.5px var(--font-ui);
    color: var(--text);
    cursor: pointer;
  }

  .empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--sp-16);
    padding: var(--sp-20) 18px;
    min-height: 0;
    overflow-y: auto;
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

  /* The bar you point at, in the accent — this is selection, not breakage,
     and --attention is reserved for the latter. */
  .bar.target {
    width: 14px;
    height: 26px;
    border: 1.5px dashed var(--accent-fg);
    background: var(--accent-wash);
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
