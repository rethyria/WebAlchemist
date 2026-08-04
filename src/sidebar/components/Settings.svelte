<script lang="ts">
  /**
   * Settings inside the panel, as the design has it.
   *
   * This is deliberately not the whole settings page. It carries what someone
   * changes while looking at a site — accent, how often things are checked,
   * the kill switch — and links out for the rest. Adding a provider needs a
   * form, a key field and room to read a disclosure, which is a poor fit for a
   * 320px column.
   */
  import { ACCENTS, type Accent, type CredentialStatus, type HealthCheckMode, type Settings } from '@shared/types'
  import { ACCENT_COLOURS } from '@shared/accents'
  import Label from './Label.svelte'
  import Toggle from './Toggle.svelte'

  interface Props {
    settings: Settings
    statuses: CredentialStatus[]
    onsave: (settings: Settings) => void
    onfullpage: () => void
  }

  let { settings, statuses, onsave, onfullpage }: Props = $props()


  const HEALTH_MODES: { value: HealthCheckMode; label: string; note?: string }[] = [
    { value: 'every-load', label: 'Every page load', note: 'default' },
    { value: 'once-per-session', label: 'Once per site per session' },
    { value: 'manual', label: 'Manual only' },
  ]

  let active = $derived(settings.providers.find((p) => p.id === settings.activeProviderId))
  let activeStatus = $derived(statuses.find((s) => s.providerId === active?.id))
</script>

<div class="panel">
  <section>
    <Label>Accent colour</Label>
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
          onclick={() => onsave({ ...settings, accent })}
        ></button>
      {/each}
      <span class="hex">{ACCENT_COLOURS[settings.accent].swatch}</span>
    </div>
  </section>

  <section>
    <Label>Provider</Label>
    {#if active}
      <div class="card">
        <div class="card-head">
          <span class="card-title">{active.label}</span>
          <span class="chip">ACTIVE</span>
        </div>
        <span class="mono">
          {active.type === 'anthropic' ? 'api.anthropic.com' : (active.baseUrl ?? '')} ·
          {activeStatus?.kind === 'oauth' ? 'oauth' : 'api key'}
        </span>
        <span class="state">
          {activeStatus?.configured ? 'Key configured' : 'No credential'}
        </span>
      </div>
      <div class="models">
        <div class="model">
          <span class="model-role">Writes the code</span>
          <span class="mono">{active.generateModel}</span>
        </div>
        <div class="model">
          <span class="model-role">Reviews the code</span>
          <span class="mono">{active.reviewModel}</span>
          <span class="model-note">code and intent only</span>
        </div>
      </div>
    {:else}
      <p class="note">
        No provider is set up. Nothing can be generated until one is.
      </p>
      <button type="button" class="link" onclick={onfullpage}>Add a provider →</button>
    {/if}
  </section>

  <section>
    <Label>Check for broken transforms</Label>
    <div class="modes" role="radiogroup" aria-label="Check for broken transforms">
      {#each HEALTH_MODES as mode}
        <button
          type="button"
          role="radio"
          aria-checked={settings.healthCheckMode === mode.value}
          class="mode"
          class:selected={settings.healthCheckMode === mode.value}
          onclick={() => onsave({ ...settings, healthCheckMode: mode.value })}
        >
          <span class="dot" aria-hidden="true"></span>
          <span class="mode-label">{mode.label}</span>
          {#if mode.note}<span class="mode-note">{mode.note}</span>{/if}
        </button>
      {/each}
    </div>
  </section>

  <!--
    The grant screenshots need is all-sites, because captureVisibleTab accepts
    nothing narrower. Keeping it means never being asked again; it also means
    the per-site prompts stop appearing, since an all-sites grant satisfies
    them. Said here rather than discovered later.
  -->
  <div class="kill">
    <div class="kill-text">
      <span class="card-title">Keep screenshot permission</span>
      <span class="note">
        Screenshots need access to all sites. Kept on, you are not asked again —
        and you stop being asked per site when saving transforms too.
      </span>
    </div>
    <Toggle
      checked={settings.keepScreenshotPermission}
      label="Keep screenshot permission"
      onchange={(keepScreenshotPermission) =>
        onsave({ ...settings, keepScreenshotPermission })}
    />
  </div>

  <div class="kill">
    <div class="kill-text">
      <span class="card-title">Stop running AI-written JavaScript</span>
      <span class="note">Immediately, on every site. CSS keeps working.</span>
    </div>
    <Toggle
      checked={settings.aiJsKillSwitch}
      label="Stop running AI-written JavaScript"
      onchange={(checked) => onsave({ ...settings, aiJsKillSwitch: checked })}
    />
  </div>

  <div class="disclosure">
    <span class="card-title">Where your keys are stored</span>
    <span class="note">
      Plain text in this browser profile. Browsers give extensions no keychain, so
      file permissions on the profile directory are the only protection.
    </span>
  </div>

  <footer>
    <button type="button" class="link" onclick={onfullpage}>
      Open the full settings page →
    </button>
    <span class="note">Adding providers, and export / import, live there.</span>
  </footer>
</div>

<style>
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 14px;
    padding: var(--gutter-sidebar);
    overflow-y: auto;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
  }

  .swatches {
    display: flex;
    align-items: center;
    gap: var(--sp-9);
    padding: 2px;
  }

  .swatch {
    width: 16px;
    height: 16px;
    flex: none;
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

  .hex {
    margin-left: auto;
    font: 10.5px var(--font-mono);
    color: var(--text-faint);
  }

  .note {
    margin: 0;
    font: 11px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    padding: var(--sp-11);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface-raised);
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: var(--sp-7);
  }

  .card-title {
    font: 600 12px var(--font-ui);
  }

  .chip {
    padding: 2px 5px;
    border-radius: var(--r-badge);
    background: var(--accent-chip);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.05em;
    color: var(--accent-fg);
  }

  .mono {
    font: 11px var(--font-mono);
    color: var(--text-faint);
    overflow-wrap: anywhere;
  }

  .state {
    font: 11.5px var(--font-ui);
    color: var(--text-dim);
  }

  .models {
    display: flex;
    flex-direction: column;
    gap: var(--sp-6);
  }

  .model {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-button);
    background: var(--surface-sunken);
  }

  .model-role,
  .model-note {
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  .modes {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .mode {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .mode.selected {
    border-color: var(--accent-fg);
    background: var(--accent-wash);
  }

  .dot {
    width: 12px;
    height: 12px;
    flex: none;
    box-sizing: border-box;
    border: 1.5px solid var(--border-strong);
    border-radius: 50%;
  }

  .mode.selected .dot {
    border: 4px solid var(--accent-fg);
    background: var(--surface-sunken);
  }

  .mode-label {
    font: 12px var(--font-ui);
    color: var(--text);
  }

  .mode-note {
    margin-left: auto;
    font: 10.5px var(--font-ui);
    color: var(--text-faint);
  }

  .kill {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: var(--sp-11);
    border: 1px solid rgb(from var(--block) r g b / 0.35);
    border-radius: var(--r-card);
    background: rgb(from var(--block) r g b / 0.06);
  }

  .kill-text {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .disclosure {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    padding-left: 10px;
    border-left: 3px solid var(--neutral);
  }

  footer {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
    margin-top: auto;
    padding-top: var(--sp-11);
    border-top: 1px solid var(--border-subtle);
  }

  .link {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    font: 11.5px var(--font-ui);
    color: var(--accent-fg);
    cursor: pointer;
  }
</style>
