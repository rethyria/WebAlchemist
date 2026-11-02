import { defineMessages } from './define'

/** Messages of the options surface. */
export const optionsMessages = defineMessages({
  optHealthDefault: {
    message: 'Default',
    description: 'Note on the choice that is used unless the user changes it.',
  },
  optHealthCheaper: {
    message: 'Cheaper',
    description: 'Note on a choice that makes fewer requests.',
  },
  optHealthNothing: {
    message: 'Nothing runs on its own',
    description: 'Note on the manual choice.',
  },
  optRequestFailed: {
    message: 'Request failed.',
    description: 'Shown when the background reports an error without a message.',
  },
  optTitle: {
    message: 'Web Alchemist settings',
    description: 'Main heading of the settings page.',
  },
  optLoadError: {
    message: 'The stored API keys and sign-ins could not be read: $ERROR$ The key status below is not known.',
    description: 'Error shown on the settings page when the stored keys could not be read. $ERROR$ is the error text.',
    placeholders: ['ERROR'],
  },
  optBindingError: {
    message: 'The passphrase change was saved, but the stored keys could not be checked: $ERROR$ They are checked again the next time they are used.',
    description: 'Error shown on the settings page after the passphrase setting changed. $ERROR$ is the error text.',
    placeholders: ['ERROR'],
  },
  optAccent: {
    message: 'Accent colour',
    description: 'Heading of the choice of accent colour.',
  },
  optHealth: {
    message: 'Health check',
    description: 'Heading of the choice of when to check for broken transforms.',
  },
  optNotSiteName: {
    message: '"$NAME$" is not a site name. Enter a name such as example.com.',
    description: 'Error shown when an entry in the list of excluded sites is not valid. $NAME$ is the text entered.',
    placeholders: ['NAME'],
  },
  optAlreadyListed: {
    message: '$HOST$ is already on the list.',
    description: 'Error shown when a site is already on the list of excluded sites. $HOST$ is a site name.',
    placeholders: ['HOST'],
  },
  optExcludedTitle: {
    message: 'Excluded sites',
    description: 'Heading of the list of excluded sites.',
  },
  optExcludedBody: {
    message: 'On these sites and their subdomains, Web Alchemist does not pick elements, generate transforms or ask for access.',
    description: 'Explains the list of excluded sites.',
  },
  optSiteName: {
    message: 'Site name',
    description: 'Label of the box where a site is entered.',
  },
  optAddSite: {
    message: 'Add site',
    description: 'Button that adds a site to the list.',
  },
  optNoneExcluded: {
    message: 'No sites are excluded.',
    description: 'Shown when the list of excluded sites is empty.',
  },
  optRemove: {
    message: 'Remove',
    description: 'Button that removes a site from the list.',
  },
  optModelOther: {
    message: 'Other…',
    description: 'Choice in the list of models that lets the user type a model identifier.',
  },
  optModelId: {
    message: 'Model ID',
    description: 'Hint shown in the empty box for a model identifier.',
  },
  optModelPrice: {
    message: '$PRICE$ per million tokens (input / output)',
    description: 'Price of a model. $PRICE$ is an amount, and Mtok means a million tokens.',
    placeholders: ['PRICE'],
  },
  optModelPriceNoImages: {
    message: '$PRICE$ per million tokens (input / output) · no images',
    description: 'Price of a model that cannot read images. $PRICE$ is an amount, and Mtok means a million tokens.',
    placeholders: ['PRICE'],
  },
  optModelUnknown: {
    message: 'unknown model, so its price and image support are not known',
    description: 'Shown for a model identifier that the extension has no data about.',
  },
  optAccessNotRemoved: {
    message: 'Access to $ORIGIN$ could not be removed.',
    description: 'Error shown when a site permission could not be removed. $ORIGIN$ is a site address pattern.',
    placeholders: ['ORIGIN'],
  },
  optUsesNone: {
    message: 'No transforms use this site',
    description: 'Says how many transforms apply to a site.',
  },
  optUsesOne: {
    message: '1 transform uses this site',
    description: 'Says how many transforms apply to a site.',
  },
  optUsesMany: {
    message: '$COUNT$ transforms use this site',
    description: 'Says how many transforms apply to a site. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optSiteAccessTitle: {
    message: 'Site access',
    description: 'Heading of the list of sites that the extension can read and change.',
  },
  optSiteAccessBody: {
    message: 'Web Alchemist can read and change these sites. Removing access stops transforms from running on that site until access is granted again.',
    description: 'Explains the list of sites that the extension can read and change.',
  },
  optBlockedOne: {
    message: 'Across all sites, 1 transform is blocked by the safety check and is not running.',
    description: 'Shown on the settings page when the safety check blocks a saved transform on any site.',
  },
  optBlockedMany: {
    message: 'Across all sites, $COUNT$ transforms are blocked by the safety check and are not running.',
    description: 'Shown on the settings page when the safety check blocks saved transforms. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optNoAccess: {
    message: 'Web Alchemist has no access to any site.',
    description: 'Shown when no site permission is held.',
  },
  optRemoveAccess: {
    message: 'Remove access',
    description: 'Button that removes the permission for a site.',
  },
  optUsageRemovedProvider: {
    message: 'Removed provider',
    description: 'Stands in for the name of a provider that was deleted.',
  },
  optUsageNotReported: {
    message: 'not reported',
    description: 'Says that the provider did not report token use.',
  },
  optUsageSomeNotReported: {
    message: '$UNREPORTED$ of $CALLS$ calls not reported',
    description: 'Says for how many model calls the provider did not report token use. Both values are numbers.',
    placeholders: ['UNREPORTED', 'CALLS'],
  },
  optUsageCostPartial: {
    message: '$COST$ ($PRICED$ of $REPORTED$ calls priced)',
    description: 'Cost of model calls when some calls have no known price. $COST$ is an amount; the other values are numbers.',
    placeholders: ['COST', 'PRICED', 'REPORTED'],
  },
  optUsageSeparator: {
    message: ', ',
    description: 'Goes between the figures that describe model use, for example the tokens, the number of calls that were not reported and the cost.',
  },
  optUsageTitle: {
    message: 'Usage',
    description: 'Heading of the section about model calls and their cost.',
  },
  optUsageNone: {
    message: 'No model calls have been recorded.',
    description: 'Shown when no model call was made.',
  },
  optUsagePerProvider: {
    message: 'Per provider, by month (UTC)',
    description: 'Heading of a list of model use for each provider and month.',
  },
  optUsageCallOne: {
    message: '1 call, $SUMMARY$',
    description: 'Number of model calls followed by their token use and cost. $SUMMARY$ is a list of figures.',
    placeholders: ['SUMMARY'],
  },
  optUsageCalls: {
    message: '$COUNT$ calls, $SUMMARY$',
    description: 'Number of model calls followed by their token use and cost. $COUNT$ is a number and $SUMMARY$ is a list of figures.',
    placeholders: ['COUNT', 'SUMMARY'],
  },
  optUsagePerTransform: {
    message: 'Per transform',
    description: 'Heading of a list of model use for each transform.',
  },
  optUsageDrafts: {
    message: 'Drafts that were not saved',
    description: 'Name of the row that adds up the model use of drafts.',
  },
  optUsageDeleted: {
    message: 'Deleted transform',
    description: 'Name of a row whose transform no longer exists.',
  },
  optVaultWrongPassphrase: {
    message: 'The passphrase is not correct.',
    description: 'Error shown when the passphrase does not unlock the vault.',
  },
  optVaultTitle: {
    message: 'How your API keys are stored',
    description: 'Heading of the section about how API keys and sign-ins are stored.',
  },
  optVaultAbout: {
    message: 'A passphrase changes that. Your keys are encrypted with it, and nothing stored on this computer can decrypt them without it. You unlock them once each time you start the browser.',
    description: 'Explains what a passphrase does.',
  },
  optVaultNoRecovery: {
    message: 'A forgotten passphrase cannot be recovered. If it is lost, you have to enter your keys again.',
    description: 'Warns that a forgotten passphrase cannot be recovered.',
  },
  optVaultOldCopy: {
    message: 'Turning this on encrypts your keys from then on. The plain-text copy already saved in this profile cannot be erased by an extension and stays readable until the browser overwrites it. If that matters to you, replace the key at your provider afterwards.',
    description: 'Warns that an earlier plain-text copy of the keys may remain.',
  },
  optVaultLimits: {
    message: 'This protects the keys stored on disk. It does not protect them from code running inside this extension while it is unlocked, because that code can ask for the keys the same way the extension does.',
    description: 'Says what the passphrase does not protect against.',
  },
  optVaultIdleBefore: {
    message: 'Lock automatically after',
    description: 'Text before the choice of how long the vault stays unlocked. The full label reads: Lock automatically after (choice) without a request to a provider.',
  },
  optVaultIdleAfter: {
    message: 'without a request to a provider',
    description: 'Text after the choice of how long the vault stays unlocked.',
  },
  optVaultLockNote: {
    message: 'While locked, nothing can be generated until the passphrase is entered again. With Never selected, the keys stay unlocked until the browser closes or "Lock now" is pressed.',
    description: 'Explains automatic locking.',
  },
  optVaultProtect: {
    message: 'Protect with a passphrase',
    description: 'Button that opens the form to set a passphrase.',
  },
  optVaultLockNow: {
    message: 'Lock now',
    description: 'Button that locks the vault.',
  },
  optVaultUnlock: {
    message: 'Unlock',
    description: 'Button that opens the form to unlock the vault.',
  },
  optVaultRemove: {
    message: 'Remove the passphrase',
    description: 'Button that opens the form to remove the passphrase.',
  },
  optVaultNewPassphrase: {
    message: 'New passphrase',
    description: 'Label of the passphrase box.',
  },
  optVaultPassphrase: {
    message: 'Passphrase',
    description: 'Label of the passphrase box.',
  },
  optVaultAgain: {
    message: 'Type it again',
    description: 'Label of the box that repeats the new passphrase.',
  },
  optVaultMinimum: {
    message: 'At least $COUNT$ characters. A longer passphrase is stronger than one with more symbols.',
    description: 'Hint about the passphrase. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optVaultMismatch: {
    message: 'The passphrases do not match.',
    description: 'Error shown when the two passphrases differ.',
  },
  optVaultPlainAgain: {
    message: 'Your keys go back to being stored as plain text in this profile.',
    description: 'Explains what removing the passphrase does.',
  },
  optVaultWorking: {
    message: 'Working…',
    description: 'Button text while the vault is changed.',
  },
  optVaultEncrypt: {
    message: 'Encrypt my keys',
    description: 'Button that encrypts the keys with the new passphrase.',
  },
  optVaultRemoveIt: {
    message: 'Remove it',
    description: 'Button that removes the passphrase.',
  },
  optVaultForgotten: {
    message: 'I have forgotten it',
    description: 'Button that offers to discard the keys when the passphrase is lost.',
  },
  optVaultDiscardNote: {
    message: 'A forgotten passphrase cannot be recovered. Discarding deletes the stored keys so you can enter them again. Your transforms are kept.',
    description: 'Explains what discarding the stored keys does.',
  },
  optVaultDiscard: {
    message: 'Discard the stored keys',
    description: 'Button that deletes the stored keys.',
  },
  optVaultKeep: {
    message: 'Keep them',
    description: 'Button that cancels discarding the stored keys.',
  },
  optRedirectUnavailable: {
    message: 'unavailable in this browser',
    description: 'Shown in place of the redirect address when the sign-in feature is missing.',
  },
  optHostNotSet: {
    message: 'not set',
    description: 'Shown in place of a provider address that is empty.',
  },
  optTypeOpenAiHint: {
    message: 'Any provider that works with the OpenAI chat API',
    description: 'Describes the provider type that works with any compatible address.',
  },
  optTypeOpenAi: {
    message: 'OpenAI-compatible',
    description: 'Name of a provider type.',
  },
  optProviders: {
    message: 'Providers',
    description: 'Heading of the list of providers.',
  },
  optNoProvider: {
    message: 'No AI provider is set up, so nothing can be generated. Add Anthropic or any provider that works with the OpenAI chat API.',
    description: 'Shown when no provider is set up.',
  },
  optOauth: {
    message: 'sign-in',
    description: 'How the provider is signed in to.',
  },
  optApiKey: {
    message: 'API key',
    description: 'How the provider is signed in to.',
  },
  optSignedIn: {
    message: 'Signed in',
    description: 'Says that the provider is signed in to.',
  },
  optUntil: {
    message: 'until $DATE$',
    description: 'When a sign-in expires. $DATE$ is a date and time.',
    placeholders: ['DATE'],
  },
  optUntilThenSignIn: {
    message: 'until $DATE$, then sign in again',
    description: 'When a sign-in expires and cannot be renewed. $DATE$ is a date and time.',
    placeholders: ['DATE'],
  },
  optNoRefresh: {
    message: 'cannot be renewed; sign in again when it ends',
    description: 'Says that a sign-in cannot be renewed.',
  },
  optMakeActive: {
    message: 'Make active',
    description: 'Button that makes a provider the one in use.',
  },
  optReplaceKey: {
    message: 'Replace key',
    description: 'Button that opens the box for an API key.',
  },
  optSetKey: {
    message: 'Set key',
    description: 'Button that opens the box for an API key.',
  },
  optSignInSettings: {
    message: 'Sign-in settings',
    description: 'Button that opens the settings for signing in to a provider.',
  },
  optUseSignIn: {
    message: 'Use sign-in instead',
    description: 'Button that opens the settings for signing in to a provider.',
  },
  optClear: {
    message: 'Clear',
    description: 'Button that deletes the stored key of a provider.',
  },
  optPriceLabel: {
    message: 'Price, US dollars per million tokens (optional)',
    description: 'Label above the boxes for the price of a provider\'s models.',
  },
  optPriceInput: {
    message: 'Input',
    description: 'Label of the box for the price of input tokens.',
  },
  optPriceOutput: {
    message: 'Output',
    description: 'Label of the box for the price of output tokens.',
  },
  optKeyReplacePlaceholder: {
    message: 'New key (replaces the stored one)',
    description: 'Hint shown in the empty box for a new API key.',
  },
  optKeyPastePlaceholder: {
    message: 'Paste the key',
    description: 'Hint shown in the empty box for an API key.',
  },
  optSave: {
    message: 'Save',
    description: 'Button that saves the API key.',
  },
  optOauthExplain: {
    message: 'Copy these values from the provider\'s documentation. Web Alchemist opens the provider\'s sign-in page and stores the token it returns the same way as an API key. The token never reaches this page.',
    description: 'Explains the sign-in settings.',
  },
  optOauthAuthEndpoint: {
    message: 'Authorization endpoint',
    description: 'Label of the box for a sign-in address.',
  },
  optOauthAuthPlaceholder: {
    message: 'https://provider.example/oauth/authorize',
    description: 'Example of a sign-in address, shown in the empty box.',
  },
  optOauthTokenEndpoint: {
    message: 'Token endpoint',
    description: 'Label of the box for a token address.',
  },
  optOauthTokenPlaceholder: {
    message: 'https://provider.example/oauth/token',
    description: 'Example of a token address, shown in the empty box.',
  },
  optOauthClientId: {
    message: 'Client ID',
    description: 'Label of the box for a client identifier.',
  },
  optOauthScopes: {
    message: 'Scopes',
    description: 'Label of the box for sign-in scopes.',
  },
  optOauthScopesPlaceholder: {
    message: 'space separated, or leave empty',
    description: 'Hint shown in the empty box for sign-in scopes.',
  },
  optRedirect: {
    message: 'Register $URL$ as the redirect URI with the provider.',
    description: 'Tells the user what to enter at the provider. $URL$ is an address.',
    placeholders: ['URL'],
  },
  optWaiting: {
    message: 'Waiting for the provider…',
    description: 'Button text while the sign-in page is open.',
  },
  optSignIn: {
    message: 'Sign in',
    description: 'Button that opens the sign-in page of the provider.',
  },
  optAddAnother: {
    message: 'Add another provider',
    description: 'Button that opens the form for another provider.',
  },
  optProviderType: {
    message: 'Provider type',
    description: 'Accessible name of the choice of provider type.',
  },
  optFieldName: {
    message: 'Name',
    description: 'Label of the box for the name of a provider.',
  },
  optNameAnthropic: {
    message: 'Anthropic',
    description: 'Example name of a provider, shown in the empty box.',
  },
  optNameLocal: {
    message: 'Local llama.cpp',
    description: 'Example name of a provider, shown in the empty box.',
  },
  optBaseUrl: {
    message: 'Base URL',
    description: 'Label of the box for the address of a provider.',
  },
  optBaseUrlPlaceholder: {
    message: 'https://example.com/v1',
    description: 'Example of a provider address, shown in the empty box.',
  },
  optBaseUrlError: {
    message: 'The address must start with https://, or be a localhost address.',
    description: 'Error shown when the address of a provider is not allowed.',
  },
  optApiKeyLabel: {
    message: 'API key',
    description: 'Label of the box for an API key.',
  },
  optKeyPlain: {
    message: 'Stored as plain text in this browser profile unless a passphrase is set.',
    description: 'Note under the box for an API key.',
  },
  optAddProvider: {
    message: 'Add provider',
    description: 'Button that adds a provider.',
  },
  optFileNotJson: {
    message: 'This file is not a Web Alchemist export.',
    description: 'Error shown when the chosen file cannot be parsed.',
  },
  optExportWarning: {
    message: 'The file contains the descriptions of the transforms, the addresses they apply to, and the start of the text of each page element they change. On a mail, banking or health site, that text can be personal. The file is plain text unless you encrypt it with a passphrase. Anyone with the file and the passphrase can read it, and a forgotten passphrase cannot be recovered.',
    description: 'Warning shown before an export file is written.',
  },
  optPassphraseShort: {
    message: 'The passphrase must be at least $COUNT$ characters long.',
    description: 'Reason a passphrase for an export cannot be used. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optPassphraseMismatch: {
    message: 'The passphrases do not match.',
    description: 'Reason a passphrase for an export cannot be used.',
  },
  optResultImportedOne: {
    message: 'Imported 1 transform. It is turned off.',
    description: 'What the user is told after an import.',
  },
  optResultImported: {
    message: 'Imported $COUNT$ transforms. They are all turned off.',
    description: 'What the user is told after an import. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optResultRegenOne: {
    message: '1 transform has no code and needs regenerating from the description.',
    description: 'What the user is told after an import.',
  },
  optResultRegen: {
    message: '$COUNT$ transforms have no code and need regenerating from the description.',
    description: 'What the user is told after an import. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optResultAwaitingOne: {
    message: '1 transform was restored with JavaScript code. It stays off until you read and approve its code in the sidebar.',
    description: 'What the user is told after an import.',
  },
  optResultAwaiting: {
    message: '$COUNT$ transforms were restored with JavaScript code. Each stays off until you read and approve its code in the sidebar.',
    description: 'What the user is told after an import. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optResultSettings: {
    message: 'The accent colour and health check mode were restored.',
    description: 'What the user is told after an import.',
  },
  optResultDuplicateOne: {
    message: '1 transform was already saved, so it was skipped.',
    description: 'What the user is told after an import.',
  },
  optResultDuplicates: {
    message: '$COUNT$ transforms were already saved, so they were skipped.',
    description: 'What the user is told after an import. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optResultRefusedOne: {
    message: '1 transform could not be imported.',
    description: 'What the user is told after an import.',
  },
  optResultRefused: {
    message: '$COUNT$ transforms could not be imported.',
    description: 'What the user is told after an import. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optResultNoAccess: {
    message: 'Access to the sites was not granted, so the imported transforms show "No access to this site" until it is.',
    description: 'What the user is told after an import.',
  },
  optSavedEncrypted: {
    message: 'Saved an encrypted file. It can be imported only with the passphrase.',
    description: 'Shown after an export file was saved.',
  },
  optSavedPlain: {
    message: 'Saved a file that is not encrypted.',
    description: 'Shown after an export file was saved.',
  },
  optKindJs: {
    message: 'JavaScript',
    description: 'Name of a kind of transform.',
  },
  optExportTitle: {
    message: 'Export and import',
    description: 'Heading of the section about export and import.',
  },
  optExportBody1: {
    message: '"Export to share" saves your transforms to a file that you can give to someone else. JavaScript transforms are saved as their descriptions only, without code. "Back up" also saves the JavaScript code, the accent colour and the health check mode, so that everything can be restored on another computer. Neither file contains your API keys, sign-ins or provider settings. Both files contain text and addresses from the pages the transforms were written for, and either can be encrypted with a passphrase.',
    description: 'Explains the two kinds of export file.',
  },
  optExportBody2: {
    message: 'Import shows what a file would add before anything is saved. Imported transforms are always turned off. JavaScript from a shared file has no code until you read its description, then generate and check the code in the sidebar. JavaScript code from a backup stays off until you read and approve it in the sidebar.',
    description: 'Explains what an import does.',
  },
  optExportShare: {
    message: 'Export to share',
    description: 'Button that exports transforms to a file for sharing. It is also the heading of the form that follows.',
  },
  optBackUp: {
    message: 'Back up',
    description: 'Button that exports transforms and settings to a backup file. It is also the heading of the form that follows.',
  },
  optImportFile: {
    message: 'Import from file',
    description: 'Button that imports transforms from a file.',
  },
  optFileLabel: {
    message: 'File to import',
    description: 'Accessible name of the file chooser.',
  },
  optRepeatPassphrase: {
    message: 'Repeat the passphrase',
    description: 'Label of the box that repeats the passphrase of an export file.',
  },
  optSaveEncrypted: {
    message: 'Save encrypted file',
    description: 'Button that saves the export file encrypted.',
  },
  optSavePlain: {
    message: 'Save without encryption',
    description: 'Button that saves the export file without encryption.',
  },
  optIsEncrypted: {
    message: '$NAME$ is encrypted',
    description: 'Heading shown when the chosen file is encrypted. $NAME$ is a file name.',
    placeholders: ['NAME'],
  },
  optDecrypt: {
    message: 'Decrypt and show contents',
    description: 'Button that decrypts the chosen file.',
  },
  optContentsOf: {
    message: 'Contents of $NAME$',
    description: 'Heading above what an import file holds. $NAME$ is a file name.',
    placeholders: ['NAME'],
  },
  optBackupNote: {
    message: 'This file is a backup. Its JavaScript code is restored, but each script stays off until you read and approve its code. Code that fails the safety check is not restored.',
    description: 'Explains what importing a backup file does.',
  },
  optNoTransforms: {
    message: 'The file holds no transforms.',
    description: 'Shown when an import file is empty.',
  },
  optAppliesTo: {
    message: 'Applies to: $SITES$',
    description: 'Says which pages an imported transform applies to. $SITES$ is a phrase.',
    placeholders: ['SITES'],
  },
  optWillNotImport: {
    message: 'Will not be imported. $REASON$',
    description: 'Says an imported transform is refused. $REASON$ is a sentence.',
    placeholders: ['REASON'],
  },
  optWillSkip: {
    message: 'Will be skipped. $REASON$',
    description: 'Says an imported transform is skipped. $REASON$ is a sentence.',
    placeholders: ['REASON'],
  },
  optCodeRestored: {
    message: 'Code restored; it stays off until you approve it.',
    description: 'Says restored code waits for approval.',
  },
  optMainNote: {
    message: 'This code is set to run in the page\'s own world (MAIN), where the page can read and change it. The risks are listed when you approve it.',
    description: 'Says restored code is set to run in the page\'s own world.',
  },
  optShowCode: {
    message: 'Show code',
    description: 'Heading of a section that shows the code of an imported transform.',
  },
  optReasonRegen: {
    message: '$REASON$ It will need regenerating.',
    description: 'Says an imported transform has no code. $REASON$ is a sentence.',
    placeholders: ['REASON'],
  },
  optCodeNotImported: {
    message: 'Code not imported; will need regenerating.',
    description: 'Says an imported transform has no code.',
  },
  optAuthorDescription: {
    message: 'Description by the author of this file, not by you: $TEXT$',
    description: 'Shows the description of an imported transform. $TEXT$ is the text in quotation marks.',
    placeholders: ['TEXT'],
  },
  optRestoreSettings: {
    message: 'Also restore the accent colour ($ACCENT$) and the health check mode ($MODE$)',
    description: 'Label of a checkbox on the import preview. $ACCENT$ and $MODE$ are setting values.',
    placeholders: ['ACCENT', 'MODE'],
  },
  optNothingImportable: {
    message: 'Nothing in this file can be imported.',
    description: 'Summary of an import file.',
  },
  optWillImportOne: {
    message: '$COUNT$ of $TOTAL$ will be imported, turned off. Importing asks for access to this site: $SITES$.',
    description: 'Summary of an import file. $COUNT$ and $TOTAL$ are numbers and $SITES$ is a site address pattern.',
    placeholders: ['COUNT', 'TOTAL', 'SITES'],
  },
  optWillImportMany: {
    message: '$COUNT$ of $TOTAL$ will be imported, turned off. Importing asks for access to these sites: $SITES$.',
    description: 'Summary of an import file. $COUNT$ and $TOTAL$ are numbers and $SITES$ is a list of site address patterns.',
    placeholders: ['COUNT', 'TOTAL', 'SITES'],
  },
  optImportOne: {
    message: 'Import 1 transform',
    description: 'Button that imports the transforms of the file.',
  },
  optImportMany: {
    message: 'Import $COUNT$ transforms',
    description: 'Button that imports the transforms of the file. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optPageTitle: {
    message: 'Web Alchemist settings',
    description: 'Title of the browser tab of the settings page.',
  },
})
