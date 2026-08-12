<script lang="ts">
  /**
   * Provider and credential management.
   *
   * The credential field is write-only, and that is a property of the whole
   * design rather than a choice made here: there is no message that returns a
   * credential value, so this component could not display an existing key even
   * if it wanted to. It shows whether one is configured, and nothing else.
   *
   * The field is therefore always empty on open. Typing into it replaces
   * whatever is stored; leaving it alone changes nothing.
   */
  import {
    ANTHROPIC_MODELS,
    DEFAULT_GENERATE_MODEL,
    DEFAULT_REVIEW_MODEL,
    type CredentialStatus,
    type Provider,
    type ProviderType,
    type Settings,
  } from '@shared/types'
  import ModelPicker from './ModelPicker.svelte'
  import Button from '@sidebar/components/Button.svelte'

  interface Props {
    settings: Settings
    statuses: CredentialStatus[]
    onsave: (settings: Settings) => Promise<void>
    onsetkey: (providerId: string, key: string) => Promise<void>
    onclearkey: (providerId: string) => Promise<void>
    onconnectoauth: (providerId: string) => Promise<void>
  }

  let { settings, statuses, onsave, onsetkey, onclearkey, onconnectoauth }: Props = $props()

  let adding = $state(false)
  let draftType = $state<ProviderType>('anthropic')
  let draftLabel = $state('')
  let draftBaseUrl = $state('')
  let draftKey = $state('')

  /** Which provider's key field is open. Only ever one at a time. */
  let editingKeyFor = $state<string | null>(null)
  let keyInput = $state('')
  let busy = $state(false)

  /*
   * Sign-in, for providers that offer it.
   *
   * Four fields typed by hand rather than discovered. There is no registry, and
   * the discovery document that would carry them is an OpenID Connect
   * convention most OpenAI-compatible endpoints do not publish — so asking for
   * what the provider's own documentation states beats a lookup that works for
   * a minority and fails opaquely for everyone else.
   */
  let editingOAuthFor = $state<string | null>(null)
  let oauthDraft = $state({
    authorizationEndpoint: '',
    tokenEndpoint: '',
    clientId: '',
    scopes: '',
  })
  let oauthError = $state<string | null>(null)

  /*
   * The provider needs this registered before the flow will work, and getting
   * it wrong is the most likely reason a first attempt fails — so it is shown
   * rather than left to be discovered from an error page.
   */
  let redirectUrl = $derived.by(() => {
    try {
      return browser.identity.getRedirectURL()
    } catch {
      // `identity` is a required permission, so this should not happen. Saying
      // so beats rendering "undefined" next to "register this with your
      // provider".
      return 'unavailable — the identity permission is missing'
    }
  })

  function openOAuth(provider: Provider): void {
    editingOAuthFor = editingOAuthFor === provider.id ? null : provider.id
    oauthError = null
    oauthDraft = {
      authorizationEndpoint: provider.oauth?.authorizationEndpoint ?? '',
      tokenEndpoint: provider.oauth?.tokenEndpoint ?? '',
      clientId: provider.oauth?.clientId ?? '',
      scopes: (provider.oauth?.scopes ?? []).join(' '),
    }
  }

  let oauthDraftValid = $derived(
    isValidUrl(oauthDraft.authorizationEndpoint) &&
      isValidUrl(oauthDraft.tokenEndpoint) &&
      oauthDraft.clientId.trim().length > 0,
  )

  /**
   * Saves the endpoints, then runs the flow.
   *
   * No permission request, unlike every other capability here. `identity` is
   * not in Firefox's optional-permission set — the manifest is refused if it is
   * declared there — so it is held from install and there is nothing to ask
   * for. See the note in `background/oauth.ts`.
   */
  async function connectOAuth(provider: Provider): Promise<void> {
    oauthError = null
    busy = true
    try {
      const oauth = {
        authorizationEndpoint: oauthDraft.authorizationEndpoint.trim(),
        tokenEndpoint: oauthDraft.tokenEndpoint.trim(),
        clientId: oauthDraft.clientId.trim(),
        scopes: oauthDraft.scopes.split(/\s+/).filter(Boolean),
      }
      await onsave({
        ...settings,
        providers: settings.providers.map((p) => (p.id === provider.id ? { ...p, oauth } : p)),
      })

      await onconnectoauth(provider.id)
      editingOAuthFor = null
    } catch (cause) {
      oauthError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  const TYPES: { value: ProviderType; label: string; hint: string }[] = [
    { value: 'anthropic', label: 'Anthropic', hint: 'api.anthropic.com' },
    {
      value: 'openai-compatible',
      label: 'OpenAI-compatible',
      hint: 'Any endpoint speaking the OpenAI chat API',
    },
  ]

  let draftValid = $derived(
    draftLabel.trim().length > 0 &&
      draftKey.trim().length > 0 &&
      (draftType === 'anthropic' || isValidUrl(draftBaseUrl)),
  )

  function isValidUrl(value: string): boolean {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' || url.hostname === 'localhost'
    } catch {
      return false
    }
  }

  function statusFor(providerId: string): CredentialStatus | undefined {
    return statuses.find((s) => s.providerId === providerId)
  }

  function hostFor(provider: Provider): string {
    if (provider.type === 'anthropic') return 'api.anthropic.com'
    try {
      return new URL(provider.baseUrl ?? '').host
    } catch {
      return provider.baseUrl ?? 'not set'
    }
  }

  function resetDraft() {
    adding = false
    draftType = 'anthropic'
    draftLabel = ''
    draftBaseUrl = ''
    draftKey = ''
  }

  async function addProvider() {
    if (!draftValid || busy) return
    busy = true
    try {
      const provider: Provider = {
        id: crypto.randomUUID(),
        label: draftLabel.trim(),
        type: draftType,
        ...(draftType === 'openai-compatible'
          ? { baseUrl: draftBaseUrl.trim() }
          : {}),
        generateModel: DEFAULT_GENERATE_MODEL,
        reviewModel: DEFAULT_REVIEW_MODEL,
        // Anthropic resolves this live from the models endpoint. For an
        // arbitrary endpoint there is no equivalent, so it starts off and the
        // screenshot option stays hidden until it is turned on by hand.
        supportsVision: draftType === 'anthropic',
      }

      // The credential is written first. A provider listed without one is a
      // dead entry the user has to notice and fix; the reverse cannot happen.
      await onsetkey(provider.id, draftKey.trim())
      await onsave({
        ...settings,
        providers: [...settings.providers, provider],
        activeProviderId: settings.activeProviderId ?? provider.id,
      })
      resetDraft()
    } finally {
      busy = false
    }
  }

  async function saveKey(providerId: string) {
    if (!keyInput.trim() || busy) return
    busy = true
    try {
      await onsetkey(providerId, keyInput.trim())
      keyInput = ''
      editingKeyFor = null
    } finally {
      busy = false
    }
  }

  async function setModel(
    provider: Provider,
    field: 'generateModel' | 'reviewModel',
    model: string,
  ) {
    const next = { ...provider, [field]: model }

    // Vision support gates the screenshot toggle, so it has to follow the
    // generation model. For Anthropic the list knows; for an arbitrary
    // endpoint there is nothing to ask, so an unlisted model keeps whatever
    // was set rather than being silently turned off.
    if (field === 'generateModel') {
      const known = ANTHROPIC_MODELS.find((m) => m.id === model)
      if (known) next.supportsVision = known.vision
    }

    await onsave({
      ...settings,
      providers: settings.providers.map((p) => (p.id === provider.id ? next : p)),
    })
  }

  async function removeProvider(provider: Provider) {
    if (busy) return
    busy = true
    try {
      await onclearkey(provider.id)
      const remaining = settings.providers.filter((p) => p.id !== provider.id)
      await onsave({
        ...settings,
        providers: remaining,
        activeProviderId:
          settings.activeProviderId === provider.id
            ? (remaining[0]?.id ?? null)
            : settings.activeProviderId,
      })
    } finally {
      busy = false
    }
  }
</script>

<section>
  <h2>Providers</h2>

  {#if settings.providers.length === 0 && !adding}
    <div class="none">
      <p>
        No provider is set up. Nothing can be generated until one is — Anthropic,
        or any endpoint speaking the OpenAI chat API.
      </p>
      <Button variant="primary" small onclick={() => (adding = true)}>
        Add a provider
      </Button>
    </div>
  {:else}
    <ul class="providers">
      {#each settings.providers as provider (provider.id)}
        {@const status = statusFor(provider.id)}
        {@const active = provider.id === settings.activeProviderId}
        <li>
          <div class="row">
            <div class="identity">
              <div class="name-line">
                <span class="name">{provider.label}</span>
                {#if active}<span class="chip">ACTIVE</span>{/if}
              </div>
              <span class="host">
                {hostFor(provider)} · {status?.kind === 'oauth' ? 'OAuth' : 'API key'}
              </span>
            </div>

            <div class="state">
              {#if status?.configured && status.kind === 'oauth'}
                <span class="configured">Signed in</span>
                {#if status.expiresAt}
                  <!--
                    Shown because a token dies on a schedule and a key does not.
                    Refresh happens a minute ahead of this automatically; the
                    date is here so an expiry that cannot be refreshed does not
                    arrive as an unexplained failure mid-generation.
                  -->
                  <span class="expiry">until {new Date(status.expiresAt).toLocaleString()}</span>
                {/if}
              {:else if status?.configured}
                <span class="configured">Key configured</span>
              {:else}
                <span class="missing">No credential</span>
              {/if}
            </div>
          </div>

          <div class="actions">
            {#if !active}
              <Button
                small
                onclick={() =>
                  void onsave({ ...settings, activeProviderId: provider.id })}
              >
                Make active
              </Button>
            {/if}
            <Button
              small
              onclick={() => {
                editingKeyFor = editingKeyFor === provider.id ? null : provider.id
                keyInput = ''
              }}
            >
              {status?.configured ? 'Replace key' : 'Set key'}
            </Button>
            {#if provider.type !== 'anthropic'}
              <!--
                Anthropic is absent by design, not by oversight. Anthropic
                restricted OAuth to Claude Code and Claude.ai and disabled
                third-party tokens, so a sign-in button here would either fail
                or work by impersonating another application. The background
                refuses it as well, so hiding the button is not the only guard.
              -->
              <Button small onclick={() => openOAuth(provider)}>
                {provider.oauth ? 'Sign-in settings' : 'Use sign-in instead'}
              </Button>
            {/if}
            {#if status?.configured}
              <Button small onclick={() => void onclearkey(provider.id)}>Clear</Button>
            {/if}
            <Button small onclick={() => void removeProvider(provider)}>Remove</Button>
          </div>

          <div class="models">
            <ModelPicker
              label="Writes the code"
              value={provider.generateModel}
              onchange={(model) => void setModel(provider, 'generateModel', model)}
            />
            <ModelPicker
              label="Reviews the code"
              hint="code and intent only"
              value={provider.reviewModel}
              onchange={(model) => void setModel(provider, 'reviewModel', model)}
            />
          </div>

          {#if editingKeyFor === provider.id}
            <div class="key-field">
              <input
                type="password"
                bind:value={keyInput}
                placeholder={status?.configured
                  ? 'New key — replaces the stored one'
                  : 'Paste the key'}
                autocomplete="off"
                spellcheck="false"
                onkeydown={(event) => {
                  if (event.key === 'Enter') void saveKey(provider.id)
                }}
              />
              <Button
                variant="primary"
                small
                disabled={!keyInput.trim() || busy}
                onclick={() => void saveKey(provider.id)}
              >
                Save
              </Button>
            </div>
          {/if}

          {#if editingOAuthFor === provider.id}
            <div class="oauth">
              <p class="explain">
                From the provider's own documentation. Web Alchemist opens their
                sign-in page and stores the token it returns; the token is held
                the same way an API key is and never reaches this page.
              </p>
              <label>
                Authorization endpoint
                <input
                  bind:value={oauthDraft.authorizationEndpoint}
                  placeholder="https://provider.example/oauth/authorize"
                  spellcheck="false"
                  autocomplete="off"
                />
              </label>
              <label>
                Token endpoint
                <input
                  bind:value={oauthDraft.tokenEndpoint}
                  placeholder="https://provider.example/oauth/token"
                  spellcheck="false"
                  autocomplete="off"
                />
              </label>
              <label>
                Client ID
                <input bind:value={oauthDraft.clientId} spellcheck="false" autocomplete="off" />
              </label>
              <label>
                Scopes
                <input
                  bind:value={oauthDraft.scopes}
                  placeholder="space separated, or leave empty"
                  spellcheck="false"
                  autocomplete="off"
                />
              </label>
              <p class="explain">
                Register <code>{redirectUrl}</code> as the redirect URI with the provider.
              </p>
              {#if oauthError}
                <p class="oauth-error">{oauthError}</p>
              {/if}
              <Button
                variant="primary"
                small
                disabled={!oauthDraftValid || busy}
                onclick={() => void connectOAuth(provider)}
              >
                {busy ? 'Waiting for the provider…' : 'Sign in'}
              </Button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    {#if !adding}
      <Button small onclick={() => (adding = true)}>Add another provider</Button>
    {/if}
  {/if}

  {#if adding}
    <div class="add">
      <div class="types">
        {#each TYPES as type}
          <button
            type="button"
            role="radio"
            aria-checked={draftType === type.value}
            class="type"
            class:selected={draftType === type.value}
            onclick={() => (draftType = type.value)}
          >
            <span class="type-label">{type.label}</span>
            <span class="type-hint">{type.hint}</span>
          </button>
        {/each}
      </div>

      <label>
        <span class="field-label">Name</span>
        <input
          type="text"
          bind:value={draftLabel}
          placeholder={draftType === 'anthropic' ? 'Anthropic' : 'Local llama.cpp'}
          autocomplete="off"
        />
      </label>

      {#if draftType === 'openai-compatible'}
        <label>
          <span class="field-label">Base URL</span>
          <input
            type="url"
            bind:value={draftBaseUrl}
            placeholder="https://example.com/v1"
            autocomplete="off"
            spellcheck="false"
          />
          {#if draftBaseUrl && !isValidUrl(draftBaseUrl)}
            <span class="field-error">
              Needs to be an https URL, or localhost.
            </span>
          {/if}
        </label>
      {/if}

      <label>
        <span class="field-label">API key</span>
        <input
          type="password"
          bind:value={draftKey}
          placeholder="Paste the key"
          autocomplete="off"
          spellcheck="false"
        />
        <span class="field-note">
          Stored as plain text in this browser profile — see below.
        </span>
      </label>

      <div class="add-actions">
        <Button small onclick={resetDraft}>Cancel</Button>
        <Button
          variant="primary"
          small
          disabled={!draftValid || busy}
          onclick={() => void addProvider()}
        >
          Add provider
        </Button>
      </div>
    </div>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-9);
  }

  h2 {
    margin: 0;
    font: 600 13.5px var(--font-ui);
  }

  .none {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-11);
    padding: var(--sp-13);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }

  .none p {
    margin: 0;
    max-width: 46ch;
    font: 12px/1.6 var(--font-ui);
    color: var(--text-dim);
  }

  .providers {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }

  .providers li {
    display: flex;
    flex-direction: column;
    gap: var(--sp-9);
    padding: var(--sp-12) var(--sp-13);
    border-bottom: 1px solid var(--border-subtle);
  }

  .providers li:last-child {
    border-bottom: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-12);
  }

  .identity {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    min-width: 0;
  }

  .name-line {
    display: flex;
    align-items: center;
    gap: var(--sp-6);
  }

  .name {
    font: 13px var(--font-ui);
  }

  .chip {
    padding: 2px 5px;
    border-radius: var(--r-badge);
    background: var(--accent-chip);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--accent-fg);
  }

  .host {
    font: 11.5px var(--font-mono);
    color: var(--text-faint);
  }

  .state {
    margin-left: auto;
    font: 11.5px var(--font-ui);
  }

  .configured {
    color: var(--text-dim);
  }

  .missing {
    color: var(--attention);
  }

  .actions,
  .add-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-6);
  }

  .models {
    display: flex;
    gap: var(--sp-9);
  }

  .models :global(> *) {
    flex: 1;
  }

  .key-field {
    display: flex;
    gap: var(--sp-6);
  }

  .key-field input {
    flex: 1;
  }

  .expiry {
    display: block;
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  .oauth {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
    padding: var(--sp-11) var(--sp-13);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface-sunken);
  }

  .oauth label {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .oauth input {
    font: 12px var(--font-mono);
    text-transform: none;
    letter-spacing: normal;
  }

  .oauth .explain {
    margin: 0;
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-dim);
  }

  .oauth code {
    font: 11px var(--font-mono);
    color: var(--text);
    word-break: break-all;
  }

  .oauth-error {
    margin: 0;
    font: 12px/1.5 var(--font-ui);
    color: var(--attention);
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: var(--sp-11);
    padding: var(--sp-13);
    border: 1px solid var(--accent-fg);
    border-radius: var(--r-card);
  }

  .types {
    display: flex;
    gap: var(--sp-9);
  }

  .type {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--sp-3);
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .type.selected {
    border-color: var(--accent-fg);
    background: var(--accent-wash);
  }

  .type-label {
    font: 600 12.5px var(--font-ui);
    color: var(--text);
  }

  .type-hint {
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .field-label {
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .field-note,
  .field-error {
    font: 11px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .field-error {
    color: var(--attention);
  }

  input {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 12.5px var(--font-ui);
    color: var(--text);
  }

  input:focus {
    border-color: var(--accent-fg);
    outline: none;
  }
</style>
