/**
 * Encrypts an export file with a passphrase, and opens one (#132).
 *
 * The file holds text taken from pages and the addresses transforms apply to,
 * so it can be encrypted before it leaves the extension. The key comes from the
 * passphrase with the same PBKDF2 and AES-GCM functions the vault uses for
 * credentials (see vault.ts), so the cost per guess is the same. Nothing about
 * the contents is left outside the ciphertext except the format name, the
 * schema version and the fact that the file is encrypted.
 *
 * Only the file is encrypted. Transforms in `storage.local` are not: the
 * background script reads them on every navigation, and encrypting them would
 * mean that no transform applies while the vault is locked.
 */

import { MIN_PASSPHRASE_LENGTH } from '@shared/vault-policy'
import { EXPORT_FORMAT, isEncryptedExport, type EncryptedExport } from '@shared/export-envelope'
import { deriveKey, randomSalt, saltOf, seal, unseal } from './vault'

export async function encryptExport(
  bundle: { schemaVersion: number },
  passphrase: string,
): Promise<EncryptedExport> {
  // Checked here as well as on the page, as the vault does: a message can reach
  // the background without passing through the page.
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`)
  }
  const salt = randomSalt()
  const key = await deriveKey(passphrase, salt)
  return {
    format: EXPORT_FORMAT,
    schemaVersion: bundle.schemaVersion,
    encrypted: true,
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-GCM',
    sealed: await seal(key, salt, JSON.stringify(bundle)),
  }
}

/**
 * The file as an export, decrypted when it is encrypted. A file that is not
 * encrypted is returned as it is, and a passphrase given for it is ignored.
 * Throws a message for the page when the file is encrypted and the passphrase is
 * missing or wrong. AES-GCM authenticates the ciphertext, so a wrong passphrase
 * and a file that was changed fail the same way.
 */
export async function openExport(file: unknown, passphrase: string | undefined): Promise<unknown> {
  if (!isEncryptedExport(file)) return file
  if (!passphrase) throw new Error('This file is encrypted. Enter its passphrase to import it.')
  try {
    const key = await deriveKey(passphrase, saltOf(file.sealed))
    return JSON.parse(await unseal(key, file.sealed))
  } catch {
    throw new Error('The file could not be decrypted. The passphrase is wrong, or the file was changed.')
  }
}
