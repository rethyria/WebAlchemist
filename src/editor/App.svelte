<script lang="ts">
  import '@shared/tokens.css'
  import type { ReviewResult, Settings, Transform } from '@shared/types'
  import { send } from '@shared/messaging.svelte'
  import CodeArea from './CodeArea.svelte'

  /**
   * A page rather than a panel.
   *
   * The sidebar is 264px wide, which is enough to read a transform and not
   * enough to work on one. Everything here is the same gate the panel applied
   * — static analysis before the code is stored, and the background re-runs it
   * regardless — with room to see what is being edited.
   */
  const id = new URLSearchParams(location.search).get('id') ?? ''

  let transform = $state<Transform | null>(null)
  let code = $state('')
  let saved = $state('')
  let loadError = $state<string | null>(null)
  let findings = $state<string[]>([])
  let saving = $state(false)
  let justSaved = $state(false)

  let dirty = $derived(transform !== null && code !== saved)

  async function load() {
    try {
      const found = await send<Transform | null>({ type: 'get-transform', id })
      if (!found) {
        loadError = 'That transform no longer exists. It may have been deleted.'
        return
      }
      transform = found
      code = found.code
      saved = found.code
      document.title = `${found.name} — Web Alchemist`
    } catch (cause) {
      loadError = String(cause instanceof Error ? cause.message : cause)
    }
  }

  async function save() {
    const current = transform
    if (!current || saving) return

    saving = true
    findings = []
    try {
      /*
       * The same check the panel ran, for the same reason: a blocking finding
       * has to be readable next to the line that caused it, before anything is
       * written. The background repeats it on save — this is the copy that can
       * explain itself.
       */
      if (current.kind === 'js') {
        const analysis = await send<ReviewResult>({
          type: 'analyse',
          code,
          declaredCapabilities: current.capabilities,
        })
        const blocking = analysis.static.filter((f) => f.severity === 'block')
        if (blocking.length > 0) {
          findings = blocking.map((f) => `Line ${f.line}: ${f.explanation}`)
          return
        }
      }

      const next: Transform = {
        ...current,
        code,
        rationale: {
          targets: current.rationale.targets,
          // The old prose described the old code. Saying so is better than
          // leaving a description that quietly stopped being true.
          approach: 'Edited by hand. Any description of the previous code no longer applies.',
          assumptions: [],
        },
        updatedAt: Date.now(),
      }

      // Every tab the transform matches, not just one: this page is not on any
      // of them, and a save that only reached the last-focused tab would look
      // like it had not worked.
      await send({ type: 'save-transform', transform: next })
      await send({ type: 'reapply-everywhere', id: current.id })

      transform = next
      saved = code
      justSaved = true
      setTimeout(() => (justSaved = false), 2000)
    } catch (cause) {
      findings = [String(cause instanceof Error ? cause.message : cause)]
    } finally {
      saving = false
    }
  }

  function revert() {
    code = saved
    findings = []
  }

  /* Closing a tab is not undoable, and neither is losing what is in it. */
  function guard(event: BeforeUnloadEvent) {
    if (!dirty) return
    event.preventDefault()
  }

  function onKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      void save()
    }
  }

  $effect(() => {
    void load()
    void send<Settings>({ type: 'get-settings' })
      .then((settings) => {
        document.documentElement.dataset['accent'] = settings.accent
      })
      .catch(() => {
        // The accent is decoration; failing to read it must not stop editing.
      })
  })
</script>

<svelte:window on:beforeunload={guard} on:keydown={onKeyDown} />

<main>
  {#if loadError}
    <div class="empty">
      <h1>Nothing to edit</h1>
      <p>{loadError}</p>
    </div>
  {:else if transform}
    <header>
      <div class="titles">
        <h1>{transform.name}</h1>
        <p class="intent">{transform.intent}</p>
        <div class="facts">
          <span class="badge">{transform.kind.toUpperCase()}</span>
          <code>{transform.match}</code>
          {#if transform.capabilities.length > 0}
            <span class="badge attention">{transform.capabilities.join(', ')}</span>
          {/if}
          {#if !transform.enabled}
            <span class="badge">disabled</span>
          {/if}
        </div>
      </div>

      <div class="actions">
        {#if justSaved}
          <span class="note">Saved</span>
        {:else if dirty}
          <span class="note">Unsaved changes</span>
        {/if}
        <button type="button" class="secondary" disabled={!dirty || saving} onclick={revert}>
          Revert
        </button>
        <button type="button" class="primary" disabled={!dirty || saving} onclick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </header>

    {#if findings.length > 0}
      <div class="findings">
        <strong>Not saved.</strong>
        {#each findings as finding}
          <p>{finding}</p>
        {/each}
      </div>
    {/if}

    <CodeArea value={code} kind={transform.kind} onchange={(next) => (code = next)} />

    <footer>
      <span>{transform.kind === 'js' ? 'Checked before it is saved' : 'Applied as written'}</span>
      <span class="hint">Ctrl+S saves · Tab indents · Esc then Tab leaves the field</span>
    </footer>
  {:else}
    <div class="empty"><p>Loading…</p></div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
  }

  main {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    box-sizing: border-box;
    height: 100vh;
    max-width: 1100px;
    margin: 0 auto;
    padding: var(--sp-20);
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-16);
  }

  .titles {
    min-width: 0;
  }

  h1 {
    margin: 0;
    font: 600 17px var(--font-ui);
  }

  .intent {
    margin: var(--sp-5) 0 0;
    font: 13px/1.5 var(--font-ui);
    color: var(--text-dim);
  }

  .facts {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-7);
    margin-top: var(--sp-9);
  }

  .facts code {
    font: 11.5px var(--font-mono);
    color: var(--text-dim);
  }

  .badge {
    padding: 2px 6px;
    border-radius: var(--r-badge);
    background: var(--surface-raised);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .badge.attention {
    background: rgb(from var(--attention) r g b / 0.16);
    color: var(--attention);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--sp-7);
    margin-left: auto;
  }

  .note {
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
  }

  button {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-button);
    background: transparent;
    font: 12.5px var(--font-ui);
    color: var(--text);
    cursor: pointer;
  }

  button.primary {
    border-color: var(--accent-fg);
    background: var(--accent-chip);
    color: var(--accent-fg);
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .findings {
    padding: var(--sp-11) var(--sp-13);
    border: 1px solid rgb(from var(--block) r g b / 0.4);
    border-radius: var(--r-card);
    background: rgb(from var(--block) r g b / 0.1);
    font: 12.5px/1.5 var(--font-ui);
  }

  .findings p {
    margin: var(--sp-5) 0 0;
  }

  footer {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-13);
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
  }

  .empty {
    margin: auto;
    text-align: center;
    color: var(--text-dim);
  }
</style>
