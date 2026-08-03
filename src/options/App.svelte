<script lang="ts">
  import '@shared/tokens.css'
  import {
    ACCENTS,
    type Accent,
    type CredentialStatus,
    type HealthCheckMode,
    type Settings,
  } from '@shared/types'
  import Toggle from '@sidebar/components/Toggle.svelte'

  let settings = $state<Settings | null>(null)
  let statuses = $state<CredentialStatus[]>([])

  const HEALTH_MODES: { value: HealthCheckMode; label: string; note: string }[] = [
    { value: 'every-load', label: 'Every page load', note: 'Default' },
    { value: 'once-per-session', label: 'Once per site per session', note: 'Cheaper' },
    { value: 'manual', label: 'Manual only', note: 'Nothing runs on its own' },
  ]

  /*
   * Swatch fill for the picker dots, in the design's drawn order. The applied
   * accent comes from tokens.css; this is only what the dot looks like.
   *
   * Mono is drawn as its dark-theme value, which is the one being previewed.
   */
  const SWATCH: Record<Accent, string> = {
    red: '#c92a2a',
    orange: '#c2410c',
    amber: '#ffd43b',
    green: '#1f7a33',
    blue: '#0060df',
    indigo: '#4338ca',
    violet: '#7c3aed',
    mono: '#f5f3f0',
  }

  /* The design allows these but says a broken transform is harder to spot. */
  const NEAR_STATUS_HUE = new Set<Accent>(['red', 'orange', 'amber'])

  async function call<T>(message: unknown): Promise<T> {
    const response = await browser.runtime.sendMessage(message)
    if (!response?.ok) throw new Error(response?.error?.message ?? 'Request failed.')
    return response.data as T
  }

  async function load() {
    settings = await call<Settings>({ type: 'get-settings' })
    document.documentElement.dataset['accent'] = settings.accent
    statuses = await call<CredentialStatus[]>({ type: 'get-credential-statuses' })
  }

  async function save(next: Settings) {
    settings = next
    document.documentElement.dataset['accent'] = next.accent
    await call({ type: 'save-settings', settings: next })
  }

  function statusFor(providerId: string): CredentialStatus | undefined {
    return statuses.find((s) => s.providerId === providerId)
  }

  $effect(() => {
    void load()
  })
</script>

