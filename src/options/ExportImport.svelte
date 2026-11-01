<script lang="ts">
  /**
   * Export and import of transforms (#31).
   *
   * Export writes one JSON file from this page with a Blob URL and an anchor,
   * so the extension needs no `downloads` permission. Import reads a chosen
   * file, asks the background what it would do with each record, and stores
   * nothing until the user confirms. Host access for the imported sites is
   * requested in one prompt from the confirm click.
   */
  import type { ExportBundle, ImportResult } from '@background/storage'
  import type { PlannedTransform } from '@background/transfer'
  import Button from '@sidebar/components/Button.svelte'
  import {
    describeResult,
    downloadText,
    exportFileName,
    originsToRequest,
    parseBundleText,
    requestImportOrigins,
  } from './transfer-ui'

  interface Props {
    call: <T>(message: unknown) => Promise<T>
  }

  let { call }: Props = $props()

  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)
  let busy = $state(false)
  let fileName = $state('')
  let bundle = $state<unknown>(null)
  let items = $state<PlannedTransform[]>([])
  let fileInput: HTMLInputElement | undefined = $state()

  const importable = $derived(items.filter((item) => item.status === 'import'))

  async function runExport() {
    error = null
    notice = null
    busy = true
    try {
      const exported = await call<ExportBundle>({ type: 'export-transforms' })
      downloadText(JSON.stringify(exported, null, 2), exportFileName('share', new Date()), {
        createObjectURL: (blob) => URL.createObjectURL(blob),
        revokeObjectURL: (url) => URL.revokeObjectURL(url),
        createAnchor: () => document.createElement('a'),
      })
      notice = `Exported ${exported.transforms.length} ${exported.transforms.length === 1 ? 'transform' : 'transforms'}.`
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause)
    } finally {
      busy = false
    }
  }

  async function onFileChosen(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    // Cleared so that choosing the same file again fires this handler again.
    input.value = ''
    if (!file) return
    error = null
    notice = null
    cancel()
    busy = true
    try {
      const parsed = parseBundleText(await file.text())
      const preview = await call<{ items: PlannedTransform[] }>({
        type: 'preview-import',
        bundle: parsed,
      })
      bundle = parsed
      items = preview.items
      fileName = file.name
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause)
    } finally {
      busy = false
    }
  }

  function cancel() {
    bundle = null
    items = []
    fileName = ''
  }

  /*
   * The permission request is made first in the click handler, before any
   * await, because Firefox accepts it only while the click is being handled.
   * The import goes ahead whatever the answer: a transform without access is
   * stored and shows "No access to this site" in the list.
   */
  function confirmImport() {
    const access = requestImportOrigins((permissions) => browser.permissions.request(permissions), items)
    void finishImport(access)
  }

  async function finishImport(access: Promise<boolean>) {
    error = null
    busy = true
    try {
      const granted = await access
      const result = await call<ImportResult>({ type: 'import-transforms', bundle })
      notice = describeResult(result, granted)
      cancel()
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause)
    } finally {
      busy = false
    }
  }

  const kindLabel = (item: PlannedTransform) => (item.kind === 'js' ? 'JavaScript' : 'CSS')
</script>

<section>
  <h2>Export and import</h2>
  <p class="subtitle">
    Export saves your transforms to a JSON file that can be shared. JavaScript is saved as its
    description only, without code. The file holds the text and addresses taken from pages the
    transforms were written for, and it is not encrypted. Credentials are never included.
  </p>
  <p class="subtitle">
    Import reads such a file and shows what it would add before anything is saved. Imported
    transforms are always turned off, and imported JavaScript has no code until its description
    has been read and the code has been generated and reviewed here.
  </p>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  {#if notice}
    <p class="notice" role="status">{notice}</p>
  {/if}

  <div class="buttons">
    <Button disabled={busy} onclick={() => void runExport()}>Export transforms</Button>
    <Button disabled={busy} onclick={() => fileInput?.click()}>Import from file</Button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".json,application/json"
      class="file"
      aria-label="File to import"
      onchange={(event) => void onFileChosen(event)}
    />
  </div>

  {#if bundle !== null}
    <div class="preview">
      <h3>Contents of {fileName}</h3>
      {#if items.length === 0}
        <p class="subtitle">The file holds no transforms.</p>
      {:else}
        <ul>
          {#each items as item, index (index)}
            <li class:skipped={item.status !== 'import'}>
              <div class="line">
                <span class="name">{item.name}</span>
                <span class="kind">{kindLabel(item)}</span>
              </div>
              {#if item.sites}<p>Applies to: {item.sites}</p>{/if}
              {#if item.status === 'refused'}
                <p class="problem">Will not be imported. {item.reason}</p>
              {:else if item.status === 'duplicate'}
                <p>Will be skipped. {item.reason}</p>
              {:else}
                {#if item.kind === 'js'}
                  <p>Code not imported; will need regenerating.</p>
                {:else if item.needsRegeneration}
                  <p class="problem">{item.reason} It will need regenerating.</p>
                {/if}
                {#if item.kind === 'js' && item.intent}
                  <p class="quiet">
                    Description written by the author of the file, not by you: {JSON.stringify(item.intent)}
                  </p>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
        <p class="subtitle">
          {importable.length === 0
            ? 'Nothing in this file can be imported.'
            : `${importable.length} of ${items.length} will be imported, turned off. Importing asks for access to ${originsToRequest(items).length === 1 ? 'this site' : 'these sites'}: ${originsToRequest(items).join(', ')}.`}
        </p>
      {/if}
      <div class="buttons">
        <Button variant="primary" disabled={busy || importable.length === 0} onclick={confirmImport}>
          Import {importable.length} {importable.length === 1 ? 'transform' : 'transforms'}
        </Button>
        <Button disabled={busy} onclick={cancel}>Cancel</Button>
      </div>
    </div>
  {/if}
</section>

<style>
  h2 {
    margin: 0 0 var(--sp-5);
    font: 600 13.5px var(--font-ui);
  }

  h3 {
    margin: 0 0 var(--sp-7);
    font: 600 12.5px var(--font-ui);
    overflow-wrap: anywhere;
  }

  .subtitle {
    margin: 0 0 var(--sp-9);
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .error,
  .notice {
    margin: 0 0 var(--sp-9);
    font: 12px/1.5 var(--font-ui);
  }

  .error,
  .problem {
    color: var(--block);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-9);
    margin: 0 0 var(--sp-9);
  }

  .file {
    display: none;
  }

  .preview {
    padding: var(--sp-12) var(--sp-13);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
    margin: 0 0 var(--sp-9);
    padding: 0;
    list-style: none;
  }

  li {
    padding: var(--sp-9) var(--sp-13);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }

  li.skipped {
    opacity: 0.75;
  }

  li p {
    margin: var(--sp-3) 0 0;
    font: 11.5px/1.5 var(--font-ui);
    overflow-wrap: anywhere;
  }

  .quiet {
    color: var(--text-faint);
  }

  .line {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-13);
  }

  .name {
    font: 600 12.5px var(--font-ui);
  }

  .kind {
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }
</style>
