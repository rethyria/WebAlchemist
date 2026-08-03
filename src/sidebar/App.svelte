<script lang="ts">
  import '@shared/tokens.css'
  import type {
    Settings,
    Transform,
    TransformRuntimeState,
  } from '@shared/types'
  import { activeTab, BackgroundError, send } from './lib/messaging'
  import TransformRow from './components/TransformRow.svelte'

  let settings = $state<Settings | null>(null)
  let transforms = $state<Transform[]>([])
  let runtimeStates = $state<TransformRuntimeState[]>([])
  let url = $state('')
  let expandedId = $state<string | null>(null)
  let error = $state<{ message: string; retryable: boolean } | null>(null)

  let host = $derived.by(() => {
    try {
      return new URL(url).hostname
    } catch {
      return ''
    }
  })

  let activeCount = $derived(transforms.filter((t) => t.enabled).length)
  let brokenCount = $derived(
    runtimeStates.filter((s) => s.status === 'broken').length,
  )

  function stateFor(id: string): TransformRuntimeState | undefined {
    return runtimeStates.find((s) => s.id === id)
  }

  async function load() {
    error = null
    try {
      settings = await send<Settings>({ type: 'get-settings' })
      // Accent is a user setting; tokens.css keys the palette off this.
      document.documentElement.dataset['accent'] = settings.accent

      const tab = await activeTab()
      url = tab?.url ?? ''
      if (!url) return

      transforms = await send<Transform[]>({ type: 'get-transforms-for-url', url })
    } catch (cause) {
      error =
        cause instanceof BackgroundError
          ? { message: cause.message, retryable: cause.retryable }
          : { message: String(cause), retryable: false }
    }
  }

  async function startPicking() {
    error = null
    try {
      const tab = await activeTab()
      if (tab?.id === undefined) return
      // activeTab is granted by the toolbar gesture; the content script is
      // injected here rather than declared in the manifest.
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content/index.js'],
      })
      await browser.tabs.sendMessage(tab.id, { type: 'start-picking', mode: 'hover' })
    } catch (cause) {
      error = { message: String(cause), retryable: true }
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
  })
</script>

<div class="panel">
  {#if error}
    <div class="error" role="alert">
      <p class="error-message">{error.message}</p>
      <div class="error-actions">
        {#if error.retryable}
          <button type="button" class="secondary" onclick={load}>Try again</button>
        {/if}
        <button type="button" class="secondary" onclick={openSettings}>Settings</button>
      </div>
    </div>
  {/if}

  {#if transforms.length === 0}
    <div class="empty">
      <div class="diagram" aria-hidden="true">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar target"></span>
      </div>
      <h1>Change any page, permanently</h1>
      <p>
        Point at part of this page and describe what you want changed. The change is
        saved for {host || 'this site'} and applies every time you visit.
      </p>
      <button type="button" class="primary" onclick={startPicking}>
        Select an element
      </button>
      <p class="hint">Or drag a rectangle on the page</p>
    </div>
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
          ontoggle={(enabled) => setEnabled(transform, enabled)}
          onexpand={() =>
            (expandedId = expandedId === transform.id ? null : transform.id)}
          onrepair={() => {}}
          onedit={() => {}}
        />
      {/each}
    </ul>

    <footer>
      <button type="button" class="primary" onclick={startPicking}>
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
    border-radius: 50%;
    background: var(--neutral);
  }

  .host {
    font: 13px var(--font-ui);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    margin-left: auto;
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
  }

  .broken-banner {
    margin: 0;
    padding: 9px var(--gutter-sidebar);
    border-bottom: 1px solid var(--border-subtle);
    background: rgb(from var(--attention) r g b / 0.09);
    font: 11.5px/1.5 var(--font-ui);
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
    gap: 7px;
    margin-top: auto;
    padding: 11px var(--gutter-sidebar);
    border-top: 1px solid var(--border-subtle);
  }

  .empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: var(--sp-16);
    padding: var(--sp-20) 18px;
    text-align: center;
  }

  /* A page, and the part you point at. */
  .diagram {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    align-items: center;
    height: 40px;
  }

  .bar {
    width: 96px;
    height: 10px;
    border-radius: var(--r-badge);
    background: var(--border);
  }

  .bar.target {
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

  .hint {
    font: 11px/1.5 var(--font-ui) !important;
    color: var(--text-faint) !important;
    text-align: center;
  }

  .error {
    padding: 11px var(--gutter-sidebar);
    border-bottom: 1px solid rgb(from var(--block) r g b / 0.4);
    background: rgb(from var(--block) r g b / 0.09);
  }

  .error-message {
    margin: 0 0 7px;
    font: 12.5px/1.55 var(--font-ui);
  }

  .error-actions {
    display: flex;
    gap: 6px;
  }

  button.primary,
  button.secondary {
    padding: 9px 10px;
    border-radius: var(--r-button);
    font: 600 12.5px var(--font-ui);
    cursor: pointer;
  }

  button.primary {
    border: none;
    background: var(--accent);
    color: var(--accent-text);
  }

  button.secondary {
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--text);
  }
</style>
