import { t } from './i18n'
import { credentialDisclosure, type VaultView } from './vault-disclosure'

/**
 * Advice shown beside the credential settings on the settings page and in the
 * sidebar's settings panel.
 *
 * Firefox deletes an extension's storage on uninstall but cannot run extension
 * code at that moment, so the extension cannot revoke an API key at the
 * provider. The user has to, and nothing else in the product tells them.
 * Kept in one place so the two surfaces cannot drift apart.
 */
export const REVOKE_KEY_NOTICE = t('revokeKeyNotice')

/* ------------------------------------------------------------------ */
/* First-run disclosure                                                */
/* ------------------------------------------------------------------ */

/**
 * Shown on the settings page and in the sidebar before a credential can be
 * entered, and again whenever the version below changes.
 *
 * Raise the number when a statement in the text stops being true or a new fact
 * has to be told to people who read the earlier text, for example a new kind
 * of data sent to the provider. A change to wording that leaves the meaning
 * alone does not need a new version. The acknowledgement stores the number,
 * so a raise shows the text again to everyone (see disclosure-ack.ts).
 */
export const DISCLOSURE_VERSION = 2

/**
 * The page-controlled values that the picked element's excerpt carries to the
 * provider, keyed by the DOM member the extractor reads for each.
 *
 * The keys are the whitelist pinned in src/content/context.test.ts, and a
 * test compares the two lists. A member added to the extractor without a
 * line here fails that test, so the disclosure cannot fall behind it.
 */
export const SENT_CHANNELS = {
  tagName: t('sentTagName'),
  id: t('sentId'),
  classList: t('sentClassList'),
  getAttribute: t('sentRole'),
  children: t('sentChildren'),
  textContent: t('sentTextContent'),
} as const

export const SENT_RULES = t('sentRules')
export const SENT_STYLES = t('sentStyles')
export const SENT_REFERENCES = t('sentReferences')
export const SENT_HISTORY = t('sentHistory')
export const SENT_REPAIR = t('sentRepair')
export const SENT_ADDRESS = t('sentAddress')
export const SENT_DESCRIPTION = t('sentDescription')
export const SENT_SCREENSHOT = t('sentScreenshot')

export const SENT_RETENTION = t('sentRetention')

export const ENFORCEMENT_NOTICE = t('enforcementNotice')
export const CHECKS_NOTICE = t('checksNotice')

export const TRANSFORMS_STORAGE_NOTICE = t('transformsStorageNotice')
export const PASSPHRASE_OPTION_NOTICE = t('passphraseOptionNotice')

export const SITE_ACCESS_NOTICE = t('siteAccessNotice')

export const EXCLUSION_NOTICE = t('exclusionNotice')

/** The heading and text of one part of the disclosure. */
export interface DisclosureSection {
  heading: string
  /** Sentences shown before the list, if any. */
  lead: string | null
  /** Items that complete the lead. */
  items: string[]
  /** Sentences shown after the list. */
  paragraphs: string[]
}

/**
 * The whole disclosure, in reading order. Both surfaces render this value, so
 * a statement has one source. The storage statement depends on whether the
 * vault is sealed, because "keys are stored as plain text" is false once a
 * passphrase is set.
 */
export function firstRunDisclosure(vault: VaultView): DisclosureSection[] {
  const credentials = credentialDisclosure(vault)
  return [
    {
      heading: t('headingSent'),
      lead: t('leadSent'),
      items: [
        SENT_DESCRIPTION,
        ...Object.values(SENT_CHANNELS),
        SENT_STYLES,
        SENT_RULES,
        SENT_REFERENCES,
        SENT_HISTORY,
        SENT_REPAIR,
        SENT_ADDRESS,
        SENT_SCREENSHOT,
      ],
      paragraphs: [SENT_RETENTION],
    },
    {
      heading: t('headingChecks'),
      lead: null,
      items: [],
      paragraphs: [ENFORCEMENT_NOTICE, CHECKS_NOTICE],
    },
    {
      heading: t('headingStored'),
      lead: null,
      items: [],
      paragraphs: [
        credentials.text,
        ...(vault.sealed ? [] : [PASSPHRASE_OPTION_NOTICE]),
        TRANSFORMS_STORAGE_NOTICE,
      ],
    },
    {
      heading: t('headingAccess'),
      lead: null,
      items: [],
      paragraphs: [SITE_ACCESS_NOTICE, EXCLUSION_NOTICE],
    },
    {
      heading: t('headingStopping'),
      lead: null,
      items: [],
      paragraphs: [REVOKE_KEY_NOTICE],
    },
  ]
}
