<script lang="ts">
  import '@shared/tokens.css'
  import type { ReviewResult, Settings, Transform } from '@shared/types'
  import { matchPresetsFor, matchesUrl, originPermissionFor } from '@shared/match'
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
  const params = new URLSearchParams(location.search)
  const id = params.get('id') ?? ''
  /*
   * Create mode (#27). The sidebar puts the pick in session storage and passes
   * a key, because an anchor carries a path, landmarks and class names and a
   * query string is the wrong shape to hold one.
   */
  const draftKey = params.get('draft') ?? ''
  const creating = draftKey !== ''

  let transform = $state<Transform | null>(null)
  /* Only choosable while creating: changing it later would invalidate the code. */
  let kind = $state<'css' | 'js'>('css')
  let name = $state('')
  let code = $state('')
  let saved = $state('')
  let match = $state('')
  let savedMatch = $state('')
  let loadError = $state<string | null>(null)
  let findings = $state<string[]>([])
  let saving = $state(false)
  let justSaved = $state(false)

  /*
   * Creating is dirty from the start in the sense that leaving loses work, but
   * Save must not be offered for an empty body — a transform that does nothing
   * is a row the user has to notice and delete. A name is required for the same
   * reason the list needs one to show.
   */
  let dirty = $derived(
    transform !== null &&
      (creating
        ? code.trim().length > 0 && name.trim().length > 0
        : code !== saved || match !== savedMatch),
  )

  /*
   * Where it applies, offered as the same four choices the save flow gives.
   * Those are built from a URL and this page has none, so one is reconstructed
   * from the pattern itself — `reddit.com/r/x*` describes a page well enough
   * to derive "this domain", "with subdomains", "this path" and "this page"
   * from, which is all the presets are.
   */
  let presets = $derived.by(() => {
    const host = match.split('/')[0] ?? ''
    if (!host) return []
    const path = match.slice(host.length).replace(/\*+$/, '')
    return matchPresetsFor(`https://${host.replace(/^\*\./, '')}${path || '/'}`)
  })

  /*
   * A pattern that does not match the page it was written for is almost
   * certainly a mistake, and one that shows up as the transform silently
   * never running. The anchor's own path is the closest thing this page has
   * to that page, so it is what gets checked.
   */
  let reaches = $derived.by(() => {
    const host = savedMatch.split('/')[0]?.replace(/^\*\./, '') ?? ''
    if (!host || !match.trim()) return true
    return matchesUrl(match.trim(), `https://${host}/`)
  })

  /**
   * Builds the record a hand-written transform starts from.
   *
   * `origin: 'manual'` is the value `TransformOrigin` has always had and
   * nothing produced. It matters beyond bookkeeping: the AI-JS kill switch acts
   * on model-written code, and code the user typed themselves is not in its
   * scope.
   *
   * The rationale is written rather than left blank because it is shown when a
   * transform breaks, and "no description" at that moment is the least useful
   * thing it could say.
   */
  async function loadDraft() {
    const stored = await browser.storage.session.get(`wa-draft-${draftKey}`)
    const draft = stored[`wa-draft-${draftKey}`] as
      | { anchor: Transform['anchor']; match: string; target?: { label?: string }; url: string }
      | undefined

    if (!draft) {
      loadError =
        'That draft is no longer available. Drafts last until the browser closes — pick the element again to start over.'
      return
    }

    const now = Date.now()
    transform = {
      id: crypto.randomUUID(),
      name: '',
      enabled: true,
      order: now,
      match: draft.match,
      kind: 'css',
      origin: 'manual',
      capabilities: [],
      intent: 'Written by hand.',
      rationale: {
        targets: draft.anchor.selector,
        approach: 'Written by hand, so there is no generated description of it.',
        assumptions: [],
      },
      anchor: draft.anchor,
      code: '',
      createdAt: now,
      updatedAt: now,
    }
    code = ''
    saved = ''
    match = draft.match
    savedMatch = draft.match
    name = ''
    document.title = 'New transform — Web Alchemist'
  }

  async function load() {
    if (creating) {
      await loadDraft()
      return
    }
    try {
      const found = await send<Transform | null>({ type: 'get-transform', id })
      if (!found) {
        loadError = 'That transform no longer exists. It may have been deleted.'
        return
      }
      transform = found
      code = found.code
      saved = found.code
      match = found.match
      savedMatch = found.match
      document.title = `${found.name} — Web Alchemist`
    } catch (cause) {
      loadError = String(cause instanceof Error ? cause.message : cause)
    }
  }

  async function save() {
    const current = transform
    if (!current || saving) return

    const wanted = match.trim() || current.match

    saving = true
    findings = []
    try {
      /*
       * Widening where a transform applies is asking to read more sites, so
       * it goes through the same prompt saving a new one does. First await in
       * the handler, so the click that reached here is still live — the
       * request is refused outright once a gesture has been spent.
       */
      if (wanted !== current.match) {
        const granted = await browser.permissions.request({
          origins: [originPermissionFor(wanted)],
        })
        if (!granted) {
          findings = [
            `Web Alchemist needs permission for ${originPermissionFor(wanted)} before it can apply this there.`,
          ]
          return
        }
      }

      /*
       * The same check the panel ran, for the same reason: a blocking finding
       * has to be readable next to the line that caused it, before anything is
       * written. The background repeats it on save — this is the copy that can
       * explain itself.
       */
      if ((creating ? kind : current.kind) === 'js') {
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

      const next: Transform = creating
        ? { ...current, code, match: wanted, kind, name: name.trim(), updatedAt: Date.now() }
        : {
            ...current,
            code,
            match: wanted,
            rationale: {
              targets: current.rationale.targets,
              // The old prose described the old code. Saying so is better than
              // leaving a description that quietly stopped being true.
              approach:
                'Edited by hand. Any description of the previous code no longer applies.',
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
      savedMatch = wanted
      match = wanted
      justSaved = true
      setTimeout(() => (justSaved = false), 2000)

      if (creating) {
        /*
         * The draft has served its purpose, and leaving it would mean a second
         * Save created a duplicate rather than updating what was just written.
         * Switching the URL to the saved id turns this into an ordinary edit
         * session, including across a reload.
         */
        await browser.storage.session.remove(`wa-draft-${draftKey}`)
        history.replaceState(null, '', `?id=${encodeURIComponent(next.id)}`)
        location.reload()
      }
    } catch (cause) {
      findings = [String(cause instanceof Error ? cause.message : cause)]
    } finally {
      saving = false
    }
  }

  function revert() {
    code = saved
    match = savedMatch
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
        {#if creating}
          <input
            class="name-field"
            bind:value={name}
            placeholder="Name this transform"
            spellcheck="false"
            autocomplete="off"
          />
          <p class="intent">
            Written by hand. Nothing is sent to a model, and no page content leaves the
            browser.
          </p>
        {:else}
          <h1>{transform.name}</h1>
          <p class="intent">{transform.intent}</p>
        {/if}
        <div class="facts">
          {#if creating}
            <!--
              Only choosable now. Changing the kind of an existing transform
              would leave code that cannot mean anything in its new form.
            -->
            <div class="kinds" role="radiogroup" aria-label="Transform kind">
              {#each ['css', 'js'] as const as option}
                <button
                  type="button"
                  role="radio"
                  aria-checked={kind === option}
                  class="kind"
                  class:on={kind === option}
                  onclick={() => (kind = option)}
                >
                  {option.toUpperCase()}
                </button>
              {/each}
            </div>
            {#if kind === 'js'}
              <span class="badge attention">checked before it is saved</span>
            {/if}
          {:else}
            <span class="badge">{transform.kind.toUpperCase()}</span>
          {/if}
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
        {#if !creating}
          <button type="button" class="secondary" disabled={!dirty || saving} onclick={revert}>
            Revert
          </button>
        {/if}
        <button type="button" class="primary" disabled={!dirty || saving} onclick={save}>
          {#if saving}Saving…{:else if creating}Create{:else}Save{/if}
        </button>
      </div>
    </header>

    <section class="where">
      <label for="match">Applies to</label>
      <input
        id="match"
        value={match}
        spellcheck="false"
        oninput={(event) => (match = event.currentTarget.value)}
      />
      <div class="presets">
        {#each presets as preset}
          <button
            type="button"
            class="preset"
            class:on={preset.pattern === match.trim()}
            onclick={() => (match = preset.pattern)}
          >
            {preset.pattern}
          </button>
        {/each}
      </div>
      {#if !reaches}
        <!--
          A pattern that misses the site it was written for is a transform
          that silently never runs, which is the failure this whole panel
          exists to make visible elsewhere.
        -->
        <p class="warn">
          This no longer covers {savedMatch.split('/')[0]}, where it was written.
        </p>
      {:else if match.trim() !== savedMatch}
        <p class="hint">
          Saving asks for permission to read {originPermissionFor(match.trim() || savedMatch)}.
        </p>
      {/if}
    </section>

    {#if findings.length > 0}
      <div class="findings">
        <strong>Not saved.</strong>
        {#each findings as finding}
          <p>{finding}</p>
        {/each}
      </div>
    {/if}

    <CodeArea value={code} kind={creating ? kind : transform.kind} onchange={(next) => (code = next)} />

    <footer>
      <span>
        {(creating ? kind : transform.kind) === 'js'
          ? 'Checked before it is saved'
          : 'Applied as written'}
      </span>
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

  .badge {
    padding: 2px 6px;
    border-radius: var(--r-badge);
    background: var(--surface-raised);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .name-field {
    width: 100%;
    padding: 2px 0;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    font: 600 17px var(--font-ui);
    color: var(--text);
  }

  .name-field::placeholder {
    color: var(--text-faint);
  }

  .kinds {
    display: flex;
    gap: 2px;
  }

  .kind {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-badge);
    background: transparent;
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--text-dim);
    cursor: pointer;
  }

  .kind.on {
    border-color: var(--accent-fg);
    background: var(--accent-chip);
    color: var(--accent-fg);
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

  .where {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-7);
  }

  .where label {
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .where input {
    flex: 1;
    min-width: 220px;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 12px var(--font-mono);
    color: var(--text);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-5);
  }

  .preset {
    padding: 4px 8px;
    font: 11px var(--font-mono);
  }

  .preset.on {
    border-color: var(--accent-fg);
    color: var(--accent-fg);
  }

  .warn {
    flex-basis: 100%;
    margin: 0;
    font: 12px var(--font-ui);
    color: var(--attention);
  }

  .hint {
    flex-basis: 100%;
    margin: 0;
    font: 12px var(--font-ui);
    color: var(--text-faint);
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
