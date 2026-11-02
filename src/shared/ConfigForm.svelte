<script lang="ts">
  /**
   * The form for the values of an elixir's settings, used by the sidebar row
   * and by the editor page. It edits a copy of the effective values and hands
   * the result to `onsave` as the values to set and the keys that go back to
   * their default. Every value is checked with the same rules the background
   * applies (config.ts), and the background checks it again.
   *
   * Labels and help texts were written by a model, so they are rendered as
   * plain text only.
   */
  import { CONFIG_LIMITS } from './config'
  import {
    addItem,
    addRow,
    defaultDraft,
    draftChanges,
    draftProblems,
    makeDraft,
    removeAt,
    type Draft,
  } from './config-draft'
  import { t } from './i18n'
  import type { ConfigField, ConfigValue } from './types'

  interface Props {
    fields: ConfigField[]
    /** The effective values: the user's value where set, the default otherwise. */
    values: Record<string, ConfigValue>
    busy?: boolean
    onsave: (values: Record<string, ConfigValue>, reset: string[]) => void
    /** Absent where the form is always shown, so there is nothing to close. */
    oncancel?: (() => void) | undefined
  }

  let { fields, values, busy = false, onsave, oncancel }: Props = $props()

  // The values the form was opened with: what a save is compared against.
  // svelte-ignore state_referenced_locally
  const openedWith = $state.snapshot(values)
  // svelte-ignore state_referenced_locally
  let draft = $state<Draft>(makeDraft(fields, values))

  const uid = Math.random().toString(36).slice(2, 8)
  const idOf = (field: ConfigField, part = '') => `cfg-${uid}-${field.key}${part}`

  let problems = $derived(draftProblems(fields, draft))
  let invalid = $derived(Object.values(problems).some((problem) => problem !== null))

  function save() {
    const changes = draftChanges(fields, draft, openedWith)
    if (changes) onsave(changes.set, changes.reset)
  }

  function resetToDefaults() {
    draft = defaultDraft(fields)
  }

  function colourInputValue(text: unknown): string {
    return typeof text === 'string' && /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : '#000000'
  }

  function range(field: ConfigField): string | null {
    const unit = field.unit ?? ''
    if (field.min !== undefined && field.max !== undefined) return t('configRangeBoth', `${field.min}${unit}`, `${field.max}${unit}`)
    if (field.min !== undefined) return t('configRangeMin', `${field.min}${unit}`)
    if (field.max !== undefined) return t('configRangeMax', `${field.max}${unit}`)
    return unit === '' ? null : unit
  }

</script>

<form
  class="config"
  onsubmit={(event) => {
    event.preventDefault()
    save()
  }}
