/**
 * The shape of an export file that is encrypted with a passphrase (#132).
 *
 * The page needs to recognise one before it asks for a passphrase, and the
 * background needs the same test before it decrypts, so the check is here and
 * not in either of them. The `sealed` field has the shape the vault stores for
 * credentials: a salt, an initialisation vector and the ciphertext, each as
 * base64.
 */

export const EXPORT_FORMAT = 'web-alchemist-export'

export interface EncryptedExport {
  format: typeof EXPORT_FORMAT
  schemaVersion: number
  /** Marks the file as ciphertext. Everything else about the export is inside `sealed`. */
  encrypted: true
  /** How the key is made from the passphrase, so a reader of the file can tell. */
  kdf: 'PBKDF2-SHA256'
  cipher: 'AES-GCM'
  sealed: { sealed: true; salt: string; iv: string; data: string }
}

export function isEncryptedExport(value: unknown): value is EncryptedExport {
  if (typeof value !== 'object' || value === null) return false
  const file = value as Record<string, unknown>
  if (file['encrypted'] !== true) return false
  const sealed = file['sealed'] as Record<string, unknown> | null
  return (
    typeof sealed === 'object' &&
    sealed !== null &&
    sealed['sealed'] === true &&
    typeof sealed['salt'] === 'string' &&
    typeof sealed['iv'] === 'string' &&
    typeof sealed['data'] === 'string'
  )
}

/** The largest file an import reads, in bytes (5 MB, counted as 5 × 1,048,576). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
/** The most records one imported file may hold. */
export const MAX_IMPORT_RECORDS = 1000

/** What the settings page says about a file that is larger than the limit, or null when the size is allowed. */
export function importSizeProblem(bytes: number): string | null {
  return bytes > MAX_IMPORT_BYTES
    ? 'This file is larger than 5 MB, which is more than a Web Alchemist export holds, so it was not read.'
    : null
}

/** What the importer says about a file with too many records, or null when the count is allowed. */
export function importCountProblem(records: number): string | null {
  return records > MAX_IMPORT_RECORDS
    ? `This file holds ${records} records. An import takes at most ${MAX_IMPORT_RECORDS}, so it was not read.`
    : null
}
