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
    message: 'The stored credentials could not be read: $ERROR$ The credential status below is not known.',
    description: 'Error shown on the settings page. $ERROR$ is the error text.',
    placeholders: ['ERROR'],
  },
  optBindingError: {
    message: 'The vault change was made, but the stored keys could not be checked against their providers: $ERROR$ The check is repeated when a stored key is next used.',
    description: 'Error shown on the settings page after the passphrase setting changed. $ERROR$ is the error text.',
    placeholders: ['ERROR'],
  },
  optAccent: {
    message: 'Accent',
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
    message: 'On these sites, and on their subdomains, Web Alchemist does not pick elements or generate transforms, and does not ask for permission to read them. The list is empty until sites are added.',
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
    message: 'model id',
    description: 'Hint shown in the empty box for a model identifier.',
  },
  optModelPrice: {
    message: '$PRICE$ per Mtok',
    description: 'Price of a model. $PRICE$ is an amount, and Mtok means a million tokens.',
    placeholders: ['PRICE'],
  },
  optModelPriceNoImages: {
    message: '$PRICE$ per Mtok · no images',
    description: 'Price of a model that cannot read images. $PRICE$ is an amount, and Mtok means a million tokens.',
    placeholders: ['PRICE'],
  },
  optModelUnknown: {
    message: 'not a known model — cost and image support unknown',
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
    message: 'The sites Web Alchemist can read and change. Removing access stops its transforms from running there until access is granted again.',
    description: 'Explains the list of sites that the extension can read and change.',
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
    message: 'Transform not saved or deleted',
    description: 'Name of a row whose transform no longer exists.',
  },
  optVaultWrongPassphrase: {
    message: 'That passphrase is not the one that was set.',
    description: 'Error shown when the passphrase does not unlock the vault.',
  },
  optVaultTitle: {
    message: 'How your credentials are stored',
    description: 'Heading of the section about how credentials are stored.',
  },
  optVaultAbout: {
    message: 'A passphrase changes that. Your keys are encrypted with it, and nothing stored on this machine can decrypt them without it — so reading the profile directory yields ciphertext and nothing else. You unlock once each time you start the browser.',
    description: 'Explains what a passphrase does.',
  },
  optVaultNoRecovery: {
    message: 'There is no way to recover a forgotten passphrase. That is what makes it worth something, and it means losing it means re-entering your keys.',
    description: 'Warns that a forgotten passphrase cannot be recovered.',
  },
  optVaultOldCopy: {
    message: 'Turning this on encrypts your keys from that point on. It cannot erase the copy already written to this profile — browsers give extensions no way to reclaim that space, and it stays readable until the browser reuses it. If that matters to you, replace the key at your provider after turning this on.',
    description: 'Warns that an earlier plain-text copy of the keys may remain.',
  },
  optVaultLimits: {
    message: 'This protects the profile at rest. It does not protect against software already running inside this extension while it is unlocked, which can ask for the keys the same way the extension itself does.',
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
    message: 'Locking stops generation until the passphrase is entered again. With Never selected, the vault stays unlocked until the browser closes or it is locked by hand.',
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
    message: 'At least $COUNT$ characters. Length matters more than symbols here.',
    description: 'Hint about the passphrase. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optVaultMismatch: {
    message: 'The two do not match.',
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
    message: 'There is no recovery. Discarding deletes the stored keys so you can enter them again; your transforms are not affected.',
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
    message: 'Any endpoint speaking the OpenAI chat API',
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
    message: 'No provider is set up. Nothing can be generated until one is — Anthropic, or any endpoint speaking the OpenAI chat API.',
    description: 'Shown when no provider is set up.',
  },
  optOauth: {
    message: 'OAuth',
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
    message: 'no refresh token; sign in again when it ends',
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
    message: 'New key — replaces the stored one',
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
    message: 'From the provider\'s own documentation. Web Alchemist opens their sign-in page and stores the token it returns; the token is held the same way an API key is and never reaches this page.',
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
    message: 'Needs to be an https URL, or localhost.',
    description: 'Error shown when the address of a provider is not allowed.',
  },
  optApiKeyLabel: {
    message: 'API key',
    description: 'Label of the box for an API key.',
  },
  optKeyPlain: {
    message: 'Stored as plain text in this browser profile — see below.',
    description: 'Note under the box for an API key.',
  },
  optAddProvider: {
    message: 'Add provider',
    description: 'Button that adds a provider.',
  },
  optFileNotJson: {
    message: 'This file is not valid JSON, so it cannot be a Web Alchemist export.',
    description: 'Error shown when the chosen file cannot be parsed.',
  },
  optExportWarning: {
    message: 'The file contains text taken from the pages the transforms were written for (the start of the text of each element they target), the descriptions of the transforms, and the addresses they apply to. On a mail, banking or health site that text can be personal. The file is saved as plain text unless it is encrypted with a passphrase. Anyone with the passphrase and the file can read it, and a forgotten passphrase cannot be recovered.',
    description: 'Warning shown before an export file is written.',
  },
  optPassphraseShort: {
    message: 'The passphrase must be at least $COUNT$ characters long.',
    description: 'Reason a passphrase for an export cannot be used. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optPassphraseMismatch: {
    message: 'The two passphrases are not the same.',
    description: 'Reason a passphrase for an export cannot be used.',
  },
  optResultImportedOne: {
    message: 'Imported 1 transform. They are all turned off.',
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
    message: '1 transform was restored with JavaScript code. Each stays off until its code has been read and approved in the sidebar.',
    description: 'What the user is told after an import.',
  },
  optResultAwaiting: {
    message: '$COUNT$ transforms were restored with JavaScript code. Each stays off until its code has been read and approved in the sidebar.',
    description: 'What the user is told after an import. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optResultSettings: {
    message: 'The accent colour and health check mode were restored.',
    description: 'What the user is told after an import.',
  },
  optResultDuplicateOne: {
    message: '1 transform already saved and skipped.',
    description: 'What the user is told after an import.',
  },
  optResultDuplicates: {
    message: '$COUNT$ transforms already saved and skipped.',
    description: 'What the user is told after an import. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  optResultRefusedOne: {
    message: '1 transform refused.',
    description: 'What the user is told after an import.',
  },
  optResultRefused: {
    message: '$COUNT$ transforms refused.',
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
    message: 'Export to share saves your transforms to a JSON file that can be given to someone else. JavaScript is saved as its description only, without code. Back up also saves the JavaScript code and the accent colour and health check mode, so that the set can be restored on another computer. Neither file contains credentials or provider settings. Both files hold text and addresses taken from the pages the transforms were written for, and either can be encrypted with a passphrase when it is saved.',
    description: 'Explains the two kinds of export file.',
  },
  optExportBody2: {
    message: 'Import reads such a file and shows what it would add before anything is saved. Imported transforms are always turned off. Imported JavaScript from a shared file has no code until its description has been read and code has been generated and reviewed here. JavaScript code from a backup stays off until the code has been read and approved.',
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
    message: 'This file is a backup. JavaScript code in it is restored, but each script stays off until its code has been read and approved. Code that fails the static analysis is not restored.',
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
    message: 'Description written by the author of the file, not by you: $TEXT$',
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