>
  {#each fields as field (field.key)}
    <div class="field">
      {#if field.type === 'yes-no'}
        <label class="check">
          <input type="checkbox" bind:checked={draft[field.key]} />
          <span>{field.label}</span>
        </label>
      {:else}
        <label class="name" for={idOf(field)}>{field.label}</label>
      {/if}

      {#if field.type === 'text'}
        <input
          id={idOf(field)}
          type="text"
          maxlength={CONFIG_LIMITS.text}
          bind:value={draft[field.key]}
        />
      {:else if field.type === 'number'}
        <input
          id={idOf(field)}
          type="number"
          step={field.step ?? 'any'}
          min={field.min}
          max={field.max}
          bind:value={draft[field.key]}
        />
        {#if range(field)}<span class="hint">{range(field)}</span>{/if}
      {:else if field.type === 'choice'}
        <select id={idOf(field)} bind:value={draft[field.key]}>
          {#each field.options ?? [] as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      {:else if field.type === 'colour'}
        <div class="colour">
          <input
            type="color"
            aria-label={t('configColourPicker', field.label)}
            value={colourInputValue(draft[field.key])}
            oninput={(event) => (draft[field.key] = event.currentTarget.value)}
          />
          <input
            id={idOf(field)}
            type="text"
            class="code"
            maxlength="7"
            aria-label={t('configColourCode', field.label)}
            bind:value={draft[field.key]}
          />
        </div>
      {:else if field.type === 'list'}
        <div class="lines">
          {#each draft[field.key] as _item, index (index)}
            <div class="line">
              <input
                type="text"
                maxlength={CONFIG_LIMITS.cell}
                aria-label={t('configItemLabel', index + 1, field.label)}
                bind:value={draft[field.key][index]}
              />
              <button
                type="button"
                class="small"
                aria-label={t('configRemoveItemLabel', index + 1, field.label)}
                onclick={() => removeAt(draft, field.key, index)}
              >
                {t('configRemoveItem')}
              </button>
            </div>
          {/each}
          <button type="button" class="small" onclick={() => addItem(draft, field.key)}>
            {t('configAddItem')}
          </button>
        </div>
      {:else if field.type === 'table'}
        <div class="lines">
          <div class="columns" style:--columns={(field.columns ?? []).length}>
            {#each field.columns ?? [] as column (column.key)}
              <span class="hint">{column.label}</span>
            {/each}
            <span></span>
          </div>
          {#each draft[field.key] as row, index (index)}
            <div class="columns" style:--columns={(field.columns ?? []).length}>
              {#each field.columns ?? [] as column (column.key)}
                <input
                  type="text"
                  maxlength={CONFIG_LIMITS.cell}
                  aria-label={t('configCellLabel', column.label, index + 1, field.label)}
                  bind:value={row[column.key]}
                />
              {/each}
              <button
                type="button"
                class="small"
                aria-label={t('configRemoveRowLabel', index + 1, field.label)}
                onclick={() => removeAt(draft, field.key, index)}
              >
                {t('configRemoveItem')}
              </button>
            </div>
          {/each}
          <button
            type="button"
            class="small"
            onclick={() => addRow(field, draft)}
          >
            {t('configAddRow')}
          </button>
        </div>
      {/if}

      {#if field.help}<span class="hint">{field.help}</span>{/if}
      {#if problems[field.key]}<span class="problem" role="alert">{problems[field.key]}</span>{/if}
    </div>
  {/each}

  {#if invalid}<p class="problem">{t('configFixProblems')}</p>{/if}

  <div class="buttons">
    <button type="submit" class="primary" disabled={busy || invalid}>{t('configSave')}</button>
    {#if oncancel}
      <button type="button" class="secondary" onclick={oncancel}>{t('cancel')}</button>
    {/if}
    <button type="button" class="secondary" onclick={resetToDefaults}>{t('configResetDefaults')}</button>
  </div>
</form>

<style>
  .config {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .name {
    font: 600 12px var(--font-ui);
    color: var(--text);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 600 12px var(--font-ui);
    color: var(--text);
  }

  .hint {
    font: 11.5px/1.4 var(--font-ui);
    color: var(--text-dim);
  }

  .problem {
    margin: 0;
    font: 11.5px/1.4 var(--font-ui);
    color: var(--danger);
  }

  input[type='text'],
  input[type='number'],
  select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 4px 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 12.5px var(--font-ui);
    color: var(--text);
  }

  .colour {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .colour .code {
    width: 9ch;
    font-family: var(--font-mono);
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .line {
    display: flex;
    gap: 4px;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr)) auto;
    gap: 4px;
    align-items: center;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  button {
    border-radius: var(--r-button);
    font: 600 12px var(--font-ui);
    cursor: pointer;
  }

  button.small {
    align-self: flex-start;
    padding: 3px 8px;
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--text);
    font-weight: 400;
  }

  button.secondary {
    padding: 5px 9px;
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--text);
    font-weight: 400;
  }

  button.primary {
    padding: 5px 9px;
    border: 1px solid transparent;
    background: var(--accent);
    color: var(--accent-text);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
