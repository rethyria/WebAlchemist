import { defineMessages } from './define'

/** Messages of the disclosure surface. */
export const disclosureMessages = defineMessages({
  revokeKeyNotice: {
    message: 'If you stop using Web Alchemist, delete your API key in your provider\'s console. Removing the extension does not revoke it.',
    description: 'Shown beside the credential settings, in the settings page and in the sidebar.',
  },
  sentTagName: {
    message: 'The tag name of each element',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentId: {
    message: 'The id value of each element',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentClassList: {
    message: 'The class values of each element',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentRole: {
    message: 'The role value of each element',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentChildren: {
    message: 'The picked element, up to four of its ancestors, and the elements inside the picked element',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentTextContent: {
    message: 'The text of the elements inside the picked element, up to 80 characters for each element that has no elements inside it, including text that is hidden on the page',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentRules: {
    message: 'The CSS rules that match the picked element, and the custom properties in scope for it',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentStyles: {
    message: 'The computed style values of the picked element and of up to four of its ancestors, for a fixed set of layout and appearance properties',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentReferences: {
    message: 'The same details for each element that you add as a reference while refining a transform',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentHistory: {
    message: 'Your earlier follow-up requests for the same transform and the code that the model generated for them',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentRepair: {
    message: 'When you use Repair or Edit with AI, the saved code, its description and rationale, and the reason that the transform stopped working',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentAddress: {
    message: 'The address of the page, with the fragment removed and the query values removed',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentDescription: {
    message: 'Your description of the change',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentScreenshot: {
    message: 'A screenshot, only if you add one to a request',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentRetention: {
    message: 'The provider\'s own retention policy applies to what it receives. Nothing is sent to the developer of Web Alchemist.',
  },
  enforcementNotice: {
    message: 'Firefox does not enforce a network restriction on the transform scripts this extension runs on a page, as measured in testing. A script that you approve can therefore use the network and read pages that you are logged in to. Approving the code is the main protection.',
  },
  checksNotice: {
    message: 'JavaScript written by the model is checked by a static analysis and by a review from a second model. Neither check is complete. CSS, whether the model or you wrote it, is checked for addresses that it would load. By default only data: addresses are allowed. Two settings, which are chosen for each site, allow addresses on the page\'s own site or addresses that you approve. An @import rule is refused in every setting.',
    description: 'Describes how JavaScript and CSS from the model are checked, including the CSS address policy.',
  },
  transformsStorageNotice: {
    message: 'Saved transforms are stored unencrypted in the Firefox profile, also when a passphrase is set.',
  },
  passphraseOptionNotice: {
    message: 'A passphrase set on the settings page encrypts the keys.',
  },
  siteAccessNotice: {
    message: 'Picking an element on a site, and saving a transform for a site, give Web Alchemist lasting access to that site. The access stays until it is removed under Site access on the settings page.',
  },
  exclusionNotice: {
    message: 'On sites on the excluded list, which also covers their subdomains, Web Alchemist does not pick elements, does not generate transforms, does not run saved JavaScript transforms, does not apply saved CSS, does not count transforms on the toolbar badge, does not check whether transforms still work, and does not load its content script. A page that is already open keeps the changes that were made before the site was added, until it is reloaded. The list is under Excluded sites on the settings page and starts empty. Before text from a page with password or payment fields is sent, a warning asks for confirmation.',
  },
  headingSent: {
    message: 'What is sent to your provider',
    description: 'Heading of a section of the first-run disclosure.',
  },
  leadSent: {
    message: 'When you generate a transform, Web Alchemist sends the following to the provider that you chose.',
  },
  headingChecks: {
    message: 'How code is checked',
    description: 'Heading of a section of the first-run disclosure.',
  },
  headingStored: {
    message: 'What is stored on this computer',
    description: 'Heading of a section of the first-run disclosure.',
  },
  headingAccess: {
    message: 'Access to sites',
    description: 'Heading of a section of the first-run disclosure.',
  },
  headingStopping: {
    message: 'Stopping use',
    description: 'Heading of a section of the first-run disclosure.',
  },
  disclosurePlain: {
    message: 'Keys are stored as plain text in this browser profile\'s directory. Browsers offer extensions no access to the operating system keychain, so this data is protected by file permissions and nothing else. Anyone who can read your profile directory can read these keys.',
    description: 'Says how API keys are stored when no passphrase is set.',
  },
  disclosureSealed: {
    message: 'Keys are encrypted with your passphrase. What sits in this browser profile is ciphertext, and nothing stored on this machine decrypts it — the key is derived from your passphrase when you unlock, and kept in memory for the session only.',
    description: 'Says how API keys are stored when a passphrase is set.',
  },
  disclosureTransforms: {
    message: 'Transforms are never encrypted, with or without a passphrase. Each saved transform stores text from the page element it changes, the addresses of the pages it applies to, and your description of it, as plain text in this browser profile. Exported files hold the same text.',
  },
  statusUnlocked: {
    message: 'Unlocked for this session.',
  },
  statusLocked: {
    message: 'Locked.',
  },
  lockedConsequence: {
    message: 'Generating anything will fail until you unlock.',
  },
  statusLockedFull: {
    message: 'Locked. Generating anything will fail until you unlock.',
    description: 'The lock status followed by what it means, as one sentence.',
  },
  mainRisk1: {
    message: 'The page can change this code while it runs, because the page and the code share one set of objects.',
    description: 'One risk of running code in the page\'s own world (MAIN), shown before the user approves it.',
  },
  mainRisk2: {
    message: 'The code can read what the page keeps in memory, including data that is not visible on screen.',
    description: 'One risk of running code in the page\'s own world (MAIN), shown before the user approves it.',
  },
  mainRisk3: {
    message: 'The static analysis cannot see what the page\'s own functions do when the code calls them.',
    description: 'One risk of running code in the page\'s own world (MAIN), shown before the user approves it.',
  },
  mainRisk4: {
    message: 'The restriction that blocks image requests in the isolated world does not apply, so the code can send information out through an image address.',
    description: 'One risk of running code in the page\'s own world (MAIN), shown before the user approves it.',
  },
  worldNameIsolated: {
    message: 'Isolated world (USER_SCRIPT)',
    description: 'Name of the isolated execution world. The identifier in brackets is a technical name and stays as written.',
  },
  worldNameMain: {
    message: 'The page\'s own world (MAIN)',
    description: 'Name of the page\'s own execution world. The identifier in brackets is a technical name and stays as written.',
  },
  worldResetNotice: {
    message: 'This transform used to run in the page\'s own JavaScript environment because the model chose it. It now runs in its isolated environment. Turn on the page\'s environment only if the change needs it.',
  },
})
