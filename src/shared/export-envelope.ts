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
