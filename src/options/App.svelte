<script lang="ts">
  import '@shared/tokens.css'
  import {
    ACCENTS,
    type Accent,
    type CredentialStatus,
    type HealthCheckMode,
    type Settings,
    type Transform,
    type UsageStore,
  } from '@shared/types'
  import { ACCENT_COLOURS } from '@shared/accents'
  import { KILL_SWITCH_LABEL, KILL_SWITCH_NOTE, killSwitchNotice, reloadTabsOf } from '@shared/kill-switch'
  import Toggle from '@sidebar/components/Toggle.svelte'
  import ProviderSettings from './ProviderSettings.svelte'
  import ExcludedSites from './ExcludedSites.svelte'
  import SiteAccess from './SiteAccess.svelte'
  import UsageSettings from './UsageSettings.svelte'
  import VaultSettings from './VaultSettings.svelte'
  import { storeKey } from './provider-add'
  import { loadVaultAndStatuses } from './vault-load'

  let settings = $state<Settings | null>(null)
  let killNotice = $state('')
  let statuses = $state<CredentialStatus[]>([])
  let vault = $state({ sealed: false, unlocked: true })
  /** Set when the credentials could not be read and the vault is not locked. */
  let loadError = $state<string | null>(null)
  let usage = $state<UsageStore>({ months: {}, transforms: {} })
  let transformNames = $state<Record<string, string>>({})

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

  async function call<T>(message: unknown): Promise<T> {
    const response = await browser.runtime.sendMessage(message)
    if (!response?.ok) throw new Error(response?.error?.message ?? 'Request failed.')
    return response.data as T
  }

  async function load() {
    const loadedSettings = await call<Settings>({ type: 'get-settings' })
    document.documentElement.dataset['accent'] = loadedSettings.accent
    // Vault state first: the statuses request fails while the vault is locked.
    const loaded = await loadVaultAndStatuses(call)
    vault = loaded.vault
    statuses = loaded.statuses
    loadError = loaded.error ?? null
    // Usage is not secret and does not depend on the vault. A failure to read
    // it leaves the section empty and does not stop the page from loading.
    try {
      usage = await call<UsageStore>({ type: 'get-usage' })
      const names: Record<string, string> = {}
      for (const id of Object.keys(usage.transforms)) {
        const found = await call<Transform | null>({ type: 'get-transform', id })
        if (found) names[id] = found.name
      }
      transformNames = names
    } catch {
      // Left as it was.
    }
    // Assigned last, so the page never renders with the initial vault value
    // below, which describes an unsealed vault, before the real one is known.
    settings = loadedSettings
  }

  /*
   * Statuses are re-read after every vault operation because they are derived
   * from the credential map, and locking makes that map unreadable — a stale
   * "Key configured" next to "Locked" would be two claims that cannot both be
   * acted on.
   */
  async function afterVault() {
    const loaded = await loadVaultAndStatuses(call)
    vault = loaded.vault
    statuses = loaded.statuses
    loadError = loaded.error ?? null
  }

  async function save(next: Settings) {
    const previous = settings?.aiJsKillSwitch
    settings = next
    document.documentElement.dataset['accent'] = next.accent
    const changed = previous !== next.aiJsKillSwitch
    const answer = await call({ type: 'save-settings', settings: next })
    killNotice = changed ? killSwitchNotice(next.aiJsKillSwitch, reloadTabsOf(answer)) : killNotice
  }

  async function setKey(providerId: string, key: string) {
    const next = await storeKey(call, providerId, key)
    if (next) statuses = next
  }

  async function clearKey(providerId: string) {
    await call({ type: 'clear-credential', providerId })
    statuses = await call<CredentialStatus[]>({ type: 'get-credential-statuses' })
  }

  /*
   * The flow runs in the background, not here. The token is a credential, and
   * credentials never pass through an extension page — see #45. This page asks
   * for the sign-in and is told whether it worked.
   */
  async function connectOAuth(providerId: string) {
    await call({ type: 'connect-oauth', providerId })
    statuses = await call<CredentialStatus[]>({ type: 'get-credential-statuses' })
  }

  $effect(() => {
    void load()
  })
</script>

<main>
  <h1>Web Alchemist settings</h1>

  {#if loadError}
    <p class="load-error" role="alert">
      The stored credentials could not be read: {loadError} The credential status below is not
      known.
    </p>
  {/if}

  {#if settings}
    <ProviderSettings
      {settings}
      {statuses}
      onsave={save}
      onsetkey={setKey}
      onreadsettings={() => call<Settings>({ type: 'get-settings' })}
      onclearkey={clearKey}
      onconnectoauth={connectOAuth}
    />

    <UsageSettings {usage} providers={settings.providers} {transformNames} />

    <VaultSettings
      {vault}
      idleMinutes={settings.vaultIdleLockMinutes}
      onidlechange={async (vaultIdleLockMinutes) => {
        if (settings) await save({ ...settings, vaultIdleLockMinutes })
      }}
      onenable={async (passphrase) => {
        await call({ type: 'enable-vault', passphrase })
        await afterVault()
      }}
      ondisable={async (passphrase) => {
        await call({ type: 'disable-vault', passphrase })
        await afterVault()
      }}
      onunlock={async (passphrase) => {
        await call({ type: 'unlock-vault', passphrase })
        await afterVault()
      }}
      onlock={async () => {
        await call({ type: 'lock-vault' })
        await afterVault()
      }}
      ondiscard={async () => {
        await call({ type: 'discard-vault' })
        await afterVault()
      }}
    />

    <SiteAccess loadTransforms={() => call<Transform[]>({ type: 'get-all-transforms' })} />

    <ExcludedSites />

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
            style="--swatch: {ACCENT_COLOURS[accent].swatch}"
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
          <h2 class="kill-title">{KILL_SWITCH_LABEL}</h2>
          <p class="subtitle">{KILL_SWITCH_NOTE}</p>
          {#if killNotice}<p class="subtitle" role="status"><strong>{killNotice}</strong></p>{/if}
        </div>
        <Toggle
          checked={settings.aiJsKillSwitch}
          label={KILL_SWITCH_LABEL}
          large
          onchange={(checked) => settings && save({ ...settings, aiJsKillSwitch: checked })}
        />
      </div>
    </section>

  {/if}
</main>

<style>
  .load-error {
    margin: 0;
    font: 12px/1.6 var(--font-ui);
    color: var(--block);
  }

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



</style>
