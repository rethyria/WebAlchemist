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
    DEFAULT_GENERATE_MODEL,
    DEFAULT_REVIEW_MODEL,
    type CredentialStatus,
    type Provider,
    type ProviderType,
    type Settings,
  } from '@shared/types'
  import Button from '@sidebar/components/Button.svelte'

  interface Props {
    settings: Settings
    statuses: CredentialStatus[]
    onsave: (settings: Settings) => Promise<void>
    onsetkey: (providerId: string, key: string) => Promise<void>
    onclearkey: (providerId: string) => Promise<void>
  }

  let { settings, statuses, onsave, onsetkey, onclearkey }: Props = $props()

  let adding = $state(false)
  let draftType = $state<ProviderType>('anthropic')
  let draftLabel = $state('')
  let draftBaseUrl = $state('')
  let draftKey = $state('')

  /** Which provider's key field is open. Only ever one at a time. */
  let editingKeyFor = $state<string | null>(null)
  let keyInput = $state('')
  let busy = $state(false)

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
  <p class="subtitle">Keys can be set and cleared here, never read back.</p>

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
              {#if status?.configured}
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
            {#if status?.configured}
              <Button small onclick={() => void onclearkey(provider.id)}>Clear</Button>
            {/if}
            <Button small onclick={() => void removeProvider(provider)}>Remove</Button>
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

  .subtitle {
    margin: -6px 0 0;
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-faint);
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

  .key-field {
    display: flex;
    gap: var(--sp-6);
  }

  .key-field input {
    flex: 1;
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
