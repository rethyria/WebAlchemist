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
  import ProviderSettings from './ProviderSettings.svelte'

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

  async function setKey(providerId: string, key: string) {
    await call({
      type: 'set-credential',
      providerId,
      credential: { kind: 'api_key', value: key },
    })
    statuses = await call<CredentialStatus[]>({ type: 'get-credential-statuses' })
  }

  async function clearKey(providerId: string) {
    await call({ type: 'clear-credential', providerId })
    statuses = await call<CredentialStatus[]>({ type: 'get-credential-statuses' })
  }

  $effect(() => {
    void load()
  })
</script>

<main>
  <h1>Web Alchemist settings</h1>

  {#if settings}
    <ProviderSettings
      {settings}
      {statuses}
      onsave={save}
      onsetkey={setKey}
      onclearkey={clearKey}
    />

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

  .subtitle {
    margin: 0;
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-faint);
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
    border-color: var(--accent-fg);
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
    border: 4px solid var(--accent-fg);
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

</style>
