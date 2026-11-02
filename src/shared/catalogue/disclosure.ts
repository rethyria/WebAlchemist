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
    message: 'The same details for each element that you add as a reference while refining an elixir',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentHistory: {
    message: 'Your earlier follow-up requests and questions for the same elixir, with the answers and the code that the model generated for them',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentRepair: {
    message: 'When you use Repair with AI or Refine, the saved code, its description and rationale, and the reason that the elixir stopped working',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentAddress: {
    message: 'The address of the page, without the part after # and without query values',
    description: 'An item in the list of what is sent to the provider.',
  },
  sentDescription: {
    message: 'Your description of the change, or your question about a draft',
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
    message: 'Firefox does not enforce a network restriction on the elixir scripts this extension runs on a page. A script that you approve can use the network and read pages that you are logged in to. Approving the code is the main protection.',
  },
  checksNotice: {
    message: 'JavaScript written by the model is checked by the safety check, which is automatic, and by the code check, which is a review by a second model. Neither check catches every problem. The second model is sent only the code and your description. All CSS, including CSS you write, is checked for the addresses it would load. By default it may load only data: addresses. A setting for each site can also allow the page\'s own addresses (same domain, protocol and port), or addresses that you approve. An @import rule is always refused.',
    description: 'Describes how JavaScript and CSS from the model are checked, including the CSS address policy.',
  },
  transformsStorageNotice: {
    message: 'Saved elixirs are not encrypted, even when a passphrase is set. They are stored in the Firefox profile.',
  },
  passphraseOptionNotice: {
    message: 'To encrypt the keys, set a passphrase on the settings page.',
  },
  siteAccessNotice: {
    message: 'Picking an element on a site, and saving an elixir for a site, give Web Alchemist lasting access to that site. The access stays until it is removed under Site access on the settings page.',
  },
  exclusionNotice: {
    message: 'On excluded sites and their subdomains, Web Alchemist does not pick elements, generate or run elixirs, apply saved CSS, count elixirs on the toolbar badge, check whether elixirs still work, or add any of its own scripts to the page. A page that is already open keeps its changes until it is reloaded. The list is under Excluded sites on the settings page and starts empty. Before text from a page with password or payment fields is sent, a warning asks you to confirm.',
  },
  headingSent: {
    message: 'What is sent to your AI provider',
    description: 'Heading of a section of the first-run disclosure.',
  },
  leadSent: {
    message: 'When you generate an elixir or ask a question about a draft, Web Alchemist sends the following to the AI provider that you chose.',
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
    message: 'Keys are stored as plain text in your Firefox profile folder. Extensions cannot use the operating system\'s password store, so only file permissions protect the keys. Anyone who can read that folder can read them.',
    description: 'Says how API keys are stored when no passphrase is set.',
  },
  disclosureSealed: {
    message: 'Keys are encrypted with your passphrase. Nothing stored on this computer can decrypt them. When you unlock, the decryption key is made from your passphrase and kept in memory for this session only.',
    description: 'Says how API keys are stored when a passphrase is set.',
  },
  disclosureTransforms: {
    message: 'Elixirs are not encrypted, even with a passphrase. Each saved elixir is stored as plain text in this browser profile, including text from the element it changes, the addresses of the pages it applies to, and your description. Exported files hold the same text.',
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
    message: 'The safety check cannot see what the page\'s own functions do when the code calls them.',
    description: 'One risk of running code in the page\'s own world (MAIN), shown before the user approves it.',
  },
  mainRisk4: {
    message: 'The block on image requests that applies in the isolated world does not apply here, so the code can send information out by loading an image.',
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
    message: 'The model chose to run this elixir in the page\'s own world. It now runs in the isolated world. Turn on "Run in the page\'s own world (MAIN)" in the editor only if the change needs it.',
  },
})
