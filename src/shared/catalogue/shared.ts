import { defineMessages } from './define'

/** Messages of the shared surface. */
export const sharedMessages = defineMessages({
  screenshotsUnavailable: {
    message: 'Screenshots cannot be taken in Firefox for Android. The request can still be sent without one.',
  },
  accountSignInUnavailable: {
    message: 'Signing in with a provider account is not available in this browser. Use an API key instead.',
  },
  endpointInvalid: {
    message: 'The address is not valid.',
    description: 'Why a provider address is refused.',
  },
  endpointNeedsHttps: {
    message: 'The address must use https. Plain http is allowed only for addresses on this computer, such as localhost.',
    description: 'Why a provider address is refused.',
  },
  endpointNeedsScheme: {
    message: 'The address must start with https:// (or http:// for localhost).',
    description: 'Why a provider address is refused.',
  },
  excludedSiteMessage: {
    message: '$HOST$ is on your list of excluded sites, so picking and generating are turned off there. Remove it from the list in the settings to use Web Alchemist on it.',
    description: '$HOST$ is a site name.',
    placeholders: ['HOST'],
  },
  sensitivePageTitle: {
    message: 'This page has password or payment fields',
  },
  sensitivePageMessage: {
    message: 'Generating sends text from this page to your AI provider, and the page may show private information. Send the page content only if that is acceptable.',
  },
  matchPresetExactPage: {
    message: 'This exact page',
    description: 'Label of a choice for which pages an elixir applies to.',
  },
  matchSchemeHttps: {
    message: 'https pages',
    description: 'Describes which pages a match pattern covers.',
  },
  matchSchemeHttp: {
    message: 'http pages',
    description: 'Describes which pages a match pattern covers.',
  },
  matchSchemeBoth: {
    message: 'http and https pages',
    description: 'Describes which pages a match pattern covers.',
  },
  matchSitesAll: {
    message: 'every site',
    description: 'Describes which sites a match pattern covers.',
  },
  matchSitesWithSubdomains: {
    message: '$DOMAIN$ and all its subdomains',
    description: 'Describes which sites a match pattern covers. $DOMAIN$ is a domain name.',
    placeholders: ['DOMAIN'],
  },
  matchSitesOneHost: {
    message: '$HOST$ only, not its subdomains',
    description: 'Describes which sites a match pattern covers. $HOST$ is a host name.',
    placeholders: ['HOST'],
  },
  matchPagesAll: {
    message: 'every page',
    description: 'Describes which pages a match pattern covers.',
  },
  matchPagesPrefix: {
    message: 'pages whose address starts with $PATH$',
    description: 'Describes which pages a match pattern covers. $PATH$ is the start of a path.',
    placeholders: ['PATH'],
  },
  matchPagesFits: {
    message: 'pages whose address matches $PATH$',
    description: 'Describes which pages a match pattern covers. $PATH$ is a path pattern.',
    placeholders: ['PATH'],
  },
  matchPagesOne: {
    message: 'only the page $PATH$',
    description: 'Describes which pages a match pattern covers. $PATH$ is a path.',
    placeholders: ['PATH'],
  },
  matchVariantSlash: {
    message: 'It also covers the same page with a slash at the end.',
    description: 'Added when a pattern names one page that has a query.',
  },
  matchVariantQuery: {
    message: 'It also covers the same page with anything after a ? in the address, with or without a slash at the end.',
    description: 'Added when a pattern names one page that has no query.',
  },
  needsRegeneratingNote: {
    message: 'This elixir came from an imported file and has no code yet. To create the code, open a page it applies to and choose Edit description.',
  },
  awaitingApprovalNote: {
    message: 'This JavaScript was restored from a backup and has not been approved. Read its code, then approve it to turn it on.',
  },
  panelReopen: {
    message: 'Open Web Alchemist from its toolbar button on the page you want to change.',
    description: 'Tells the user how to open the panel again after it was refused.',
  },
  panelNoValidPage: {
    message: 'This panel was opened without a valid page. $REOPEN$',
    description: 'Shown when the panel cannot work. $REOPEN$ is the sentence that says how to open it again.',
    placeholders: ['REOPEN'],
  },
  panelPageClosed: {
    message: 'The page this panel was opened for is closed. $REOPEN$',
    description: 'Shown when the panel cannot work. $REOPEN$ is the sentence that says how to open it again.',
    placeholders: ['REOPEN'],
  },
  panelOwnPage: {
    message: 'This panel cannot work on Web Alchemist\'s own pages. $REOPEN$',
    description: 'Shown when the panel cannot work. $REOPEN$ is the sentence that says how to open it again.',
    placeholders: ['REOPEN'],
  },
  panelNotLinked: {
    message: 'This panel is not linked to that page, which can happen when Firefox restores a tab after a restart. $REOPEN$',
    description: 'Shown when the panel cannot work. $REOPEN$ is the sentence that says how to open it again.',
    placeholders: ['REOPEN'],
  },
  containerEveryTab: {
    message: 'Every tab',
    description: 'Choice in the editor.',
  },
  containerTabContainer: {
    message: 'Only in the container it was made in',
    description: 'Choice in the editor.',
  },
  containerScopeNote: {
    message: 'Applies to CSS elixirs only. Firefox cannot limit JavaScript elixirs to one container, so they run in every container. The container is taken from the tab the sidebar showed when this editor opened. Saving asks for the cookies permission, which Firefox needs to report a tab\'s container.',
  },
  containerUnreadableNote: {
    message: 'This elixir is limited to one container, but without the cookies permission Firefox cannot report a tab\'s container, so the elixir applies in no tab. To fix this, save it and grant the cookies permission, or choose "Every tab".',
  },
  containerTabUnknown: {
    message: 'The tab this editor was opened from has closed or cannot be read, so its container is not known. Open the editor again from the sidebar.',
  },
  importTooLarge: {
    message: 'This file is larger than 5 MB, which is more than a Web Alchemist export holds, so it was not read.',
  },
  importTooManyRecords: {
    message: 'This file holds $RECORDS$ records. An import takes at most $LIMIT$, so it was not read.',
    description: '$RECORDS$ is the number of records in the file; $LIMIT$ is the most that an import takes.',
    placeholders: ['RECORDS', 'LIMIT'],
  },
  somethingWentWrong: {
    message: 'Something went wrong.',
    description: 'Shown when the background reports an error without a message.',
  },
  killSwitchLabel: {
    message: 'Stop running all elixirs',
  },
  killSwitchNote: {
    message: 'Stops all CSS and JavaScript elixirs on every site. CSS is removed from open tabs straight away. A tab that already ran JavaScript keeps running it until the tab is reloaded.',
    description: 'Explains what the setting that stops every elixir does.',
  },
  killSwitchOnOneTab: {
    message: 'One open tab may still be running JavaScript. Reload it to stop it.',
    description: 'Shown after the setting that stops every elixir is turned on. $COUNT$ is not used for one tab.',
  },
  killSwitchOnTabs: {
    message: '$COUNT$ open tabs may still be running JavaScript. Reload them to stop it.',
    description: 'Shown after the setting that stops every elixir is turned on. $COUNT$ is the number of open tabs.',
    placeholders: ['COUNT'],
  },
  killSwitchOffOneTab: {
    message: 'Reload 1 open tab to run JavaScript elixirs there again.',
    description: 'Shown after the setting that stops every elixir is turned off.',
  },
  killSwitchOffTabs: {
    message: 'Reload $COUNT$ open tabs to run JavaScript elixirs there again.',
    description: 'Shown after the setting that stops every elixir is turned off. $COUNT$ is the number of open tabs.',
    placeholders: ['COUNT'],
  },
  importMatchEmpty: {
    message: 'The Applies to value is empty.',
    description: 'Why an imported match pattern is refused.',
  },
  importMatchAllSites: {
    message: 'The Applies to value covers every site.',
    description: 'Why an imported match pattern is refused.',
  },
  importMatchScheme: {
    message: 'The Applies to value uses the protocol $SCHEME$, which is not supported.',
    description: 'Why an imported match pattern is refused. $SCHEME$ is a URL scheme.',
    placeholders: ['SCHEME'],
  },
  importMatchSubdomains: {
    message: 'The host "$HOST$" covers every subdomain of $DOMAIN$. An import takes only an Applies to value that names one host.',
    description: 'Why an imported match pattern is refused.',
    placeholders: ['HOST', 'DOMAIN'],
  },
  importMatchNotPlainHost: {
    message: 'The host "$HOST$" is not a plain host name.',
    description: 'Why an imported match pattern is refused. $HOST$ is a host.',
    placeholders: ['HOST'],
  },
  importMatchNotPlainAddress: {
    message: 'The host "$HOST$" is not a plain address.',
    description: 'Why an imported match pattern is refused. $HOST$ is a host.',
    placeholders: ['HOST'],
  },
  importMatchPrivate: {
    message: 'The host "$HOST$" is on this computer or on a private network. An import does not take patterns for those.',
    description: 'Why an imported match pattern is refused. $HOST$ is a host.',
    placeholders: ['HOST'],
  },
  importMatchNotSite: {
    message: '"$HOST$" is not a site address.',
    description: 'Why an imported match pattern is refused. $HOST$ is a host.',
    placeholders: ['HOST'],
  },
  importMatchNoPath: {
    message: 'The Applies to value has no valid page address.',
    description: 'Why an imported match pattern is refused.',
  },
  importMatchSitesHttps: {
    message: '$PAGES$ on $HOST$, over https only',
    description: 'Describes an accepted imported pattern. $PAGES$ says which pages and $HOST$ names the site.',
    placeholders: ['PAGES', 'HOST'],
  },
  importMatchSitesHttp: {
    message: '$PAGES$ on $HOST$, over plain http only',
    description: 'Describes an accepted imported pattern. $PAGES$ says which pages and $HOST$ names the site.',
    placeholders: ['PAGES', 'HOST'],
  },
  importMatchSitesBoth: {
    message: '$PAGES$ on $HOST$, over http and https',
    description: 'Describes an accepted imported pattern. $PAGES$ says which pages and $HOST$ names the site.',
    placeholders: ['PAGES', 'HOST'],
  },
  importPagesAll: {
    message: 'Every page',
    description: 'Describes which pages an imported pattern covers.',
  },
  importPagesPrefix: {
    message: 'Pages whose address starts with $PATH$',
    description: 'Describes which pages an imported pattern covers. $PATH$ is the start of a path.',
    placeholders: ['PATH'],
  },
  importPagesMatch: {
    message: 'Pages whose address matches $PATH$',
    description: 'Describes which pages an imported pattern covers. $PATH$ is a path pattern.',
    placeholders: ['PATH'],
  },
  importPageOne: {
    message: 'The page $PATH$',
    description: 'Describes which page an imported pattern covers. $PATH$ is a path.',
    placeholders: ['PATH'],
  },
  usageNotReported: {
    message: 'Token usage: not reported',
  },
  usageTokens: {
    message: '$INPUT$ tokens in, $OUTPUT$ out',
    description: 'Token use of one model call. $INPUT$ and $OUTPUT$ are numbers.',
    placeholders: ['INPUT', 'OUTPUT'],
  },
  usageTokensWithCost: {
    message: '$INPUT$ tokens in, $OUTPUT$ out, $COST$',
    description: 'Token use and cost of one model call. $INPUT$ and $OUTPUT$ are numbers; $COST$ is an amount in US dollars.',
    placeholders: ['INPUT', 'OUTPUT', 'COST'],
  },
  sourceGeneration: {
    message: 'Generated by the model',
    description: 'Says what produced a version of an elixir.',
  },
  sourceRepair: {
    message: 'Repaired by the model',
    description: 'Says what produced a version of an elixir.',
  },
  sourceAiEdit: {
    message: 'Changed by the model',
    description: 'Says what produced a version of an elixir.',
  },
  sourceHandEdit: {
    message: 'Edited by hand',
    description: 'Says what produced a version of an elixir.',
  },
  sourceUnknown: {
    message: 'Source not recorded',
    description: 'Says what produced a version of an elixir.',
  },
  versionWorldNotCss: {
    message: 'Not used by CSS',
    description: 'Value in the comparison of two versions.',
  },
  versionWorldMain: {
    message: 'The page\'s own world (MAIN)',
    description: 'Value in the comparison of two versions.',
  },
  versionWorldIsolated: {
    message: 'Isolated world (USER_SCRIPT)',
    description: 'Value in the comparison of two versions.',
  },
  restoreMainRefusal: {
    message: 'This version runs in the page\'s own world. Read the risks and tick the box to confirm before restoring it.',
  },
  capabilitiesNone: {
    message: 'None',
    description: 'Shown when an elixir has no capabilities.',
  },
  versionRowMatch: {
    message: 'Applies to',
    description: 'Row heading in the comparison of two versions.',
  },
  versionRowCapabilities: {
    message: 'Access it asks for',
    description: 'Row heading in the comparison of two versions.',
  },
  versionRowWorld: {
    message: 'World',
    description: 'Row heading in the comparison of two versions.',
  },
  versionSame: {
    message: 'Same',
  },
  versionDifferent: {
    message: 'Different',
    description: 'Says that a value differs between the two versions.',
  },
  accentRed: {
    message: 'red',
    description: 'Name of an accent colour, read out by a screen reader for a colour swatch.',
  },
  accentOrange: {
    message: 'orange',
    description: 'Name of an accent colour, read out by a screen reader for a colour swatch.',
  },
  accentAmber: {
    message: 'amber',
    description: 'Name of an accent colour, read out by a screen reader for a colour swatch.',
  },
  accentGreen: {
    message: 'green',
    description: 'Name of an accent colour, read out by a screen reader for a colour swatch.',
  },
  accentBlue: {
    message: 'blue',
    description: 'Name of an accent colour, read out by a screen reader for a colour swatch.',
  },
  accentIndigo: {
    message: 'indigo',
    description: 'Name of an accent colour, read out by a screen reader for a colour swatch.',
  },
  accentViolet: {
    message: 'violet',
    description: 'Name of an accent colour, read out by a screen reader for a colour swatch.',
  },
  accentMono: {
    message: 'grey',
    description: 'Name of an accent colour, read out by a screen reader for a colour swatch.',
  },
  excludedAccessMessage: {
    message: '$HOST$ is on your list of excluded sites, so Web Alchemist does not ask for access to it. Remove it from the list in the settings first.',
    description: 'Shown when the extension refuses to ask for access to an excluded site. $HOST$ is a site name.',
    placeholders: ['HOST'],
  },
  idle5: {
    message: '5 minutes',
    description: 'Choice of how long the vault stays unlocked without a request to a provider.',
  },
  idle15: {
    message: '15 minutes',
    description: 'Choice of how long the vault stays unlocked without a request to a provider.',
  },
  idle30: {
    message: '30 minutes',
    description: 'Choice of how long the vault stays unlocked without a request to a provider.',
  },
  idle60: {
    message: '1 hour',
    description: 'Choice of how long the vault stays unlocked without a request to a provider.',
  },
  idle480: {
    message: '8 hours',
    description: 'Choice of how long the vault stays unlocked without a request to a provider.',
  },
  idleNever: {
    message: 'Never',
    description: 'Choice of how long the vault stays unlocked without a request to a provider.',
  },
  endpointNotAllowed: {
    message: 'The $WHAT$ is not allowed. $PROBLEM$',
    description: 'Error about an address that is refused. $WHAT$ names the setting, for example the base URL, and $PROBLEM$ says why.',
    placeholders: ['WHAT', 'PROBLEM'],
  },
  endpointNotAllowedFor: {
    message: 'The $WHAT$ of $PROVIDER$ is not allowed. $PROBLEM$',
    description: 'Error about an address that is refused. $WHAT$ names the setting, $PROVIDER$ is the name of a provider and $PROBLEM$ says why.',
    placeholders: ['WHAT', 'PROVIDER', 'PROBLEM'],
  },
  endpointNameBase: {
    message: 'base URL',
    description: 'Name of a provider setting, used inside a sentence.',
  },
  endpointNameToken: {
    message: 'token endpoint',
    description: 'Name of a provider setting, used inside a sentence.',
  },
  endpointNameAuthorization: {
    message: 'authorization endpoint',
    description: 'Name of a provider setting, used inside a sentence.',
  },
  removeAccessQuestionOne: {
    message: 'One saved elixir uses $ORIGIN$. If you remove access, it stops running there and its CSS is removed from open tabs. Remove access?',
    description: 'Question asked before the permission for a site is removed. $ORIGIN$ is a site address pattern.',
    placeholders: ['ORIGIN'],
  },
  removeAccessQuestionMany: {
    message: '$COUNT$ saved elixirs use $ORIGIN$. If you remove access, they stop running there and their CSS is removed from open tabs. Remove access?',
    description: 'Question asked before the permission for a site is removed. $COUNT$ is a number and $ORIGIN$ is a site address pattern.',
    placeholders: ['COUNT', 'ORIGIN'],
  },
  matchPresetSubdomains: {
    message: '$DOMAIN$ and all its subdomains',
    description: 'Label of a choice for which pages an elixir applies to. $DOMAIN$ is a domain name.',
    placeholders: ['DOMAIN'],
  },
  configKeyInvalid: {
    message: 'The setting key "$KEY$" is not valid. A key starts with a lowercase letter and has at most 32 letters and digits.',
    description: 'Why a setting that a generated elixir offers is dropped. $KEY$ is the key that the model wrote.',
    placeholders: ['KEY'],
  },
  configKeyDuplicate: {
    message: 'The setting key "$KEY$" is used more than once.',
    description: 'Why a setting that a generated elixir offers is dropped. $KEY$ is the key that the model wrote.',
    placeholders: ['KEY'],
  },
  configTooManyFields: {
    message: 'An elixir can have at most $COUNT$ settings.',
    description: 'Why settings that a generated elixir offers are dropped. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  configFieldPartInvalid: {
    message: 'The setting "$KEY$" has a missing or invalid $PART$.',
    description: 'Why a setting that a generated elixir offers is dropped. $KEY$ is the key of the setting and $PART$ names one part of its definition, such as label or default value.',
    placeholders: ['KEY', 'PART'],
  },
  configPartLabel: { message: 'label', description: 'Names one part of the definition of a setting, inside a sentence.' },
  configPartHelp: { message: 'help text', description: 'Names one part of the definition of a setting, inside a sentence.' },
  configPartType: { message: 'type', description: 'Names one part of the definition of a setting, inside a sentence.' },
  configPartOptions: { message: 'list of options', description: 'Names one part of the definition of a setting, inside a sentence.' },
  configPartColumns: { message: 'list of columns', description: 'Names one part of the definition of a setting, inside a sentence.' },
  configPartRange: { message: 'minimum, maximum or step', description: 'Names one part of the definition of a setting, inside a sentence.' },
  configPartUnit: { message: 'unit', description: 'Names one part of the definition of a setting, inside a sentence.' },
  configPartDefault: { message: 'default value', description: 'Names one part of the definition of a setting, inside a sentence.' },
  configValueNotText: { message: 'Enter text.', description: 'Why a value for a setting is refused.' },
  configValueTooLong: {
    message: 'This is longer than $COUNT$ characters.',
    description: 'Why a value for a setting is refused. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  configValueControl: {
    message: 'This contains a character that is not allowed, such as a line break.',
    description: 'Why a value for a setting is refused.',
  },
  configValueNotNumber: { message: 'Enter a number.', description: 'Why a value for a setting is refused.' },
  configValueBelowMin: {
    message: 'The number must be at least $MIN$.',
    description: 'Why a value for a setting is refused. $MIN$ is a number.',
    placeholders: ['MIN'],
  },
  configValueAboveMax: {
    message: 'The number must be at most $MAX$.',
    description: 'Why a value for a setting is refused. $MAX$ is a number.',
    placeholders: ['MAX'],
  },
  configValueNotYesNo: { message: 'Choose yes or no.', description: 'Why a value for a setting is refused.' },
  configValueNotChoice: { message: 'Choose one of the listed options.', description: 'Why a value for a setting is refused.' },
  configValueNotColour: {
    message: 'Enter a colour as # followed by six hexadecimal digits, for example #ffcc00.',
    description: 'Why a value for a setting is refused.',
  },
  configValueNotList: { message: 'This must be a list of text lines.', description: 'Why a value for a setting is refused.' },
  configValueTooManyItems: {
    message: 'There can be at most $COUNT$ items.',
    description: 'Why a value for a setting is refused. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  configValueBadRow: {
    message: 'Each row needs one text cell for every column.',
    description: 'Why a value for a setting is refused.',
  },
  configValuesTooLarge: {
    message: 'The values of the settings are larger than 64 KB.',
    description: 'Why values for settings are refused.',
  },
  configValueUnknownKey: {
    message: 'This elixir has no setting named "$KEY$".',
    description: 'Why values for settings are refused. $KEY$ is a setting key.',
    placeholders: ['KEY'],
  },
  configValuesNotSaved: {
    message: 'The settings were not saved. $PROBLEM$',
    description: 'Shown when values for settings are refused. $PROBLEM$ is the reason, a full sentence.',
    placeholders: ['PROBLEM'],
  },
  configFieldsNotValid: {
    message: 'The settings of this elixir are not valid. $PROBLEM$',
    description: 'Shown when the definition of the settings is refused. $PROBLEM$ is the reason, a full sentence.',
    placeholders: ['PROBLEM'],
  },
  configFileNotSettings: {
    message: 'This file is not a Web Alchemist settings file.',
    description: 'Shown when a file chosen for importing the values of settings has the wrong content.',
  },
  configFileTypeDiffers: {
    message: 'This setting has a different type in this elixir.',
    description: 'Why one value in a settings file is not applied.',
  },
  configFileNothingToApply: {
    message: 'The file has no values for the settings of this elixir.',
    description: 'Shown when a settings file is chosen and none of its values can be applied.',
  },
  configSettings: {
    message: 'Settings',
    description: 'Heading and button label for the settings of an elixir.',
  },
  configSave: {
    message: 'Save settings',
    description: 'Button that stores the values of the settings of an elixir.',
  },
  configResetDefaults: {
    message: 'Reset to defaults',
    description: 'Button that puts every setting back to its default value.',
  },
  configAddItem: {
    message: 'Add item',
    description: 'Button that adds one line to a list setting.',
  },
  configAddRow: {
    message: 'Add row',
    description: 'Button that adds one row to a table setting.',
  },
  configRemoveItem: {
    message: 'Remove',
    description: 'Button that removes one line of a list or one row of a table.',
  },
  configRemoveItemLabel: {
    message: 'Remove item $N$ of $FIELD$',
    description: 'Accessible name of a button that removes one line of a list setting. $N$ is a position and $FIELD$ is the name of the setting.',
    placeholders: ['N', 'FIELD'],
  },
  configRemoveRowLabel: {
    message: 'Remove row $N$ of $FIELD$',
    description: 'Accessible name of a button that removes one row of a table setting. $N$ is a position and $FIELD$ is the name of the setting.',
    placeholders: ['N', 'FIELD'],
  },
  configItemLabel: {
    message: 'Item $N$ of $FIELD$',
    description: 'Accessible name of one line of a list setting. $N$ is a position and $FIELD$ is the name of the setting.',
    placeholders: ['N', 'FIELD'],
  },
  configCellLabel: {
    message: '$COLUMN$, row $N$ of $FIELD$',
    description: 'Accessible name of one cell of a table setting. $COLUMN$ is a column name, $N$ a row position and $FIELD$ the name of the setting.',
    placeholders: ['COLUMN', 'N', 'FIELD'],
  },
  configColourPicker: {
    message: 'Colour picker for $FIELD$',
    description: 'Accessible name of a colour picker. $FIELD$ is the name of the setting.',
    placeholders: ['FIELD'],
  },
  configColourCode: {
    message: 'Colour code for $FIELD$',
    description: 'Accessible name of the text box for a colour code. $FIELD$ is the name of the setting.',
    placeholders: ['FIELD'],
  },
  configRangeBoth: {
    message: 'From $MIN$ to $MAX$',
    description: 'Shows the allowed range of a number setting. $MIN$ and $MAX$ are numbers, optionally with a unit.',
    placeholders: ['MIN', 'MAX'],
  },
  configRangeMin: {
    message: 'At least $MIN$',
    description: 'Shows the smallest allowed value of a number setting. $MIN$ is a number, optionally with a unit.',
    placeholders: ['MIN'],
  },
  configRangeMax: {
    message: 'At most $MAX$',
    description: 'Shows the largest allowed value of a number setting. $MAX$ is a number, optionally with a unit.',
    placeholders: ['MAX'],
  },
  configFixProblems: {
    message: 'Fix the settings that show a problem, then save.',
    description: 'Shown when the settings cannot be saved because a value is not valid.',
  },
  configSaved: {
    message: 'Settings saved.',
    description: 'Shown after the values of the settings were stored.',
  },
  configReloadPage: {
    message: 'Reload the page to use the new settings.',
    description: 'Shown after the settings of a JavaScript elixir were changed. A script cannot change a page that is already open.',
  },
  configReloadPageButton: {
    message: 'Reload page',
    description: 'Button that reloads the page after the settings of a JavaScript elixir were changed.',
  },
  configReloadTabsOne: {
    message: 'Reload the open tab of this site to use the new settings.',
    description: 'Shown in the editor after the settings of a JavaScript elixir were changed.',
  },
  configReloadTabsMany: {
    message: 'Reload the $COUNT$ open tabs of this site to use the new settings.',
    description: 'Shown in the editor after the settings of a JavaScript elixir were changed. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  configExport: {
    message: 'Export settings',
    description: 'Button that saves the values of the settings of one elixir to a file.',
  },
  configImport: {
    message: 'Import settings',
    description: 'Button that applies a file of setting values to one elixir.',
  },
  configImportApplied: {
    message: 'Applied $COUNT$ values from the file.',
    description: 'Shown after a settings file was applied. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  configImportNoneApplied: {
    message: 'No values from the file were applied.',
    description: 'Shown after a settings file was read and none of its values could be applied.',
  },
  configImportSkipped: {
    message: 'Not applied: $LIST$',
    description: 'Lists the settings whose value from a settings file was not applied, each with the reason. $LIST$ is a list.',
    placeholders: ['LIST'],
  },
  configImportSkippedItem: {
    message: '$FIELD$ ($REASON$)',
    description: 'One entry of the list of settings that were not applied. $FIELD$ is the name of a setting and $REASON$ the reason.',
    placeholders: ['FIELD', 'REASON'],
  },
  configImportIgnored: {
    message: 'Ignored $COUNT$ values in the file for settings that this elixir does not have.',
    description: 'Shown after a settings file was applied. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  configTypeText: {
    message: 'text',
    description: 'Name of a type of setting, used in a list.',
  },
  configTypeNumber: {
    message: 'number',
    description: 'Name of a type of setting, used in a list.',
  },
  configTypeYesNo: {
    message: 'yes or no',
    description: 'Name of a type of setting, used in a list.',
  },
  configTypeChoice: {
    message: 'choice',
    description: 'Name of a type of setting, used in a list.',
  },
  configTypeColour: {
    message: 'colour',
    description: 'Name of a type of setting, used in a list.',
  },
  configTypeList: {
    message: 'list',
    description: 'Name of a type of setting, used in a list.',
  },
  configTypeTable: {
    message: 'table',
    description: 'Name of a type of setting, used in a list.',
  },
  configSummaryLine: {
    message: 'Settings: $LIST$',
    description: 'One line in the approval panel that names the settings the code reads. $LIST$ is a list of names with their types.',
    placeholders: ['LIST'],
  },
  configSummaryItem: {
    message: '$FIELD$ ($TYPE$)',
    description: 'One entry in the list of settings. $FIELD$ is the name of a setting and $TYPE$ its type.',
    placeholders: ['FIELD', 'TYPE'],
  },
  configDefaultsFold: {
    message: 'Defaults of the settings',
    description: 'Label of a section in the approval panel that lists the default value of each setting.',
  },
  configDefaultLine: {
    message: '$FIELD$: $VALUE$',
    description: 'One line in a list of settings. $FIELD$ is the name of a setting and $VALUE$ is a value.',
    placeholders: ['FIELD', 'VALUE'],
  },
  configNotKeptRemoved: {
    message: 'Your value for $FIELD$ is not kept: the new version has no such setting.',
    description: 'Shown in the approval panel when a value that the user set is lost. $FIELD$ is the name of a setting.',
    placeholders: ['FIELD'],
  },
  configNotKeptType: {
    message: 'Your value for $FIELD$ is not kept: the new version has a different type of setting.',
    description: 'Shown in the approval panel when a value that the user set is lost. $FIELD$ is the name of a setting.',
    placeholders: ['FIELD'],
  },
  configNotKeptInvalid: {
    message: 'Your value for $FIELD$ is not kept: the value does not fit the new version of the setting.',
    description: 'Shown in the approval panel when a value that the user set is lost. $FIELD$ is the name of a setting.',
    placeholders: ['FIELD'],
  },
  configRestoredHeading: {
    message: 'Settings and values in this file',
    description: 'Heading in the panel where restored code is approved. The values came from the file.',
  },
  configValueRows: {
    message: '$COUNT$ rows',
    description: 'Short description of the value of a table setting. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  configValueItems: {
    message: '$COUNT$ items',
    description: 'Short description of the value of a list setting. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  configValueEmpty: {
    message: 'empty',
    description: 'Short description of an empty value of a setting.',
  },
  configValueYes: {
    message: 'yes',
    description: 'Short description of the value of a yes or no setting.',
  },
  configValueNo: {
    message: 'no',
    description: 'Short description of the value of a yes or no setting.',
  },
  configEditorIntro: {
    message: 'Change the values that the code of this elixir reads. The code stays as it is.',
    description: 'Text under the heading of the settings section in the editor.',
  },
})
