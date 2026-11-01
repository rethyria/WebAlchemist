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
  import { importSizeProblem, isEncryptedExport, type EncryptedExport } from '@shared/export-envelope'
  import type { BackupSettings, ExportMode, PlannedTransform } from '@background/transfer'
  import Button from '@sidebar/components/Button.svelte'
  import {
    EXPORT_WARNING,
    describeResult,
    downloadText,
    exportFileName,
    originsToRequest,
    parseBundleText,
    passphraseProblem,
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
  let previewMode = $state<ExportMode>('share')
  let previewSettings = $state<BackupSettings | null>(null)
  let restoreSettings = $state(false)
  /** The export waiting for the user to choose between a plain and an encrypted file. */
  let pendingMode = $state<ExportMode | null>(null)
  let exportPassphrase = $state('')
  let exportConfirmation = $state('')
  /** A chosen file that is encrypted and waits for its passphrase. */
  let encryptedFile = $state<{ name: string; parsed: unknown } | null>(null)
  let importPassphrase = $state('')
  let fileInput: HTMLInputElement | undefined = $state()

  const importable = $derived(items.filter((item) => item.status === 'import'))

  function startExport(mode: ExportMode) {
    error = null
    notice = null
    exportPassphrase = ''
    exportConfirmation = ''
    pendingMode = mode
  }

  const exportProblem = $derived(passphraseProblem(exportPassphrase, exportConfirmation))

  async function runExport(mode: ExportMode, encrypt: boolean) {
    error = null
    notice = null
    busy = true
    try {
      const exported = await call<ExportBundle | EncryptedExport>({
        type: 'export-transforms',
        mode,
        ...(encrypt ? { passphrase: exportPassphrase } : {}),
      })
      downloadText(JSON.stringify(exported, null, 2), exportFileName(mode, new Date(), encrypt), {
        createObjectURL: (blob) => URL.createObjectURL(blob),
        revokeObjectURL: (url) => URL.revokeObjectURL(url),
        createAnchor: () => document.createElement('a'),
      })
      notice = encrypt
        ? 'Saved an encrypted file. It can be imported only with the passphrase.'
        : 'Saved a file that is not encrypted.'
      pendingMode = null
      exportPassphrase = ''
      exportConfirmation = ''
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
      // Before the file is read, so a very large file is never loaded.
      const tooLarge = importSizeProblem(file.size)
      if (tooLarge !== null) throw new Error(tooLarge)
      const parsed = parseBundleText(await file.text())
      if (isEncryptedExport(parsed)) {
        encryptedFile = { name: file.name, parsed }
        return
      }
      await showPreview(parsed, file.name, undefined)
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause)
    } finally {
      busy = false
    }
  }

  async function openEncrypted() {
    if (!encryptedFile) return
    error = null
    busy = true
    try {
      await showPreview(encryptedFile.parsed, encryptedFile.name, importPassphrase)
      encryptedFile = null
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause)
    } finally {
      busy = false
    }
  }

  async function showPreview(parsed: unknown, name: string, passphrase: string | undefined) {
    const preview = await call<{
      mode: ExportMode
      items: PlannedTransform[]
      settings: BackupSettings | null
    }>({
      type: 'preview-import',
      bundle: parsed,
      ...(passphrase === undefined ? {} : { passphrase }),
    })
    bundle = parsed
    items = preview.items
    previewMode = preview.mode
    previewSettings = preview.settings
    restoreSettings = false
    fileName = name
  }

  function cancel() {
    bundle = null
    items = []
    fileName = ''
    previewSettings = null
    restoreSettings = false
    encryptedFile = null
    importPassphrase = ''
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
      const result = await call<ImportResult>({
        type: 'import-transforms',
        bundle,
        restoreSettings: restoreSettings && previewSettings !== null,
        ...(importPassphrase === '' ? {} : { passphrase: importPassphrase }),
      })
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
    Export to share saves your transforms to a JSON file that can be given to someone else.
    JavaScript is saved as its description only, without code. Back up also saves the JavaScript
    code and the accent colour and health check mode, so that the set can be restored on another
    computer. Neither file contains credentials or provider settings. Both files hold text and
    addresses taken from the pages the transforms were written for, and either can be encrypted
    with a passphrase when it is saved.
  </p>
  <p class="subtitle">
    Import reads such a file and shows what it would add before anything is saved. Imported
    transforms are always turned off. Imported JavaScript from a shared file has no code until
    its description has been read and code has been generated and reviewed here. JavaScript code
    from a backup stays off until the code has been read and approved.
  </p>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  {#if notice}
    <p class="notice" role="status">{notice}</p>
  {/if}

  <div class="buttons">
    <Button disabled={busy} onclick={() => startExport('share')}>Export to share</Button>
    <Button disabled={busy} onclick={() => startExport('backup')}>Back up</Button>
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

  {#if pendingMode !== null}
    <div class="preview">
      <h3>{pendingMode === 'backup' ? 'Back up' : 'Export to share'}</h3>
      <p class="subtitle">{EXPORT_WARNING}</p>
      <div class="field">
        <label for="export-passphrase">Passphrase</label>
        <input
          id="export-passphrase"
          type="password"
          autocomplete="new-password"
          bind:value={exportPassphrase}
        />
      </div>
      <div class="field">
        <label for="export-confirmation">Repeat the passphrase</label>
        <input
          id="export-confirmation"
          type="password"
          autocomplete="new-password"
          bind:value={exportConfirmation}
        />
      </div>
      {#if exportPassphrase !== '' && exportProblem}
        <p class="problem" role="status">{exportProblem}</p>
      {/if}
      <div class="buttons">
        <Button
          variant="primary"
          disabled={busy || exportProblem !== null}
          onclick={() => void runExport(pendingMode!, true)}
        >
          Save encrypted file
        </Button>
        <Button disabled={busy} onclick={() => void runExport(pendingMode!, false)}>
          Save without encryption
        </Button>
        <Button disabled={busy} onclick={() => (pendingMode = null)}>Cancel</Button>
      </div>
    </div>
  {/if}

  {#if encryptedFile !== null}
    <div class="preview">
      <h3>{encryptedFile.name} is encrypted</h3>
      <div class="field">
        <label for="import-passphrase">Passphrase</label>
        <input
          id="import-passphrase"
          type="password"
          autocomplete="off"
          bind:value={importPassphrase}
          onkeydown={(event) => event.key === 'Enter' && void openEncrypted()}
        />
      </div>
      <div class="buttons">
        <Button
          variant="primary"
          disabled={busy || importPassphrase === ''}
          onclick={() => void openEncrypted()}
        >
          Decrypt and show contents
        </Button>
        <Button disabled={busy} onclick={cancel}>Cancel</Button>
      </div>
    </div>
  {/if}

  {#if bundle !== null}
    <div class="preview">
      <h3>Contents of {fileName}</h3>
      {#if previewMode === 'backup'}
        <p class="subtitle">
          This file is a backup. JavaScript code in it is restored, but each script stays off
          until its code has been read and approved. Code that fails the static analysis is not
          restored.
        </p>
      {/if}
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
                {#if item.needsApproval}
                  <p>Code restored; it stays off until you approve it.</p>
                  {#if item.world === 'MAIN'}
                    <p class="problem">
                      This code is set to run in the page's own world (MAIN), where the page can
                      read and change it. The risks are listed when you approve it.
                    </p>
                  {/if}
                  <details>
                    <summary>Show code</summary>
                    <pre>{item.code}</pre>
                  </details>
                {:else if item.kind === 'js'}
                  <p>
                    {item.reason ?? 'Code not imported; will need regenerating.'}
                    {item.reason ? ' It will need regenerating.' : ''}
                  </p>
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
        {#if previewSettings}
          <label class="check">
            <input type="checkbox" bind:checked={restoreSettings} />
            Also restore the accent colour ({previewSettings.accent}) and the health check mode
            ({previewSettings.healthCheckMode})
          </label>
        {/if}
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

  .field {
    display: flex;
    align-items: center;
    gap: var(--sp-9);
    margin: 0 0 var(--sp-9);
  }

  .field label {
    min-width: 12em;
    font: 12px var(--font-ui);
  }

  .field input {
    flex: 1;
    padding: var(--sp-5) var(--sp-9);
    font: 12px var(--font-mono);
  }

  .check {
    display: flex;
    gap: var(--sp-7);
    margin: 0 0 var(--sp-9);
    font: 12px/1.5 var(--font-ui);
  }

  details {
    margin: var(--sp-5) 0 0;
    font: 11.5px var(--font-ui);
  }

  pre {
    max-height: 240px;
    overflow: auto;
    margin: var(--sp-5) 0 0;
    padding: var(--sp-7);
    border: 1px solid var(--border);
    font: 11.5px/1.5 var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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