<main>
  <h1>WebAlchemist settings</h1>

  {#if settings}
    <section>
      <h2>Providers</h2>
      <p class="subtitle">Keys can be set and cleared here, never read back.</p>

      {#if settings.providers.length === 0}
        <p class="empty">No provider is set up yet.</p>
      {:else}
        <ul class="providers">
          {#each settings.providers as provider (provider.id)}
            {@const status = statusFor(provider.id)}
            <li>
              <div class="provider-id">
                <span class="provider-label">{provider.label}</span>
                {#if provider.id === settings.activeProviderId}
                  <span class="chip">ACTIVE</span>
                {/if}
                <span class="provider-host">
                  {provider.baseUrl ?? 'api.anthropic.com'} · {status?.kind === 'oauth'
                    ? 'OAuth'
                    : 'API key'}
                </span>
              </div>
              <div class="provider-state">
                {#if status?.configured}
                  <span class="ok-text">Key configured</span>
                  <button type="button" class="secondary">Replace key</button>
                  <button type="button" class="secondary">Clear</button>
                {:else}
                  <span class="warn-text">No credential</span>
                  <button type="button" class="primary">Set key</button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2>Accent</h2>
      <div class="swatches" role="radiogroup" aria-label="Accent colour">
        {#each ACCENTS as accent}
          <button
            type="button"
            role="radio"
            aria-checked={settings.accent === accent}
            aria-label={accent}
            class="swatch"
            class:selected={settings.accent === accent}
            style="--swatch: {SWATCH[accent]}"
            onclick={() => settings && save({ ...settings, accent })}
          ></button>
        {/each}
      </div>
      <p class="subtitle">
        Buttons, selection, and the picker outline. The last one is monochrome —
        white in the dark theme, near-black in the light one.
        {#if NEAR_STATUS_HUE.has(settings.accent)}
          <span class="warn-text">
            Red, orange and amber sit next to the status hues — a broken transform is
            harder to spot with this picked.
          </span>
        {/if}
      </p>
    </section>

    <section>
      <h2>Health check</h2>
      <div class="radios">
        {#each HEALTH_MODES as mode}
          <button
            type="button"
            role="radio"
            aria-checked={settings.healthCheckMode === mode.value}
            class="radio-card"
            class:selected={settings.healthCheckMode === mode.value}
            onclick={() =>
              settings && save({ ...settings, healthCheckMode: mode.value })}
          >
            <span class="radio-dot"></span>
            <span class="radio-label">{mode.label}</span>
            <span class="radio-note">{mode.note}</span>
          </button>
        {/each}
      </div>
    </section>

    <section>
      <div class="kill">
        <div>
          <h2 class="kill-title">Stop running AI-written JavaScript</h2>
          <p class="subtitle">
            Takes effect immediately on every site. CSS transforms keep working.
          </p>
        </div>
        <Toggle
          checked={settings.aiJsKillSwitch}
          label="Stop running AI-written JavaScript"
          large
          onchange={(checked) => settings && save({ ...settings, aiJsKillSwitch: checked })}
        />
      </div>
    </section>

    <section class="disclosure">
      <h2>How your credentials are stored</h2>
      <p>
        Keys are stored as plain text in this browser profile's directory. Browsers offer
        extensions no access to the operating system keychain, so this data is protected
        by file permissions and nothing else. Anyone who can read your profile directory
        can read these keys.
      </p>
    </section>
  {/if}
</main>

<style>
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: var(--sp-26) var(--gutter-settings);
    display: flex;
    flex-direction: column;
    gap: var(--sp-26);
  }

  h1 {
    margin: 0;
    font: 600 18px var(--font-ui);
  }

  h2 {
    margin: 0 0 var(--sp-5);
    font: 600 13.5px var(--font-ui);
  }

  .subtitle,
  .empty {
    margin: 0;
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .providers {
    margin: var(--sp-11) 0 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }

  .providers li {
    display: flex;
    align-items: center;
    gap: var(--sp-12);
    padding: var(--sp-11) var(--sp-13);
    border-bottom: 1px solid var(--border-subtle);
  }

  .providers li:last-child {
    border-bottom: none;
  }

  .provider-label {
    font: 13px var(--font-ui);
  }

  .provider-host {
    display: block;
    margin-top: var(--sp-3);
    font: 11.5px var(--font-mono);
    color: var(--text-faint);
  }

  .chip {
    margin-left: var(--sp-6);
    padding: 2px 5px;
    border-radius: var(--r-badge);
    background: var(--accent-wash);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--accent);
  }

  .provider-state {
    display: flex;
    align-items: center;
    gap: var(--sp-6);
    margin-left: auto;
  }

  .ok-text {
    font: 11.5px var(--font-ui);
    color: var(--text-dim);
  }

  .warn-text {
    font: 11.5px var(--font-ui);
    color: var(--attention);
  }

  .swatches {
    display: flex;
    gap: var(--sp-9);
    margin: var(--sp-9) 0;
  }

  .swatch {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    cursor: pointer;
  }

  .swatch.selected {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3.5px var(--swatch);
  }

  .radios {
    display: flex;
    gap: var(--sp-9);
  }

  .radio-card {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--sp-7);
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }

  .radio-card.selected {
    border-color: var(--accent);
    background: var(--accent-wash);
  }

  .radio-dot {
    width: 12px;
    height: 12px;
    flex: none;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
  }

  .radio-card.selected .radio-dot {
    border: 4px solid var(--accent);
    background: var(--surface);
  }

  .radio-label {
    font: 12.5px var(--font-ui);
  }

  .radio-note {
    margin-left: auto;
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  .kill {
    display: flex;
    align-items: center;
    gap: var(--sp-16);
    padding: var(--sp-12) var(--sp-13);
    border: 1px solid rgb(from var(--block) r g b / 0.4);
    border-radius: var(--r-card);
    background: rgb(from var(--block) r g b / 0.07);
  }

  .kill-title {
    margin: 0 0 var(--sp-3);
  }

  .disclosure {
    max-width: 600px;
    padding-left: var(--sp-13);
    border-left: 3px solid var(--neutral);
  }

  .disclosure p {
    margin: 0;
    font: 12px/1.6 var(--font-ui);
    color: var(--text-dim);
  }

  button.primary,
  button.secondary {
    padding: 6px 10px;
    border-radius: var(--r-button);
    font: 600 11.5px var(--font-ui);
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
