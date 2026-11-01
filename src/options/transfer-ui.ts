/**
 * The parts of the export and import section that do not need a page, so a
 * test can run them: file names, the download, the permission request and the
 * wording of what an import did (#31).
 */

import type { ImportResult } from '@background/storage'
import type { PlannedTransform } from '@background/transfer'
import { MIN_PASSPHRASE_LENGTH } from '@shared/vault-policy'

/** `web-alchemist-share-2026-11-01.json`: the mode and the local date, with `-encrypted` for an encrypted file. */
export function exportFileName(mode: string, now: Date, encrypted = false): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `web-alchemist-${mode}-${day}${encrypted ? '-encrypted' : ''}.json`
}

/**
 * Starts a download of `text` from a page of the extension. A Blob URL and an
 * anchor with a download name need no permission, so the extension does not
 * ask for `downloads`. Firefox saves the file where the user's download
 * settings say, or asks where, which the extension cannot choose.
 */
export function downloadText(
  text: string,
  name: string,
  env: {
    createObjectURL: (blob: Blob) => string
    revokeObjectURL: (url: string) => void
    createAnchor: () => { href: string; download: string; click: () => void }
  },
): void {
  const url = env.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = env.createAnchor()
  anchor.href = url
  anchor.download = name
  anchor.click()
  // The download has started when click() returns, so the URL is not needed.
  env.revokeObjectURL(url)
}

/** Parses the text of a chosen file, with a message the user can act on. */
export function parseBundleText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON, so it cannot be a Web Alchemist export.')
  }
}

/** The origins an import needs access to: those of the records that will be imported, once each. */
export function originsToRequest(items: PlannedTransform[]): string[] {
  const origins = items
    .filter((item) => item.status === 'import')
    .map((item) => item.origin)
    .filter((origin): origin is string => origin !== null)
  return [...new Set(origins)]
}

/**
 * Asks for every origin in one request. The request is made before this
 * function returns, with no await first, because Firefox accepts a permission
 * request only while the user's click is still being handled. Resolves false
 * when the user refuses or the request fails, and true when there was nothing
 * to ask for.
 */
export function requestImportOrigins(
  request: (permissions: { origins: string[] }) => Promise<boolean>,
  items: PlannedTransform[],
): Promise<boolean> {
  const origins = originsToRequest(items)
  if (origins.length === 0) return Promise.resolve(true)
  return request({ origins }).catch(() => false)
}

/**
 * What the export panel says before a file is written. It names what the file
 * contains, since the user cannot see that from the button.
 */
export const EXPORT_WARNING =
  'The file contains text taken from the pages the transforms were written for (the start of the text of each element they target), the descriptions of the transforms, and the addresses they apply to. On a mail, banking or health site that text can be personal. The file is saved as plain text unless it is encrypted with a passphrase. Anyone with the passphrase and the file can read it, and a forgotten passphrase cannot be recovered.'

/** The reason a passphrase for an export cannot be used yet, or null when it can. */
export function passphraseProblem(passphrase: string, confirmation: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`
  }
  if (passphrase !== confirmation) return 'The two passphrases are not the same.'
  return null
}

/** One sentence for the number of records, such as "3 transforms". */
const count = (n: number): string => `${n} ${n === 1 ? 'transform' : 'transforms'}`

/** What the user is told after an import. */
export function describeResult(result: ImportResult, accessGranted: boolean): string {
  const parts = [`Imported ${count(result.imported)}. They are all turned off.`]
  if (result.needsRegeneration.length > 0) {
    parts.push(
      `${count(result.needsRegeneration.length)} ${result.needsRegeneration.length === 1 ? 'has' : 'have'} no code and ${result.needsRegeneration.length === 1 ? 'needs' : 'need'} regenerating from the description.`,
    )
  }
  const awaiting = result.items.filter((item) => item.status === 'import' && item.needsApproval).length
  if (awaiting > 0) {
    parts.push(
      `${count(awaiting)} ${awaiting === 1 ? 'was' : 'were'} restored with JavaScript code. Each stays off until its code has been read and approved in the sidebar.`,
    )
  }
  if (result.settingsRestored) parts.push('The accent colour and health check mode were restored.')
  if (result.duplicates > 0) parts.push(`${count(result.duplicates)} already saved and skipped.`)
  if (result.skipped > 0) parts.push(`${count(result.skipped)} refused.`)
  if (!accessGranted && result.imported > 0) {
    parts.push(
      'Access to the sites was not granted, so the imported transforms show "No access to this site" until it is.',
    )
  }
  return parts.join(' ')
}
