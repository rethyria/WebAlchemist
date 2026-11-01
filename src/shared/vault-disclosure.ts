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

/**
 * True with and without a passphrase: the passphrase protects credentials and
 * nothing else (#132). A transform holds the text of the element it changes, the
 * address pattern of the pages it applies to, and the description the person
 * typed, and all of that is stored as plain text in the browser profile.
 */
export const DISCLOSURE_TRANSFORMS =
  'Transforms are never encrypted, with or without a passphrase. Each saved transform stores text from the page element it changes, the addresses of the pages it applies to, and your description of it, as plain text in this browser profile. Exported files hold the same text.'

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
