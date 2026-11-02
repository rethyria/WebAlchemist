<script lang="ts">
  /**
   * The settings of one elixir: the form, the messages that store the values,
   * the notice about reloading, and the export and import of the values alone.
   * Used by the sidebar row and by the editor page.
   *
   * Nothing here changes code, fields, world, capabilities or the match
   * pattern: the three messages it sends change only the values.
   */
  import ConfigForm from './ConfigForm.svelte'
  import { effectiveValues } from './config'
  import { t } from './i18n'
  import { send } from './messaging.svelte'
  import type { Responses } from './messages'
  import type { ConfigValue, Transform } from './types'

  interface Props {
    transform: Transform
    /** Finds the tab to apply a CSS change in at once. Absent in the editor, which is not on the page. */
    findTab?: (() => Promise<number | undefined>) | undefined
    /** Where the notice about reloading is worded for: one page, or the open tabs of the site. */
    place: 'page' | 'tabs'
    onchanged: (transform: Transform) => void
    /** Absent where the form is always shown, as in the editor. */
    oncancel?: (() => void) | undefined
    onerror: (cause: unknown) => void
  }

  let { transform, findTab, place, onchanged, oncancel, onerror }: Props = $props()

  let busy = $state(false)
  /** The tab that the last change was applied in, which the reload button reloads. */
  let tabId = $state<number | undefined>(undefined)
  let saved = $state(false)
  let reloadTabs = $state(0)
  let importReport = $state<string[]>([])
  let fileInput: HTMLInputElement | undefined = $state()

  let fields = $derived(transform.configFields ?? [])
  let values = $derived(effectiveValues(fields, transform.configValues))
  // The form is built again when the stored values change, for example after an import.
  let formKey = $state(0)

  function changed(next: Transform, count: number) {
    reloadTabs = count
    saved = true
    formKey += 1
    onchanged(next)
  }

  async function save(set: Record<string, ConfigValue>, reset: string[]) {
    busy = true
    saved = false
    importReport = []
    try {
      tabId = await findTab?.()
      const result = await send<Responses['set-config-values']>({
        type: 'set-config-values',
        id: transform.id,
        values: set,
        reset,
        ...(tabId === undefined ? {} : { tabId }),
      })
      changed(result.transform, result.reloadTabs)
    } catch (cause) {
      onerror(cause)
    } finally {
      busy = false
    }
  }

  async function exportValues() {
    try {
      const file = await send<Responses['export-config-values']>({ type: 'export-config-values', id: transform.id })
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'web-alchemist-settings.json'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      onerror(cause)
    }
  }

  async function importValues(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    busy = true
    saved = false
    importReport = []
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        throw new Error(t('configFileNotSettings'))
      }
      tabId = await findTab?.()
      const result = await send<Responses['import-config-values']>({
        type: 'import-config-values',
        id: transform.id,
        file: parsed,
        ...(tabId === undefined ? {} : { tabId }),
      })
      const labelOf = (key: string) => fields.find((field) => field.key === key)?.label ?? key
      const lines: string[] = []
      lines.push(
        result.applied.length > 0
          ? t('configImportApplied', result.applied.length)
          : t('configImportNoneApplied'),
      )
      if (result.skipped.length > 0) {
        lines.push(
          t(
            'configImportSkipped',
            result.skipped.map((item) => t('configImportSkippedItem', labelOf(item.key), item.problem)).join('; '),
          ),
        )
      }
      if (result.unknown.length > 0) lines.push(t('configImportIgnored', result.unknown.length))
      importReport = lines
      if (result.applied.length > 0) changed(result.transform, result.reloadTabs)
    } catch (cause) {
      onerror(cause)
    } finally {
      busy = false
    }
  }

  async function reload() {
    if (tabId !== undefined) await browser.tabs.reload(tabId).catch(() => {})
    reloadTabs = 0
  }
</script>

<div class="section">
  {#key formKey}
    <ConfigForm {fields} {values} {busy} onsave={(set, reset) => void save(set, reset)} {oncancel} />
  {/key}

  <div class="files">
    <button type="button" class="small" disabled={busy} onclick={() => void exportValues()}>
      {t('configExport')}
    </button>
    <button type="button" class="small" disabled={busy} onclick={() => fileInput?.click()}>
      {t('configImport')}
    </button>
    <input
      bind:this={fileInput}
      type="file"
      accept="application/json,.json"
      class="hidden"
      tabindex="-1"
      aria-hidden="true"
      onchange={(event) => void importValues(event)}
    />
  </div>

  <div role="status" class="notes">
    {#if saved}<p>{t('configSaved')}</p>{/if}
    {#each importReport as line}<p>{line}</p>{/each}
    {#if reloadTabs > 0}
      <p>
        {#if place === 'page'}
          {t('configReloadPage')}
        {:else if reloadTabs === 1}
          {t('configReloadTabsOne')}
        {:else}
          {t('configReloadTabsMany', reloadTabs)}
        {/if}
      </p>
      {#if place === 'page' && tabId !== undefined}
        <button type="button" class="small" onclick={() => void reload()}>{t('configReloadPageButton')}</button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .hidden {
    display: none;
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .notes p {
    margin: 0;
    font: 12px/1.45 var(--font-ui);
    color: var(--text-dim);
  }

  button.small {
    align-self: flex-start;
    padding: 3px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-button);
    background: transparent;
    color: var(--text);
    font: 12px var(--font-ui);
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
