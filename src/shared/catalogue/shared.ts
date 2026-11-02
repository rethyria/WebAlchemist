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
    description: 'Label of a choice for which pages a transform applies to.',
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
    message: 'This transform came from an imported file and has no code yet. To create the code, open a page it applies to and choose Edit description.',
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
    message: 'Applies to CSS transforms only. Firefox cannot limit JavaScript transforms to one container, so they run in every container. The container is taken from the tab the sidebar showed when this editor opened. Saving asks for the cookies permission, which Firefox needs to report a tab\'s container.',
  },
  containerUnreadableNote: {
    message: 'This transform is limited to one container, but without the cookies permission Firefox cannot report a tab\'s container, so the transform applies in no tab. To fix this, save it and grant the cookies permission, or choose "Every tab".',
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
    message: 'Stop running all transforms',
  },
  killSwitchNote: {
    message: 'Stops all CSS and JavaScript transforms on every site. CSS is removed from open tabs straight away. A tab that already ran JavaScript keeps running it until the tab is reloaded.',
    description: 'Explains what the setting that stops every transform does.',
  },
  killSwitchOnOneTab: {
    message: 'One open tab may still be running JavaScript. Reload it to stop it.',
    description: 'Shown after the setting that stops every transform is turned on. $COUNT$ is not used for one tab.',
  },
  killSwitchOnTabs: {
    message: '$COUNT$ open tabs may still be running JavaScript. Reload them to stop it.',
    description: 'Shown after the setting that stops every transform is turned on. $COUNT$ is the number of open tabs.',
    placeholders: ['COUNT'],
  },
  killSwitchOffOneTab: {
    message: 'Reload 1 open tab to run JavaScript transforms there again.',
    description: 'Shown after the setting that stops every transform is turned off.',
  },
  killSwitchOffTabs: {
    message: 'Reload $COUNT$ open tabs to run JavaScript transforms there again.',
    description: 'Shown after the setting that stops every transform is turned off. $COUNT$ is the number of open tabs.',
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
    description: 'Says what produced a version of a transform.',
  },
  sourceRepair: {
    message: 'Repaired by the model',
    description: 'Says what produced a version of a transform.',
  },
  sourceAiEdit: {
    message: 'Changed by the model',
    description: 'Says what produced a version of a transform.',
  },
  sourceHandEdit: {
    message: 'Edited by hand',
    description: 'Says what produced a version of a transform.',
  },
  sourceUnknown: {
    message: 'Source not recorded',
    description: 'Says what produced a version of a transform.',
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
    description: 'Shown when a transform has no capabilities.',
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
    message: 'One saved transform uses $ORIGIN$. If you remove access, it stops running there and its CSS is removed from open tabs. Remove access?',
    description: 'Question asked before the permission for a site is removed. $ORIGIN$ is a site address pattern.',
    placeholders: ['ORIGIN'],
  },
  removeAccessQuestionMany: {
    message: '$COUNT$ saved transforms use $ORIGIN$. If you remove access, they stop running there and their CSS is removed from open tabs. Remove access?',
    description: 'Question asked before the permission for a site is removed. $COUNT$ is a number and $ORIGIN$ is a site address pattern.',
    placeholders: ['COUNT', 'ORIGIN'],
  },
  matchPresetSubdomains: {
    message: '$DOMAIN$ and all its subdomains',
    description: 'Label of a choice for which pages a transform applies to. $DOMAIN$ is a domain name.',
    placeholders: ['DOMAIN'],
  },
})
