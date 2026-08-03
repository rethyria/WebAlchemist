<script lang="ts">
  /**
   * Placeholder shell.
   *
   * This is deliberately minimal — the designed components replace it. What it
   * establishes is the boundary the design must respect: this context talks to
   * the background script over messages and never holds a credential value.
   *
   * The nine states this surface needs are enumerated in docs/ui-design-prompt.md.
   */
  import type { Transform } from '@shared/types'

  let transforms = $state<Transform[]>([])
  let url = $state<string>('')
  let error = $state<string | null>(null)

  async function load() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
      url = tab?.url ?? ''
      if (!url) return
      const response = await browser.runtime.sendMessage({
        type: 'get-transforms-for-url',
        url,
      })
      if (response.ok) transforms = response.data
      else error = response.error?.message ?? 'Could not load transforms.'
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function startPicking() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id === undefined) return
    // activeTab grants access on the toolbar gesture; the content script is
    // injected here rather than declared in the manifest.
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/index.js'],
    })
    await browser.tabs.sendMessage(tab.id, { type: 'start-picking', mode: 'hover' })
  }

  $effect(() => {
    void load()
  })
</script>

<main>
  <h1>WebAlchemist</h1>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <button onclick={startPicking}>Select an element</button>

  {#if transforms.length === 0}
    <p class="empty">No transforms saved for this site.</p>
  {:else}
    <ul>
      {#each transforms as transform (transform.id)}
        <li>
          <span class="name">{transform.name}</span>
          <span class="kind">{transform.kind}</span>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  main {
    font-family: system-ui, sans-serif;
    padding: 12px;
    color: light-dark(#1a1a1a, #f0f0f0);
    background: light-dark(#ffffff, #1c1b22);
    min-height: 100vh;
  }
  h1 {
    font-size: 14px;
    margin: 0 0 12px;
  }
  .error {
    color: light-dark(#b3261e, #f2b8b5);
    font-size: 13px;
  }
  .empty {
    font-size: 13px;
    opacity: 0.7;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 12px 0 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 13px;
  }
  .kind {
    opacity: 0.6;
    font-family: ui-monospace, monospace;
  }
</style>
