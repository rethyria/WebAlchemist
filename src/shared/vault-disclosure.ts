/**
 * What the extension tells a person about how their credentials are stored.
 *
 * One source for the settings page and the sidebar. The sidebar used to carry
 * its own copy of the plain-text sentence and no other, so it said keys were
 * plain text after passphrase mode had encrypted them. The first-run
 * disclosure work depends on every surface saying what is true, so the wording
 * lives here and the surfaces import it rather than restating it.
 *
 * Two states, two true statements. Which applies follows the stored data (see
 * `vaultState` in the background storage module), not a setting.
 */

export interface VaultView {
  sealed: boolean
  unlocked: boolean
}

export const DISCLOSURE_PLAIN =
  "Keys are stored as plain text in this browser profile's directory. Browsers offer extensions no access to the operating system keychain, so this data is protected by file permissions and nothing else. Anyone who can read your profile directory can read these keys."

export const DISCLOSURE_SEALED =
  'Keys are encrypted with your passphrase. What sits in this browser profile is ciphertext, and nothing stored on this machine decrypts it — the key is derived from your passphrase when you unlock, and kept in memory for the session only.'

export const STATUS_UNLOCKED = 'Unlocked for this session.'
export const STATUS_LOCKED = 'Locked.'
export const LOCKED_CONSEQUENCE = 'Generating anything will fail until you unlock.'

/** The disclosure for the current state, and the lock status when sealed. */
export function credentialDisclosure(vault: VaultView): { text: string; status: string | null } {
  if (!vault.sealed) return { text: DISCLOSURE_PLAIN, status: null }
  return {
    text: DISCLOSURE_SEALED,
    status: vault.unlocked ? STATUS_UNLOCKED : `${STATUS_LOCKED} ${LOCKED_CONSEQUENCE}`,
  }
}
