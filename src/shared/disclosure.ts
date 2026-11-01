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
export const REVOKE_KEY_NOTICE =
  'If you stop using Web Alchemist, delete your API key in your provider\'s console. Removing the extension does not revoke it.'

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
  tagName: 'the tag name of each element',
  id: 'the id value of each element',
  classList: 'the class values of each element',
  getAttribute: 'the role value of each element',
  children: 'the elements around the picked element, which are its ancestors and the elements inside it',
  textContent: 'the text of those elements, including text that is hidden on the page',
} as const

export const SENT_RULES =
  'the CSS rules that match the picked element, and the custom properties in scope for it'
export const SENT_ADDRESS =
  'the address of the page, with the fragment removed and the query values removed'
export const SENT_DESCRIPTION = 'your description of the change'
export const SENT_SCREENSHOT = 'a screenshot, only if you add one to a request'

export const SENT_RETENTION =
  "The provider's own retention policy applies to what it receives. Nothing is sent to the developer of Web Alchemist."

export const ENFORCEMENT_NOTICE =
  'Firefox does not enforce a network restriction on the transform scripts this extension runs on a page, as measured in testing. A script that you approve can therefore use the network and read pages that you are logged in to. Approving the code is the main protection.'
export const CHECKS_NOTICE =
  "JavaScript written by the model is checked by a static analysis and by a review from a second model. Neither check is complete. CSS, whether the model or you wrote it, is checked for addresses that it would load. By default only data: addresses are allowed. Two settings, which are chosen for each site, allow addresses on the page's own site or addresses that you approve. An @import rule is refused in every setting."

export const TRANSFORMS_STORAGE_NOTICE =
  'Saved transforms are stored unencrypted in the Firefox profile, also when a passphrase is set.'
export const PASSPHRASE_OPTION_NOTICE =
  'A passphrase set on the settings page encrypts the keys.'

export const SITE_ACCESS_NOTICE =
  'Picking an element on a site gives Web Alchemist lasting access to that site. The access stays until it is removed under Site access on the settings page.'

export const EXCLUSION_NOTICE =
  'On sites on the excluded list, which also covers their subdomains, Web Alchemist does not pick elements, does not generate transforms, does not run saved JavaScript transforms, does not apply saved CSS, does not count transforms on the toolbar badge, does not check whether transforms still work, and does not load its content script. A page that is already open keeps the changes that were made before the site was added, until it is reloaded. The list is under Excluded sites on the settings page and starts empty. Before text from a page with password or payment fields is sent, a warning asks for confirmation.'

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
      heading: 'What is sent to your provider',
      lead: 'When you generate a transform, Web Alchemist sends the following to the provider that you chose.',
      items: [
        capitalise(SENT_DESCRIPTION),
        ...Object.values(SENT_CHANNELS).map(capitalise),
        capitalise(SENT_RULES),
        capitalise(SENT_ADDRESS),
        capitalise(SENT_SCREENSHOT),
      ],
      paragraphs: [SENT_RETENTION],
    },
    {
      heading: 'How code is checked',
      lead: null,
      items: [],
      paragraphs: [ENFORCEMENT_NOTICE, CHECKS_NOTICE],
    },
    {
      heading: 'What is stored on this computer',
      lead: null,
      items: [],
      paragraphs: [
        credentials.text,
        ...(vault.sealed ? [] : [PASSPHRASE_OPTION_NOTICE]),
        TRANSFORMS_STORAGE_NOTICE,
      ],
    },
    {
      heading: 'Access to sites',
      lead: null,
      items: [],
      paragraphs: [SITE_ACCESS_NOTICE, EXCLUSION_NOTICE],
    },
    {
      heading: 'Stopping use',
      lead: null,
      items: [],
      paragraphs: [REVOKE_KEY_NOTICE],
    },
  ]
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
