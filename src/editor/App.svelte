<script lang="ts">
  import { radioGroup } from '@shared/radio-group'
  import { focusOnMount } from '@sidebar/lib/focus'
  import '@shared/tokens.css'
  import type {
    CssUrlMode,
    ExecutionWorld,
    ReviewResult,
    Settings,
    Transform,
    TransformVersion,
  } from '@shared/types'
  import { hostOfPattern, modeForHost, policyKeyOfPattern } from '@safety/css-check'
  import { compareWithCurrent, restoreNeedsMainConfirmation, restoreRefusal, sourceLabel } from '@shared/versions'
  import { matchPresetsFor, matchesUrl, originPermissionFor, parsePattern } from '@shared/match'
  import { send } from '@shared/messaging.svelte'
  import {
    CONTAINER_SCOPE_NOTE,
    CONTAINER_UNREADABLE_NOTE,
    COOKIES_PERMISSION,
    EVERY_TAB_LABEL,
    TAB_CONTAINER_LABEL,
    containerForSave,
    type ContainerChoice,
  } from '@shared/container'
  import { editorOriginToRequest, permissionRequestsFor, requestAll } from '@shared/permissions'
  import { excludedAccessMessage, excludedHostForPattern } from '@shared/excluded-sites'
  import { MAIN_WORLD_RISKS, WORLD_NAMES, WORLD_RESET_NOTICE, worldOf } from '@shared/world'
  import CodeArea from './CodeArea.svelte'
  import MainRestoreRisks from './MainRestoreRisks.svelte'
  import { shouldConfirmLeaving } from './unload'

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
  /** The world a JavaScript transform runs in. Only the user changes it. */
  let world = $state<ExecutionWorld>('USER_SCRIPT')
  let savedWorld = $state<ExecutionWorld>('USER_SCRIPT')
  /* The container restriction; see shared/container.ts. */
  let choice = $state<ContainerChoice>('every-tab')
  let savedChoice = $state<ContainerChoice>('every-tab')
  /*
   * The tab the sidebar was showing when it opened this editor. Its container
   * is what a new restriction records, and it is the only tab this page can
   * name, because the editor is a tab of its own.
   */
  const sourceTabParam = params.get('tab')
  const sourceTabId = sourceTabParam !== null && /^\d+$/.test(sourceTabParam) ? Number(sourceTabParam) : null
  /* Whether the cookies permission is held, which reading a container needs. */
  let hasCookies = $state(true)
  let loadError = $state<string | null>(null)
  let findings = $state<string[]>([])
  let saving = $state(false)
  /** Earlier versions of this transform, newest first. Empty while creating. */
  let versions = $state<TransformVersion[]>([])
  let restoring = $state(false)
  /** The version shown for confirmation. Nothing is restored until it is confirmed. */
  let reviewing = $state<TransformVersion | null>(null)
  /** Whether the user confirmed the risks of restoring a version that runs in MAIN. */
  let mainRestoreConfirmed = $state(false)
  /**
   * The user's list of excluded sites, loaded when the page opens so that the
   * save and restore handlers can check it before their first await. An await
   * before a permission request ends the user gesture (#131).
   */
  let excludedSites = $state<string[]>([])
  let justSaved = $state(false)

  /*
   * What CSS on this site may load, kept in settings per site (host name from
   * the match pattern). Changing it takes effect at once rather than on Save:
   * it is a property of the site, not of this transform's text.
   */
  let cssPolicy = $state<Record<string, CssUrlMode>>({})
  let cssSiteHost = $derived(hostOfPattern(match.trim() || savedMatch))
  /* `*.host` for a pattern that covers subdomains, `host` for one host, null when neither can be set. */
  let cssPolicyKey = $derived(policyKeyOfPattern(match.trim() || savedMatch))
  let cssMode = $derived<CssUrlMode>(cssSiteHost ? modeForHost(cssPolicy, cssSiteHost) : 'block')
  /* External addresses waiting for approval, and whether the user ticked the box. */
  let pendingUrls = $state<string[]>([])
  let approveListed = $state(false)

  async function setCssMode(mode: CssUrlMode) {
    if (!cssPolicyKey) return
    try {
      const saved = await send<Settings>({
        type: 'patch-settings',
        change: { kind: 'css-site-mode', key: cssPolicyKey, mode },
      })
      cssPolicy = saved.cssUrlPolicy
      pendingUrls = []
      approveListed = false
      if (transform && !creating) await send({ type: 'reapply-everywhere', id: transform.id })
    } catch (cause) {
      findings = [String(cause instanceof Error ? cause.message : cause)]
    }
  }

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
        : code !== saved || match !== savedMatch || world !== savedWorld || choice !== savedChoice),
  )

  /*
   * Where it applies, offered as the same four choices the save flow gives.
   * Those are built from a URL and this page has none, so one is reconstructed
   * from the pattern itself — `reddit.com/r/x*` describes a page well enough
   * to derive "this domain", "with subdomains", "this path" and "this page"
   * from, which is all the presets are.
   */
  let presets = $derived.by(() => {
    const { scheme, host, path } = parsePattern(match)
    if (!host) return []
    // The presets keep the scheme the pattern names; `*://` and no scheme are
    // rebuilt as https, the scheme the save flow offers by default.
    return matchPresetsFor(
      `${scheme === 'http' ? 'http' : 'https'}://${host.replace(/^\*\./, '')}${path.replace(/\*+$/, '') || '/'}`,
    )
  })

  /*
   * A pattern that does not match the page it was written for is almost
   * certainly a mistake, and one that shows up as the transform silently
   * never running. The anchor's own path is the closest thing this page has
   * to that page, so it is what gets checked.
   */
  let reaches = $derived.by(() => {
    const saved = parsePattern(savedMatch)
    const host = saved.host.replace(/^\*\./, '')
    if (!host || !match.trim()) return true
    return matchesUrl(match.trim(), `${saved.scheme === 'http' ? 'http' : 'https'}://${host}/`)
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
    choice = 'every-tab'
    savedChoice = 'every-tab'
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
      world = worldOf(found)
      savedWorld = world
      choice = found.cookieStoreId === undefined ? 'every-tab' : 'tab-container'
      savedChoice = choice
      document.title = `${found.name} — Web Alchemist`
      await loadVersions()
    } catch (cause) {
      loadError = String(cause instanceof Error ? cause.message : cause)
    }
  }

  /**
   * The record with the given container restriction, or with none. JavaScript
   * transforms never carry one, because the restriction is not enforced for
   * them and a stored value would say otherwise.
   */
  function withContainer(
    base: Transform,
    kind: 'css' | 'js',
    cookieStoreId: string | undefined,
  ): Transform {
    const { cookieStoreId: _previous, ...rest } = base
    return cookieStoreId !== undefined && kind === 'css' ? { ...rest, cookieStoreId } : rest
  }

  async function loadCookiesPermission() {
    hasCookies = await browser.permissions.contains(COOKIES_PERMISSION).catch(() => false)
  }

  async function loadVersions() {
    versions = await send<TransformVersion[]>({ type: 'get-transform-versions', id })
  }

  /**
   * The approval a restored JavaScript version needs before the background
   * saves it, as fields to add to the restore request. Restore has no
   * exemption from the approval rules: the version's code, world and
   * capabilities, the transform id and the version's match are approved
   * through `approve-code`, as the editor's save does, and the background's
   * restore case passes the returned token to the same save handler. Code the
   * user chose to restore after reading it in the confirmation is the approval
   * here, as typed code is for a save. CSS needs no token.
   */
  async function approvalForRestore(
    current: Transform,
    version: TransformVersion,
  ): Promise<{ approvalToken?: string }> {
    if (current.kind !== 'js') return {}
    const { approvalToken } = await send<{ approvalToken: string }>({
      type: 'approve-code',
      code: version.code,
      declaredCapabilities: version.capabilities,
      ...(version.world ? { world: version.world } : {}),
      transformId: current.id,
      match: version.match,
    })
    return { approvalToken }
  }

  /*
   * Goes through the background's save path, which analyses restored
   * JavaScript again and refuses it if it no longer passes. The permission
   * requests are made first, as in save(), because a version may apply to a
   * wider site than the current code does.
   */
  async function restore(version: TransformVersion) {
    const current = transform
    if (!current || restoring || saving) return
    const refusal = restoreRefusal(current.kind, version, mainRestoreConfirmed)
    if (refusal !== null) {
      findings = [refusal]
      return
    }
    // Before the permission request, and with no await since the click.
    const excluded = excludedHostForPattern(excludedSites, version.match)
    if (excluded !== null) {
      findings = [excludedAccessMessage(excluded)]
      return
    }
    restoring = true
    findings = []
    try {
      const granted = await requestAll(
        (permissions) => browser.permissions.request(permissions),
        permissionRequestsFor(current.kind, editorOriginToRequest(false, version.match, current.match)),
      )
      if (!granted) {
        findings = ['Web Alchemist needs permission for the site this version applies to before it can restore it.']
        return
      }
      const approval = await approvalForRestore(current, version)
      await send({
        type: 'restore-transform-version',
        id: current.id,
        versionId: version.id,
        ...approval,
      })
      await send({ type: 'reapply-everywhere', id: current.id })
      const found = await send<Transform | null>({ type: 'get-transform', id: current.id })
      if (found) {
        transform = found
        code = found.code
        saved = found.code
        match = found.match
        savedMatch = found.match
        world = worldOf(found)
        savedWorld = world
      }
      await loadVersions()
      reviewing = null
      mainRestoreConfirmed = false
      justSaved = true
      setTimeout(() => (justSaved = false), 2000)
    } catch (cause) {
      findings = [String(cause instanceof Error ? cause.message : cause)]
    } finally {
      restoring = false
    }
  }

  async function save() {
    const current = transform
    if (!current || saving) return

    const wanted = match.trim() || current.match

    // Before the permission request, and with no await since the click.
    const excluded = excludedHostForPattern(excludedSites, wanted)
    if (excluded !== null) {
      findings = [excludedAccessMessage(excluded)]
      return
    }

    saving = true
    findings = []
    try {
      /*
       * Widening where a transform applies is asking to read more sites, so
       * it goes through the same prompt saving a new one does, and creating
       * always asks because the default pattern is wider than the picked host
       * (#102, see editorOriginToRequest). A JavaScript
       * transform also needs the optional userScripts permission, which the
       * background cannot request because it has no user gesture. Without it
       * the background stored the record and then failed to register it,
       * leaving a saved row that never ran (#101).
       *
       * The requests are issued here, before the first await in the handler,
       * so the click that reached here is still live; the request is refused
       * outright once a gesture has been spent.
       */
      const origin = editorOriginToRequest(creating, wanted, current.match)
      // The cookies permission is requested here too, in the same call and
      // before the first await, and only when a container has to be read: a
      // new restriction, or an old one whose permission was removed.
      const needsCookies =
        (creating ? kind : current.kind) === 'css' &&
        choice === 'tab-container' &&
        (savedChoice !== 'tab-container' || !hasCookies)
      const granted = await requestAll(
        (permissions) => browser.permissions.request(permissions),
        permissionRequestsFor(creating ? kind : current.kind, origin, needsCookies),
      )
      if (!granted) {
        findings = [
          (creating ? kind : current.kind) === 'js'
            ? 'Web Alchemist needs the permission to run JavaScript transforms, and permission for the site it applies to, before it can save this.'
            : `Web Alchemist needs permission for ${originPermissionFor(wanted)}${needsCookies ? ' and the cookies permission, to read the container,' : ''} before it can apply this there.`,
        ]
        return
      }
      if (needsCookies) hasCookies = true

      // Only a restriction that is new is read from the tab; one that is kept
      // keeps the stored value.
      const saveKind = creating ? kind : current.kind
      let storeId: string | undefined
      if (saveKind === 'css') {
        const source =
          choice === 'tab-container' && current.cookieStoreId === undefined && sourceTabId !== null
            ? await browser.tabs.get(sourceTabId).catch(() => undefined)
            : undefined
        const decided = containerForSave(choice, current.cookieStoreId, source?.cookieStoreId)
        if ('error' in decided) {
          findings = [decided.error]
          return
        }
        storeId = decided.cookieStoreId
      }

      /*
       * The same check the panel ran, for the same reason: a blocking finding
       * has to be readable next to the line that caused it, before anything is
       * written. The background repeats it on save — this is the copy that can
       * explain itself.
       */
      let approvalToken: string | undefined
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
        // Code the user typed was seen by the user, which is the approval here.
        approvalToken = (
          await send<{ approvalToken: string }>({
            type: 'approve-code',
            code,
            declaredCapabilities: current.capabilities,
            world,
            transformId: current.id,
            match: wanted,
          })
        ).approvalToken
      }

      /*
       * The CSS check, for the same reason as the JavaScript one above. Hand-
       * written CSS is not exempt: the person typing it may have pasted it from
       * somewhere, and a rule that loads an address sends a request on every
       * visit.
       */
      let approvedCssUrls = current.approvedCssUrls
      if ((creating ? kind : current.kind) === 'css') {
        const check = await send<ReviewResult>({
          type: 'analyse-css',
          css: code,
          match: wanted,
          approvedUrls: approveListed ? [...(approvedCssUrls ?? []), ...pendingUrls] : (approvedCssUrls ?? []),
        })
        if (check.static.length > 0) {
          findings = check.static.map((f) => `Line ${f.line}: ${f.explanation}`)
          return
        }
        if (!check.passed) {
          pendingUrls = check.pendingUrls ?? []
          approveListed = false
          findings = ['This CSS loads addresses outside the site. Tick the box below to approve them, then save again.']
          return
        }
        if (approveListed) approvedCssUrls = [...(approvedCssUrls ?? []), ...pendingUrls]
        pendingUrls = []
      }

      const next: Transform = creating
        ? {
            ...withContainer(current, kind, storeId),
            code,
            match: wanted,
            kind,
            name: name.trim(),
            ...(kind === 'js' ? { world } : {}),
            ...(approvedCssUrls ? { approvedCssUrls } : {}),
            updatedAt: Date.now(),
          }
        : {
            ...withContainer(current, current.kind, storeId),
            code,
            match: wanted,
            ...(current.kind === 'js' ? { world } : {}),
            ...(approvedCssUrls ? { approvedCssUrls } : {}),
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
      // A record without a container restriction asks for the stored one to be
      // removed, because the background keeps it when the field is missing.
      await send({
        type: 'save-transform',
        transform: next,
        clearContainer: next.cookieStoreId === undefined,
        source: 'hand-edit',
        ...(approvalToken ? { approvalToken } : {}),
      })
      await send({ type: 'reapply-everywhere', id: current.id })
      if (!creating) await loadVersions()

      transform = next
      saved = code
      savedMatch = wanted
      match = wanted
      savedWorld = world
      savedChoice = next.cookieStoreId === undefined ? 'every-tab' : 'tab-container'
      choice = savedChoice
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
        reloadingAfterCreate = true
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
    choice = savedChoice
    findings = []
  }

  /* Closing a tab is not undoable, and neither is losing what is in it. */
  let reloadingAfterCreate = false

  function guard(event: BeforeUnloadEvent) {
    if (!shouldConfirmLeaving(dirty, reloadingAfterCreate)) return
    event.preventDefault()
  }

  function onKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      void save()
    }
  }

  $effect(() => {
    void send<string[]>({ type: 'get-excluded-sites' })
      .then((sites) => (excludedSites = sites))
      .catch(() => {
        // Without the list the background still refuses picking and generating
        // on those sites; only this page's early refusal is missing.
      })
    // The list is edited on the settings page while this page is open.
    const onStored = (changes: Record<string, browser.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes['wa-excluded-sites']) {
        excludedSites = (changes['wa-excluded-sites'].newValue as string[] | undefined) ?? []
      }
    }
    browser.storage.onChanged.addListener(onStored)
    void load()
    void loadCookiesPermission()
    void send<Settings>({ type: 'get-settings' })
      .then((settings) => {
        document.documentElement.dataset['accent'] = settings.accent
        cssPolicy = settings.cssUrlPolicy ?? {}
      })
      .catch(() => {
        // The accent is decoration; failing to read it must not stop editing.
      })
    return () => browser.storage.onChanged.removeListener(onStored)
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
            use:focusOnMount
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
          <h1 use:focusOnMount>{transform.name}</h1>
          <p class="intent">{transform.intent}</p>
        {/if}
        <div class="facts">
          {#if creating}
            <!--
              Only choosable now. Changing the kind of an existing transform
              would leave code that cannot mean anything in its new form.
            -->
            <div class="kinds" role="radiogroup" aria-label="Transform kind" use:radioGroup>
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
        <!-- Persistent, so the confirmation is a change that is read out. -->
        <span class="sr-only" role="status">{justSaved ? 'Saved.' : ''}</span>
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
          This no longer covers {parsePattern(savedMatch).host}, where it was written.
        </p>
      {:else if match.trim() !== savedMatch}
        <p class="hint">
          Saving asks for permission to read {originPermissionFor(match.trim() || savedMatch)}.
        </p>
      {/if}
    </section>

    {#if (creating ? kind : transform.kind) === 'js'}
      <section class="where">
        <span class="label">World</span>
        {#if transform?.worldResetFromModel}
          <p class="warn">{WORLD_RESET_NOTICE}</p>
        {/if}
        <p class="hint">
          Now: {WORLD_NAMES[world]}.
          {#if world === 'MAIN' && savedWorld === 'MAIN'}
            This transform was saved to run in the page's own world and keeps doing so.
          {/if}
        </p>
        <label>
          <input
            type="checkbox"
            checked={world === 'MAIN'}
            onchange={(event) => (world = event.currentTarget.checked ? 'MAIN' : 'USER_SCRIPT')}
          />
          Run in the page's own world (MAIN)
        </label>
        {#if world === 'MAIN'}
          <p class="warn">Running in the page's own world has these risks:</p>
          <ul class="hint">
            {#each MAIN_WORLD_RISKS as risk}
              <li>{risk}</li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if (creating ? kind : transform.kind) === 'css' && (sourceTabId !== null || savedChoice === 'tab-container')}
      <section class="where">
        <label for="container">Container</label>
        <select id="container" bind:value={choice}>
          <option value="every-tab">{EVERY_TAB_LABEL}</option>
          <option value="tab-container">{TAB_CONTAINER_LABEL}</option>
        </select>
        <p class="hint">{CONTAINER_SCOPE_NOTE}</p>
        {#if savedChoice === 'tab-container' && !hasCookies}
          <p class="warn">{CONTAINER_UNREADABLE_NOTE}</p>
        {/if}
      </section>
    {/if}

    {#if (creating ? kind : transform.kind) === 'css'}
      <details class="advanced">
        <summary>Advanced: addresses CSS may load</summary>
        <label for="css-mode">For {cssSiteHost ?? 'this site'}</label>
        <select
          id="css-mode"
          value={cssMode}
          disabled={!cssPolicyKey}
          onchange={(event) => void setCssMode(event.currentTarget.value as CssUrlMode)}
        >
          <option value="block">Only data: addresses (default)</option>
          <option value="same-origin">Data: addresses and addresses on the same site</option>
          <option value="list-external">Same site, and other addresses that are approved one by one</option>
        </select>
        <p class="hint">
          CSS that loads an address makes the browser send a request on every visit, and a
          request can carry information about the page. @import is never allowed.
          {#if !cssPolicyKey}This pattern has no fixed host name, or covers every site under a public
            suffix such as .com, so the default applies.{/if}
        </p>
      </details>
      {#if pendingUrls.length > 0}
        <div class="findings">
          <strong>Needs approval.</strong>
          <ul>
            {#each pendingUrls as url}
              <li><code>{url}</code></li>
            {/each}
          </ul>
          <label>
            <input type="checkbox" bind:checked={approveListed} />
            Approve loading {pendingUrls.length === 1 ? 'this address' : 'these addresses'}
          </label>
        </div>
      {/if}
    {/if}

    {#if findings.length > 0}
      <!-- An alert, so a save that fails is read out when the message appears. -->
      <div class="findings" role="alert">
        <strong>Not saved.</strong>
        {#each findings as finding}
          <p>{finding}</p>
        {/each}
      </div>
    {/if}

    <CodeArea value={code} kind={creating ? kind : transform.kind} onchange={(next) => (code = next)} />

    {#if !creating && versions.length > 0}
      <details class="versions">
        <summary>Earlier versions ({versions.length})</summary>
        <ul>
          {#each versions as version (version.id)}
            <li>
              <span>
                {new Date(version.savedAt).toLocaleString()} · {sourceLabel(version.producedBy)}
              </span>
              <button
                type="button"
                class="secondary"
                disabled={dirty || restoring || saving}
                onclick={() => {
                  reviewing = version
                  mainRestoreConfirmed = false
                }}
              >
                Review this version
              </button>
            </li>
          {/each}
        </ul>
        {#if reviewing && transform}
          {@const differences = compareWithCurrent(transform, reviewing)}
          <section class="review" aria-labelledby="review-title">
            <h2 id="review-title" use:focusOnMount>Version from {new Date(reviewing.savedAt).toLocaleString()}</h2>
            <p class="hint">
              Restoring replaces the code, match pattern, capabilities and world of this transform
              with the values of this version. The current state is kept as a version, so a restore
              can be undone.
            </p>
            <table>
              <caption>Current values and the values of this version</caption>
              <thead>
                <tr><th scope="col">Item</th><th scope="col">Current</th><th scope="col">This version</th><th scope="col">Difference</th></tr>
              </thead>
              <tbody>
                {#each differences as row (row.label)}
                  <tr>
                    <th scope="row">{row.label}</th>
                    <td>{row.current}</td>
                    <td>{row.version}</td>
                    <td>{row.status}</td>
                  </tr>
                {/each}
                <tr>
                  <th scope="row">Code</th>
                  <td colspan="2">Shown below</td>
                  <td>{reviewing.code === transform.code ? 'Same' : 'Different'}</td>
                </tr>
              </tbody>
            </table>
            <h3>Code in this version</h3>
            <pre class="version-code">{reviewing.code}</pre>
            {#if restoreNeedsMainConfirmation(transform.kind, reviewing)}
              <MainRestoreRisks bind:confirmed={mainRestoreConfirmed} disabled={restoring} />
            {/if}
            <div class="actions">
              <button
                type="button"
                disabled={restoring || saving || restoreRefusal(transform.kind, reviewing, mainRestoreConfirmed) !== null}
                onclick={() => void restore(reviewing!)}>
                Restore this version
              </button>
              <button type="button" class="secondary" disabled={restoring} onclick={() => (reviewing = null)}>
                Cancel
              </button>
            </div>
          </section>
        {/if}
        {#if dirty}
          <p class="hint">Save or revert the changes in the editor before restoring a version.</p>
        {/if}
      </details>
    {/if}

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
  .advanced {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    font: 12px/1.5 var(--font-ui);
    color: var(--text-dim);
  }

  .advanced summary {
    cursor: pointer;
  }

  .advanced select {
    max-width: 480px;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-badge);
    background: var(--surface-raised);
    font: 12px var(--font-ui);
    color: var(--text);
  }

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

  .where input,
  .where select {
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

  .versions ul {
    margin: var(--sp-5) 0 0;
    padding: 0;
    list-style: none;
  }
  .versions li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-13);
    padding: var(--sp-5) 0;
    font: 12px var(--font-ui);
    color: var(--text-dim);
  }
  .review {
    margin-top: var(--sp-9);
    padding: var(--sp-11) var(--sp-13);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }
  .review h2 {
    margin: 0;
    font: 600 13px var(--font-ui);
  }
  .review h3 {
    margin: var(--sp-9) 0 var(--sp-5);
    font: 600 12px var(--font-ui);
  }
  .review table {
    width: 100%;
    margin-top: var(--sp-9);
    border-collapse: collapse;
    font: 12px var(--font-ui);
  }
  .review caption {
    text-align: left;
    color: var(--text-faint);
    padding-bottom: var(--sp-5);
  }
  .review th,
  .review td {
    padding: var(--sp-5);
    text-align: left;
    border-top: 1px solid var(--border);
    overflow-wrap: anywhere;
  }
  .version-code {
    max-height: 240px;
    margin: 0;
    overflow: auto;
    font: 12px/1.5 var(--font-mono, monospace);
    white-space: pre-wrap;
  }
  .actions {
    display: flex;
    gap: var(--sp-9);
    margin-top: var(--sp-9);
  }
  .versions summary {
    cursor: pointer;
    font: 12px var(--font-ui);
    color: var(--text-dim);
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
