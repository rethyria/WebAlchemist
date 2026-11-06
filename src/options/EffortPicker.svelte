<script lang="ts">
  import { t } from '@shared/i18n'
  /**
   * A select over the reasoning effort choices of a provider. The labels are
   * looked up here so that the page passes only the stored value.
   */
  import { EFFORT_CHOICES, type EffortChoice } from '@shared/effort'

  interface Props {
    label: string
    hint?: string
    value: EffortChoice
    onchange: (effort: EffortChoice) => void
  }

  let { label, hint, value, onchange }: Props = $props()

  const NAMES = {
    low: 'optEffortLow',
    medium: 'optEffortMedium',
    high: 'optEffortHigh',
    default: 'optEffortDefault',
  } as const
</script>

<div class="picker">
  <span class="label">{label}</span>

  <select
    {value}
    onchange={(event) => onchange(event.currentTarget.value as EffortChoice)}
  >
    {#each EFFORT_CHOICES as choice}
      <option value={choice}>{t(NAMES[choice])}</option>
    {/each}
  </select>

  {#if hint}<span class="meta">{hint}</span>{/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    min-width: 0;
  }

  .label {
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  select {
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-button);
    background: var(--surface-sunken);
    font: 11.5px var(--font-mono);
    color: var(--text);
  }

  select:focus {
    border-color: var(--accent-fg);
    outline: none;
  }

  .meta {
    font: 10.5px var(--font-mono);
    color: var(--text-faint);
  }
</style>
