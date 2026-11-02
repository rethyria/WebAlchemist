import { defineMessages } from './define'

/** Messages of the background surface. */
export const backgroundMessages = defineMessages({
  bgACapabilityWasUsedWithoutBeing: {
    message: 'The code uses network, storage or cookie access that it did not ask for.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgItLoadsAddressesOutsideTheSite: {
    message: 'It loads addresses outside the site that were not approved.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisFileIsEncryptedEnterIts: {
    message: 'This file is encrypted. Enter its passphrase to import it.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheFileCouldNotBeDecrypted: {
    message: 'The file could not be decrypted. The passphrase is wrong, or the file was changed.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheSignInDidNotComplete: {
    message: 'The sign-in did not complete.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheSignInResponseDidNot: {
    message: 'The sign-in response did not match the request, so it was not accepted.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheProviderReturnedNoAuthorizationCode: {
    message: 'The provider returned no authorization code.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheProviderDidNotReturnA: {
    message: 'The provider did not return a usable token.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheSignInServerCouldNot: {
    message: 'The sign-in server could not be reached, or it redirected the token request, which is not allowed. Check the token endpoint in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgStaticAnalysisRejectedThisCodeSo: {
    message: 'This code did not pass the safety check, so it was not saved.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisCodeWasNotApprovedIn: {
    message: 'This code was not approved in this browser session, so it was not saved. Review it again and save.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisCssLoadsExternalAddressesThat: {
    message: 'This CSS loads external addresses that were not approved, so it was not saved.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgOnlyTheExtensionCanApproveCode: {
    message: 'Only the extension can approve code.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgStaticAnalysisRejectedThisCodeSo2: {
    message: 'This code did not pass the safety check, so it was not approved.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgWebAlchemistIsLockedEnterYour: {
    message: 'Web Alchemist is locked. Enter your passphrase in settings to unlock it.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgWebAlchemistCouldNotTellWhich: {
    message: 'Web Alchemist could not find or read the tab for this request, so nothing was sent to your AI provider. Close the sidebar, open it again from the tab you want to change, and try again.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgWebAlchemistDoesNotPickGenerate: {
    message: 'Elixirs cannot be made in a private window, because a saved elixir keeps text from the page after the window closes. Use a normal window. Elixirs you already saved still apply in private windows.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisCssLoadsAddressesOutsideThe: {
    message: 'This CSS loads addresses outside the site that are not approved yet, so it was not applied to the page.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgRunningJavascriptTransformsNeedsAnExtra: {
    message: 'Running JavaScript elixirs needs an extra permission. Grant it from the sidebar.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgRunningTransformsIsSwitchedOffIn: {
    message: '"Stop running all elixirs" is turned on in settings, so the JavaScript was not run. Turn it off to run the JavaScript.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisCodeDidNotPassThe: {
    message: 'This code did not pass the safety check, so it was not run.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgNoAiProviderIsSetUp: {
    message: 'No AI provider is set up yet. Add one in settings to start generating elixirs.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgNoAiProviderIsSelected: {
    message: 'No AI provider is selected.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgFirefoxHasNotGrantedTheUser: {
    message: 'Firefox has not granted the user scripts permission, so scripts cannot run.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheRecordIsMissingAField: {
    message: 'This elixir in the file is damaged or incomplete.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgATransformWithTheSameName: {
    message: 'An elixir with the same name, kind, sites and content is already saved.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgAnthropicSupportsApiKeysOnlyOauth: {
    message: 'Anthropic supports API keys only. Its sign-in works only in Claude Code and Claude.ai.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheModelDeclinedThisRequestTry: {
    message: 'The model declined this request. Try rewording what you asked for.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheModelReturnedNoUsableResponse: {
    message: 'The model returned no usable response.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheModelReturnedAResponseThat: {
    message: 'The model returned a response that could not be read.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThatApiKeyWasRejectedCheck: {
    message: 'That API key was rejected. Check it in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgRateLimitedByTheProviderWait: {
    message: 'The provider is limiting requests. Wait a moment and try again.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgCouldNotReachTheProvider: {
    message: 'Could not reach the provider.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheSignInForThisProvider: {
    message: 'The sign-in for this provider was removed. Reconnect it in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheSignInHasEndedAnd: {
    message: 'The sign-in has expired and this provider cannot renew it. Sign in again in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheSignInForThisProvider2: {
    message: 'The sign-in for this provider changed while it was being renewed. Try again.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgCouldNotReachTheSignIn: {
    message: 'Could not reach the sign-in server.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgSignInExpiredReconnectThisProvider: {
    message: 'Sign-in expired. Reconnect this provider in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheSignInServerReturnedA: {
    message: 'The sign-in server returned a response in the wrong format. Reconnect this provider in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheSignInServerReturnedNo: {
    message: 'The sign-in server returned no access token. Reconnect this provider in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheVaultLockPeriodMustBe: {
    message: 'The time before locking must be a whole number of minutes, or 0 for never.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgAProviderWithThatIdAlready: {
    message: 'A provider with that id already exists.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheActiveProviderMustBeOne: {
    message: 'The active provider must be one that is set up.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThatProviderIsNoLongerConfigured: {
    message: 'That provider is no longer set up.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheCredentialsAreAlreadyProtectedBy: {
    message: 'Your keys are already protected by a passphrase. Remove it first to set a different one.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgStoredCredentialsCanBeDiscardedOnly: {
    message: 'Stored keys can be discarded only while they are protected by a passphrase and locked.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisFileIsNotAWeb: {
    message: 'This file is not a Web Alchemist export.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisMessageIsOnlyAcceptedFrom: {
    message: 'This message is only accepted from the extension\'s own pages.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThatTransformNoLongerExists: {
    message: 'That elixir no longer exists.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisTransformCameFromAnImported: {
    message: 'This elixir came from an imported file. Read its description first with "Edit description".',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThatVersionIsNoLongerKept: {
    message: 'That version is no longer kept.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThatPageIsNotAWebsite: {
    message: 'That page is not a website, so Web Alchemist cannot be turned off there.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgAnthropicDoesNotOfferSignIn: {
    message: 'Anthropic does not offer sign-in to third-party applications. Use an API key.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisProviderHasNoSignIn: {
    message: 'This provider has no sign-in endpoints set up. Add them in settings first.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgStaticAnalysisRejectedThisCodeSo3: {
    message: 'This code did not pass the safety check, so it was not run.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisPageCannotBePreviewedSo: {
    message: 'This page cannot be previewed, so the script was not run.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheTabHasMovedToAnother: {
    message: 'The tab has moved to another page, so the script was not run.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThisPageIsNotOneThat: {
    message: 'This elixir does not apply to this page, so the script was not run.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheModelReviewDidNotMatch: {
    message: 'The code check has not approved this code, so the script was not run. Select Check the code again.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThePageChangedWhileThePreview: {
    message: 'The page changed while the preview was being prepared, so it was not shown.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgRunningTransformsIsSwitchedOffIn2: {
    message: '"Stop running all elixirs" is turned on in settings, so the preview was not shown. Turn it off to see a preview.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgWebAlchemistIsTurnedOffOn: {
    message: 'Web Alchemist is turned off on this site, so the preview was not shown. Turn it on for this site to preview.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheWindowSizeOrZoomChanged: {
    message: 'The window size or zoom changed after you drew the area, so it no longer matches the page. Draw the area again.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheAreaYouDrewIsNo: {
    message: 'The area you drew is no longer on screen. Scroll it back into view, or draw it again.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThePageThisRunIsAbout: {
    message: 'The page you were working on is no longer open, so nothing was captured.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThePageThisRunIsAbout2: {
    message: 'The page you were working on is not the selected tab, so nothing was captured. Switch back to it and try again.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgThePageThisRunIsAbout3: {
    message: 'The page you were working on has moved to another address, so nothing was captured.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgTheTabChangedWhileTheScreenshot: {
    message: 'The tab changed while the screenshot was being taken, so the image was discarded. Try again.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgCouldNotPrepareTheImage: {
    message: 'Could not prepare the image.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgCouldNotReadTheImage: {
    message: 'Could not read the image.',
    description: 'Text that the background returns to the interface, which shows it to the user.',
  },
  bgItsCodeDoesNotPassThe: {
    message: 'Its code does not pass the current safety check, so it is not running. $REASON$',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: REASON.',
    placeholders: ['REASON'],
  },
  bgIsNotASiteNameSo: {
    message: '"$ENTRY$" is not a site name, so the list was not changed.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: ENTRY.',
    placeholders: ['ENTRY'],
  },
  bgThePassphraseMustBeAtLeast: {
    message: 'The passphrase must be at least $MIN_PASSPHRASE_LENGTH$ characters long.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: MIN_PASSPHRASE_LENGTH.',
    placeholders: ['MIN_PASSPHRASE_LENGTH'],
  },
  bgTheProviderRefusedTheSignIn: {
    message: 'The provider refused the sign-in ($ERROR$).',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: ERROR.',
    placeholders: ['ERROR'],
  },
  bgTheProviderRejectedTheSignIn: {
    message: 'The provider rejected the sign-in ($STATUS$). Check the client ID and endpoints in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: STATUS.',
    placeholders: ['STATUS'],
  },
  bgNoApiKeyIsConfiguredFor: {
    message: 'No API key is set up for $LABEL$.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgTheModelIsNotAvailableFrom: {
    message: 'The model $MODEL$ is not available from $LABEL$. Choose another model in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: MODEL, LABEL.',
    placeholders: ['MODEL', 'LABEL'],
  },
  bgReportsABillingProblemSuchAs: {
    message: '$LABEL$ reports a billing problem, such as no remaining credit. Add credit or fix billing with the provider, then try again.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgRateLimitedByTheProviderIt: {
    message: 'The provider is limiting requests. Try again in $SECONDS$ seconds.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: SECONDS.',
    placeholders: ['SECONDS'],
  },
  bgProviderReturnedAnError: {
    message: 'The provider returned an error ($STATUS$): $DETAIL$',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: STATUS, DETAIL.',
    placeholders: ['STATUS', 'DETAIL'],
  },
  bgProviderReturnedAnError2: {
    message: 'The provider returned an error ($STATUS$).',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: STATUS.',
    placeholders: ['STATUS'],
  },
  bgHasNoBaseUrlConfigured: {
    message: '$LABEL$ has no base URL set up.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgTheBaseUrlForIsNot: {
    message: 'The base URL for $LABEL$ is not allowed. $BASE_PROBLEM$ Change it in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL, BASE_PROBLEM.',
    placeholders: ['LABEL', 'BASE_PROBLEM'],
  },
  bgNoCredentialIsConfiguredFor: {
    message: 'No API key or sign-in is set up for $LABEL$.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgCouldNotReach: {
    message: 'Could not reach $LABEL$.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgReturnedAResponseThatIsNot: {
    message: '$LABEL$ returned a response in the wrong format. Check the base URL in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgReturnedNoUsableResponse: {
    message: '$LABEL$ returned no usable response.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgReturnedAResponseThatCouldNot: {
    message: '$LABEL$ returned a response that could not be read. This model may not support the format that Web Alchemist needs. Try another model in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgTheSignInServerAddressIs: {
    message: 'The sign-in server address is not allowed. $ENDPOINT_ISSUE$ Reconnect this provider in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: ENDPOINT_ISSUE.',
    placeholders: ['ENDPOINT_ISSUE'],
  },
  bgRejectedTheCredentialCheckItIn: {
    message: '$LABEL$ rejected the API key or sign-in. Check it in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgRateLimitedByWaitAMoment: {
    message: '$LABEL$ is limiting requests. Wait a moment and try again.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgRateLimitedByItAskedFor: {
    message: '$LABEL$ is limiting requests. Try again in $SECONDS$ seconds.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL, SECONDS.',
    placeholders: ['LABEL', 'SECONDS'],
  },
  bgReturnedAnError: {
    message: '$LABEL$ returned an error ($STATUS$).',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL, STATUS.',
    placeholders: ['LABEL', 'STATUS'],
  },
  bgTheCodeIsWaitingForApproval: {
    message: 'The code was not run. $AWAITING_APPROVAL_NOTE$',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: AWAITING_APPROVAL_NOTE.',
    placeholders: ['AWAITING_APPROVAL_NOTE'],
  },
  bgThePriceForMustBeTwo: {
    message: 'The input and output prices for $LABEL$ must be numbers of 0 or more.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgTheProviderFieldCannotBeRemoved: {
    message: 'The provider field "$KEY$" cannot be removed.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: KEY.',
    placeholders: ['KEY'],
  },
  bgThisTransformHasNoValidField: {
    message: 'This elixir has no valid "$PROBLEM$" field, so it was not saved.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: PROBLEM.',
    placeholders: ['PROBLEM'],
  },
  bgThePassphraseMustBeAtLeast2: {
    message: 'The passphrase must be at least $MIN_PASSPHRASE_LENGTH$ characters long.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: MIN_PASSPHRASE_LENGTH.',
    placeholders: ['MIN_PASSPHRASE_LENGTH'],
  },
  bgTheKeyForCannotBeUsed: {
    message: 'The key for $LABEL$ cannot be used because the provider has no valid address. Fix the address in settings and enter the key again.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgTheKeyForHasNoRecorded: {
    message: 'The key for $LABEL$ is not linked to a provider address, so it was not sent. Enter it again in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgTheKeyForWasEnteredFor: {
    message: 'The key for $LABEL$ was entered for $ENTERED$, but the provider now uses $CURRENT$, so the key was not sent. Enter it again in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL, ENTERED, CURRENT.',
    placeholders: ['LABEL', 'ENTERED', 'CURRENT'],
  },
  bgHasNoValidAddressToBind: {
    message: '$LABEL$ has no valid address, so the key cannot be saved. Fix the address in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: LABEL.',
    placeholders: ['LABEL'],
  },
  bgThisFileWasMadeByA: {
    message: 'This file was made by a newer version of Web Alchemist (file version $SCHEMA_VERSION$). Update the extension to import it.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: SCHEMA_VERSION.',
    placeholders: ['SCHEMA_VERSION'],
  },
  bgThePatternReachesWhichIsOn: {
    message: 'This elixir applies to $EXCLUDED$, which is on your list of excluded sites. To import it, first remove that site from the list in settings.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: EXCLUDED.',
    placeholders: ['EXCLUDED'],
  },
  bgThisFileAsksForAccessTo: {
    message: 'This file asks for access to more than $MAX_IMPORT_ORIGINS$ sites, so this elixir was not imported. Import a smaller file.',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: MAX_IMPORT_ORIGINS.',
    placeholders: ['MAX_IMPORT_ORIGINS'],
  },
  bgTheCssIsNotImportedBecause: {
    message: 'The CSS was not imported because it did not pass the safety check. $PROBLEM$',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: PROBLEM.',
    placeholders: ['PROBLEM'],
  },
  bgTheCodeIsNotRestoredBecause: {
    message: 'The code was not restored because it did not pass the safety check. $PROBLEM$',
    description: 'Text that the background returns to the interface, which shows it to the user. Placeholders: PROBLEM.',
    placeholders: ['PROBLEM'],
  },
  bgUnnamedRecord: {
    message: 'Unnamed elixir',
    description: 'Name shown for an imported record that has no name.',
  },
  bgSetToRunInMainNotApproved: {
    message: 'It is set to run in the page\'s own world (MAIN), where the page can read and change it. This has not been approved, so it is not running.',
    description: 'Reason shown for an elixir that is set to run in the page\'s own world without the user\'s approval.',
  },
  bgNotSiteNameCssSetting: {
    message: 'That is not a site name, so its CSS setting was not changed.',
    description: 'Error shown when a site name for a CSS setting is not valid.',
  },
  bgNotCssSetting: {
    message: 'That is not a CSS setting, so it was not changed.',
    description: 'Error shown when a CSS setting value is not valid.',
  },
})
