<script lang="ts">
  /**
   * A select over known models, with an escape hatch to type any id.
   *
   * The escape hatch is not decoration. An OpenAI-compatible endpoint can
   * serve anything it likes, and a picker that only offered Anthropic's
   * catalogue would make those providers unusable.
   */
  import { ANTHROPIC_MODELS } from '@shared/types'

  interface Props {
    label: string
    hint?: string
    value: string
    onchange: (model: string) => void
  }

  let { label, hint, value, onchange }: Props = $props()

  const CUSTOM = '__custom__'

  let known = $derived(ANTHROPIC_MODELS.find((m) => m.id === value))
  /* Sticky once opened, so the field does not vanish mid-typing. */
  let custom = $state(false)
  let showCustom = $derived(custom || (!known && value.length > 0))

  function onSelect(event: Event) {
    const chosen = (event.currentTarget as HTMLSelectElement).value
    if (chosen === CUSTOM) {
      custom = true
      return
    }
    custom = false
    onchange(chosen)
  }
</script>

<div class="picker">
  <span class="label">{label}</span>

  <select value={showCustom ? CUSTOM : value} onchange={onSelect}>
    {#each ANTHROPIC_MODELS as model}
      <option value={model.id}>{model.label}</option>
    {/each}
    <option value={CUSTOM}>Other…</option>
  </select>

  {#if showCustom}
    <input
      type="text"
      {value}
      placeholder="model id"
      autocomplete="off"
      spellcheck="false"
      onchange={(event) => onchange(event.currentTarget.value.trim())}
    />
  {/if}

  <span class="meta">
    {#if known}{known.price} per Mtok{#if !known.vision} · no images{/if}{:else}
      not a known model — cost and image support unknown
    {/if}{#if hint} · {hint}{/if}
  </span>
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

  select,
  input {
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-button);
    background: var(--surface-sunken);
    font: 11.5px var(--font-mono);
    color: var(--text);
  }

  select:focus,
  input:focus {
    border-color: var(--accent-fg);
    outline: none;
  }

  .meta {
    font: 10.5px var(--font-mono);
    color: var(--text-faint);
  }
</style>
