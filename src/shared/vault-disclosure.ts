import { t } from './i18n'
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

export const DISCLOSURE_PLAIN = t('disclosurePlain')

export const DISCLOSURE_SEALED = t('disclosureSealed')

/**
 * True with and without a passphrase: the passphrase protects credentials and
 * nothing else (#132). A transform holds the text of the element it changes, the
 * address pattern of the pages it applies to, and the description the person
 * typed, and all of that is stored as plain text in the browser profile.
 */
export const DISCLOSURE_TRANSFORMS = t('disclosureTransforms')

export const STATUS_UNLOCKED = t('statusUnlocked')
export const STATUS_LOCKED = t('statusLocked')
export const LOCKED_CONSEQUENCE = t('lockedConsequence')

/** The disclosure for the current state, and the lock status when sealed. */
export function credentialDisclosure(vault: VaultView): { text: string; status: string | null } {
  if (!vault.sealed) return { text: DISCLOSURE_PLAIN, status: null }
  return {
    text: DISCLOSURE_SEALED,
    status: vault.unlocked ? STATUS_UNLOCKED : t('statusLockedFull'),
  }
}
