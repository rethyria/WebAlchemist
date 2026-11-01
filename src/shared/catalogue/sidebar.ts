import { defineMessages } from './define'

/** Messages of the sidebar surface. */
export const sidebarMessages = defineMessages({
  firstRunTitle: {
    message: 'Before you add a key',
    description: 'Main heading of the first-run disclosure.',
  },
  firstRunLead: {
    message: 'Web Alchemist sends page content to an AI model provider that you choose. Read what is sent and what is stored before you enter an API key or sign in.',
    description: 'Opening paragraph of the first-run disclosure.',
  },
  firstRunAcknowledge: {
    message: 'I have read this',
    description: 'Button that records that the disclosure was read.',
  },
  firstRunWriteMyself: {
    message: 'Write it myself instead',
    description: 'Link that skips the provider and opens the editor to write a transform by hand.',
  },
  firstRunHandNote: {
    message: 'Writing a transform by hand needs no provider and sends nothing.',
  },
  pickingModeDrawing: {
    message: 'Drawing a rectangle',
    description: 'Describes what the picker is doing.',
  },
  pickingModeCrop: {
    message: 'Resolved from your rectangle',
    description: 'Describes what the picker is doing.',
  },
  pickingModeTouch: {
    message: 'Waiting for a tap on the page',
    description: 'Describes what the picker is doing.',
  },
  pickingModeHover: {
    message: 'Hovering the page',
    description: 'Describes what the picker is doing.',
  },
  pickingKeyParent: {
    message: 'Parent',
    description: 'Meaning of a keyboard key while picking an element.',
  },
  pickingKeyChild: {
    message: 'First child',
    description: 'Meaning of a keyboard key while picking an element.',
  },
  pickingKeySibling: {
    message: 'Previous / next sibling',
    description: 'Meaning of a keyboard key while picking an element.',
  },
  pickingKeyConfirm: {
    message: 'Confirm this element',
    description: 'Meaning of a keyboard key while picking an element.',
  },
  pickingKeyEscape: {
    message: 'esc',
    description: 'Name of the Escape key as shown on a key cap.',
  },
  cancel: {
    message: 'Cancel',
  },
  pickingTitle: {
    message: 'Pick an element',
    description: 'Heading of the panel in which an element is picked.',
  },
  pickingCurrent: {
    message: 'Current element',
    description: 'Label above the path of the element under the pointer.',
  },
  pickingTapHint: {
    message: 'Tap an element on the page.',
  },
  pickingMoveHint: {
    message: 'Move the pointer over the page, or use the arrow keys.',
  },
  pickingTouchLabel: {
    message: 'Picking by touch',
    description: 'Label above the instructions for picking on a touch screen.',
  },
  pickingTouchHelp: {
    message: 'The page is shown while picking. Tap an element to select it. To draw an area instead, touch and hold still for half a second, then drag. A drag that starts sooner scrolls the page. After a tap, this panel comes back and lists the element\'s parent, children and siblings, which can be chosen from the tree.',
  },
  pickingKeysLabel: {
    message: 'Walk the tree',
    description: 'Label above the list of keyboard keys that move through the page\'s elements.',
  },
  pickingCrop: {
    message: 'crop $WIDTH$ × $HEIGHT$',
    description: 'Size of a drawn area. $WIDTH$ and $HEIGHT$ are numbers of pixels.',
    placeholders: ['WIDTH', 'HEIGHT'],
  },
  announceContext: {
    message: 'Reading the element and its ancestors.',
    description: 'Read out by a screen reader while a transform is generated.',
  },
  announceSent: {
    message: 'Request sent to the model.',
    description: 'Read out by a screen reader while a transform is generated.',
  },
  announceThinking: {
    message: 'The model is thinking.',
    description: 'Read out by a screen reader while a transform is generated.',
  },
  announceStreaming: {
    message: 'The model is writing code.',
    description: 'Read out by a screen reader while a transform is generated.',
  },
  announceAnalysis: {
    message: 'Running static analysis.',
    description: 'Read out by a screen reader while a transform is generated.',
  },
  announcePreview: {
    message: 'Applying a preview to the page.',
    description: 'Read out by a screen reader while a transform is generated.',
  },
  announceReviewing: {
    message: 'Reviewing the code.',
    description: 'Read out by a screen reader when the review of generated code changes.',
  },
  announceOneBlocking: {
    message: 'One problem stops this from being saved.',
    description: 'Read out by a screen reader when the review of generated code changes.',
  },
  announceBlocking: {
    message: '$COUNT$ problems stop this from being saved.',
    description: 'Read out by a screen reader when the review of generated code changes. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  announceOneWarning: {
    message: 'One warning.',
    description: 'Read out by a screen reader when the review of generated code changes.',
  },
  announceWarnings: {
    message: '$COUNT$ warnings.',
    description: 'Read out by a screen reader when the review of generated code changes. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  announceModelDisagrees: {
    message: 'The second model review disagrees with the description.',
    description: 'Read out by a screen reader when the review of generated code changes.',
  },
  announceCleanCss: {
    message: 'Review finished. No problems found. CSS is not sent for model review.',
    description: 'Read out by a screen reader when the review of generated code changes.',
  },
  announceClean: {
    message: 'Review finished. No problems found.',
    description: 'Read out by a screen reader when the review of generated code changes.',
  },
  announceFinished: {
    message: 'Review finished.',
    description: 'Read out by a screen reader when the review of generated code changes.',
  },
  announceOneBroken: {
    message: '1 transform stopped working.',
    description: 'Read out by a screen reader when the health check finds a broken transform.',
  },
  announceBroken: {
    message: '$COUNT$ transforms stopped working.',
    description: 'Read out by a screen reader when the health check finds broken transforms. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  retryAnnouncement: {
    message: 'Trying again in up to $SECONDS$ seconds',
    description: 'Read out by a screen reader while a failed request waits to be retried. $SECONDS$ is a number.',
    placeholders: ['SECONDS'],
  },
  generatingStepContext: {
    message: 'Read the element and its ancestors',
    description: 'A step in the checklist shown while a transform is generated.',
  },
  generatingStepSentShot: {
    message: 'Sent $SIZE$ kB of page context, with a screenshot',
    description: 'A step in the checklist shown while a transform is generated. $SIZE$ is a number of kilobytes.',
    placeholders: ['SIZE'],
  },
  generatingStepSentNoShot: {
    message: 'Sent $SIZE$ kB of page context, no screenshot',
    description: 'A step in the checklist shown while a transform is generated. $SIZE$ is a number of kilobytes.',
    placeholders: ['SIZE'],
  },
  generatingStepThinkingCount: {
    message: 'Thinking — $COUNT$ characters',
    description: 'A step in the checklist shown while a transform is generated. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  generatingStepThinking: {
    message: 'Thinking',
    description: 'A step in the checklist shown while a transform is generated.',
  },
  generatingStepWritingLines: {
    message: 'Writing code — $COUNT$ lines so far',
    description: 'A step in the checklist shown while a transform is generated. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  generatingStepWriting: {
    message: 'Writing code',
    description: 'A step in the checklist shown while a transform is generated.',
  },
  generatingStepAnalysis: {
    message: 'Static analysis',
    description: 'A step in the checklist shown while a transform is generated.',
  },
  generatingStepPreview: {
    message: 'Preview on the page',
    description: 'A step in the checklist shown while a transform is generated.',
  },
  generatingTitle: {
    message: 'Generating',
    description: 'Heading while a transform is generated, before the kind is known.',
  },
  generatingTitleJs: {
    message: 'Writing JavaScript',
    description: 'Heading while JavaScript is generated.',
  },
  generatingTitleCss: {
    message: 'Writing CSS',
    description: 'Heading while CSS is generated.',
  },
  generatingBarLabel: {
    message: 'Working',
    description: 'Accessible name of the progress bar shown while a transform is generated.',
  },
  savingStep1: {
    message: 'Step 1 of 3 · Confirm',
    description: 'Small heading above the confirmation step. The three steps are confirm, choose where it applies, and continue.',
  },
  savingTitle: {
    message: 'Is this what you meant?',
    description: 'Heading of the step that asks the user to confirm the description of the change.',
  },
  savingNoteConsolidated: {
    message: 'Written from your messages. Edit it — this is the text used to rebuild the transform when the site changes.',
    description: 'Note under the description of the change, when the description was written from several messages.',
  },
  savingNote: {
    message: 'Edit it — this is the text used to rebuild the transform when the site changes.',
    description: 'Note under the description of the change.',
  },
  savingStep2: {
    message: 'Step 2 · Where it applies',
    description: 'Small heading above the choice of pages that the transform applies to.',
  },
  savingWhereLabel: {
    message: 'Where it applies',
    description: 'Accessible name of the group of choices for which pages the transform applies to.',
  },
  savingMeta: {
    message: '$COUNT$ lines · $KIND$',
    description: 'Size and kind of the generated code. $COUNT$ is a number and $KIND$ is CSS or JS.',
    placeholders: ['COUNT', 'KIND'],
  },
  savingCodeAndRationale: {
    message: 'Code and rationale',
  },
  savingApproach: {
    message: 'Approach',
  },
  savingContinue: {
    message: 'Continue',
    description: 'Button that moves on to review.',
  },
  approvalRunsIn: {
    message: 'It runs in: $WORLD$.',
    description: 'Says which execution world restored code runs in. $WORLD$ is the name of the world.',
    placeholders: ['WORLD'],
  },
  approvalRisksIntro: {
    message: 'Running in the page\'s own world has these risks:',
  },
  approvalRisksRead: {
    message: 'I have read the risks and want this code to run in the page\'s own world',
    description: 'Label of a checkbox that confirms the risks were read.',
  },
  approvalCapabilities: {
    message: 'It declares these capabilities: $LIST$.',
    description: 'Lists what restored code declares it can do. $LIST$ is a list of capability names.',
    placeholders: ['LIST'],
  },
  approvalApprove: {
    message: 'Approve and turn on',
    description: 'Button that approves restored code and turns the transform on.',
  },
  describingLocked: {
    message: 'locked',
    description: 'Marks that the picked element is fixed while the user describes the change.',
  },
  describingChange: {
    message: 'Change',
    description: 'Button that returns to picking a different element.',
  },
  describingTreeLabel: {
    message: 'Or target another element',
    description: 'Label above the list of elements around the picked one.',
  },
  describingOrigin: {
    message: 'picked',
    description: 'Marks the element where the pick started, in the list of elements.',
  },
  describingScopeLabel: {
    message: 'How widely should it apply?',
    description: 'Label above the slider that sets how many elements the change reaches.',
  },
  describingScopeAria: {
    message: 'How widely should it apply',
    description: 'Accessible name of the slider that sets how many elements the change reaches.',
  },
  describingScopeOne: {
    message: 'Just this element.',
    description: 'Note under the scope slider.',
  },
  describingScopeInsideOne: {
    message: 'Only this one inside $CONTAINER$, outlined on the page.',
    description: 'Note under the scope slider. $CONTAINER$ is the name of an element.',
    placeholders: ['CONTAINER'],
  },
  describingScopeInsideMany: {
    message: 'All $COUNT$ like it inside $CONTAINER$, outlined on the page.',
    description: 'Note under the scope slider. $COUNT$ is a number. $CONTAINER$ is the name of an element.',
    placeholders: ['COUNT', 'CONTAINER'],
  },
  describingScopeAll: {
    message: 'Every element like this one.',
    description: 'Note under the scope slider.',
  },
  describingInstructionLabel: {
    message: 'What should change?',
    description: 'Label above the box where the user describes the change.',
  },
  describingPlaceholder: {
    message: 'Give the comment tree a dark background',
    description: 'Example of a description of a change, shown in the empty box.',
  },
  describingGenerate: {
    message: 'Generate',
    description: 'Button that sends the description to the model.',
  },
  describingIncludeShot: {
    message: 'Include screenshot of the area you drew',
  },
  describingShotDrag: {
    message: 'Drag the area on the page…',
    description: 'Button text while the user draws the area for a screenshot.',
  },
  describingShotDifferent: {
    message: 'Add a different screenshot',
    description: 'Button that starts a new screenshot when an area was already drawn.',
  },
  describingShotAdd: {
    message: 'Add a screenshot',
    description: 'Button that starts a screenshot.',
  },
  describingShotAlt: {
    message: 'The region that will be sent',
  },
  describingShotWarning: {
    message: 'This image is sent to your AI provider. Everything visible in it goes too — names, messages, account details, anything personal that happens to be on screen.',
    description: 'Warning shown with the screenshot preview.',
  },
  describingShotClipped: {
    message: 'Clipped at the viewport — only the visible part was captured.',
    description: 'Note under the screenshot preview.',
  },
  describingShotMoved: {
    message: 'The area was moved because the page scrolled after it was drawn.',
    description: 'Note under the screenshot preview.',
  },
  describingShotRemove: {
    message: 'Remove screenshot',
  },
  errNoProviderTitle: {
    message: 'No provider set up',
    description: 'Title of an error card.',
  },
  errNoProviderBody: {
    message: 'Nothing can be generated until an API key is stored. Anthropic or any OpenAI-compatible endpoint.',
    description: 'Body of the card shown when no provider is set up.',
  },
  errAddProvider: {
    message: 'Add a provider',
    description: 'Button that opens the settings to add a provider.',
  },
  errRequestFailedTitle: {
    message: 'The request failed',
    description: 'Title of an error card.',
  },
  errMessageKept: {
    message: '$MESSAGE$ Your description is kept.',
    description: 'Error text followed by a note that the description was not lost. $MESSAGE$ is the error text.',
    placeholders: ['MESSAGE'],
  },
  tryAgain: {
    message: 'Try again',
  },
  errHideResponse: {
    message: 'Hide response',
    description: 'Button that hides the provider\'s raw response.',
  },
  errShowResponse: {
    message: 'Show response',
    description: 'Button that shows the provider\'s raw response.',
  },
  dismiss: {
    message: 'Dismiss',
    description: 'Button that closes an error card.',
  },
  errSendPage: {
    message: 'Send page content',
    description: 'Button that sends a page that has password or payment fields.',
  },
  errModelUnavailableTitle: {
    message: 'Model not available',
    description: 'Title of an error card.',
  },
  errOpenModelSettings: {
    message: 'Open model settings',
    description: 'Button that opens the settings at the model choice.',
  },
  errModelNotPermittedTitle: {
    message: 'Model not permitted',
    description: 'Title of an error card.',
  },
  errBillingTitle: {
    message: 'Billing problem',
    description: 'Title of an error card.',
  },
  errRateLimitedTitle: {
    message: 'Rate limited',
    description: 'Title of an error card.',
  },
  errCountdownOne: {
    message: 'Trying again in 1 second',
    description: 'Countdown before a rate-limited request is repeated.',
  },
  errCountdown: {
    message: 'Trying again in $SECONDS$ seconds',
    description: 'Countdown before a rate-limited request is repeated. $SECONDS$ is a number.',
    placeholders: ['SECONDS'],
  },
  errTryNow: {
    message: 'Try now',
    description: 'Button that repeats a rate-limited request without waiting.',
  },
  errCredentialExpiredTitle: {
    message: 'Credential expired',
    description: 'Title of an error card.',
  },
  errCredentialExpiredBody: {
    message: '$MESSAGE$ Saved transforms keep working; new ones cannot be generated.',
    description: 'Body of the card shown when a credential has expired. $MESSAGE$ is the error text.',
    placeholders: ['MESSAGE'],
  },
  errReconnect: {
    message: 'Reconnect',
    description: 'Button that opens the settings to sign in again.',
  },
  refCodeReady: {
    message: 'Code ready.',
    description: 'Read out by a screen reader before the status of the generated code.',
  },
  refStatusBlocked: {
    message: 'Not applied to the page',
    description: 'Status of generated CSS that was rejected.',
  },
  refStatusLive: {
    message: 'Live on the page',
    description: 'Status of generated CSS that is applied as a preview.',
  },
  refStatusRan: {
    message: 'Ran once on this page',
    description: 'Status of generated JavaScript that has run in the preview.',
  },
  refStatusNotRun: {
    message: 'Not run yet',
    description: 'Status of generated JavaScript that has not run.',
  },
  refBadgeJs: {
    message: 'JS',
    description: 'Short badge that marks a JavaScript transform.',
  },
  refUnsaved: {
    message: 'not saved yet',
    description: 'Marks that the transform is only a preview.',
  },
  refBlockedJsTitle: {
    message: 'This code was not run',
    description: 'Title of the notice shown when generated JavaScript was rejected.',
  },
  refBlockedCssTitle: {
    message: 'This CSS was not applied',
    description: 'Title of the notice shown when generated CSS was rejected.',
  },
  refRejectedByAnalysis: {
    message: 'Static analysis rejected it before anything reached the page.',
    description: 'Explains why generated JavaScript was not run.',
  },
  refRejectedByCssCheck: {
    message: 'The CSS check rejected it before anything reached the page.',
    description: 'Explains why generated CSS was not applied.',
  },
  refFinding: {
    message: '$API$ on line $LINE$ — $EXPLANATION$',
    description: 'One problem found by the static analysis. $API$ is the name of a function or property, $LINE$ is a line number and $EXPLANATION$ says what is wrong.',
    placeholders: ['API', 'LINE', 'EXPLANATION'],
  },
  refPendingUrl: {
    message: 'Loads $URL$, which needs approval before it can be applied.',
    description: 'One address that the CSS loads and that the user has not approved. $URL$ is an address.',
    placeholders: ['URL'],
  },
  refSayWhat: {
    message: 'Say what to change below, or discard it.',
    description: 'Hint under a notice that says the code was rejected.',
  },
  refJsNextLoadTitle: {
    message: 'JavaScript runs on the next page load',
    description: 'Title of a notice about previewing JavaScript.',
  },
  refJsNextLoadBody: {
    message: 'Unlike CSS, a script cannot be applied to a page already on screen. To try it, the page is reloaded with the script registered — exactly the way it would run if you saved it.',
    description: 'Body of a notice about previewing JavaScript.',
  },
  refNothingStored: {
    message: 'Nothing is stored. Discarding removes the registration.',
    description: 'Hint under a notice about previewing JavaScript.',
  },
  refReviewReading: {
    message: 'A second model is reading the code. It cannot be run until that finishes.',
    description: 'Explains why the preview of JavaScript is not offered yet.',
  },
  refReviewDisagrees: {
    message: 'The second model did not agree that the code matches your description, so it cannot be run here: $EXPLANATION$',
    description: 'Explains why the preview of JavaScript is not offered. $EXPLANATION$ is the second model\'s explanation.',
    placeholders: ['EXPLANATION'],
  },
  refReviewScanRejected: {
    message: 'The code scan rejected this code, so it cannot be run.',
    description: 'Explains why the preview of JavaScript is not offered.',
  },
  refReviewNeeded: {
    message: 'The code has to be read by a second model before it runs on the page.',
    description: 'Explains why the preview of JavaScript is not offered.',
  },
  refReloadTitle: {
    message: 'Changing this needs a page reload',
    description: 'Title of a notice shown after previewed JavaScript has run.',
  },
  refReloadBody: {
    message: 'The script has already altered the page. A second attempt would run on top of the first, so the page has to be reloaded to get back to the original.',
    description: 'Body of a notice shown after previewed JavaScript has run.',
  },
  refReloadKept: {
    message: 'Your description and the current code are kept.',
    description: 'Hint under a notice shown after previewed JavaScript has run.',
  },
  refExplainer: {
    message: 'Scroll the page to check it. Nothing is stored until you save, and closing this panel discards it.',
    description: 'Explains that a CSS preview is temporary.',
  },
  refAttempt: {
    message: 'Attempt $NUMBER$',
    description: 'Heading of a later attempt at generating. $NUMBER$ is a number.',
    placeholders: ['NUMBER'],
  },
  refTargets: {
    message: 'Targets',
    description: 'Label above what the generated code targets.',
  },
  refAssumes: {
    message: 'Assumes',
  },
  refAskLabel: {
    message: 'Not right yet? Say what to change',
    description: 'Label above the box for a follow-up request.',
  },
  refPlaceholder: {
    message: 'keep the header light though',
    description: 'Example of a follow-up request, shown in the empty box.',
  },
  refRemoveRef: {
    message: 'Remove $SELECTOR$',
    description: 'Accessible name of a button that removes a reference element. $SELECTOR$ is a CSS selector.',
    placeholders: ['SELECTOR'],
  },
  refPickOne: {
    message: 'Pick one on the page…',
    description: 'Button text while the user picks a reference element.',
  },
  refPointAt: {
    message: '+ Point at another element',
    description: 'Button that adds another element as a reference.',
  },
  refShotAdd: {
    message: 'Add a screenshot of the page as it is now',
    description: 'Button that starts a screenshot.',
  },
  refShotClipped: {
    message: 'Clipped at the viewport; only the visible part was captured.',
    description: 'Added to the screenshot warning.',
  },
  refShotMoved: {
    message: 'The area was moved because the page scrolled after it was drawn.',
    description: 'Added to the screenshot warning.',
  },
  refReloadAndTry: {
    message: 'Reload page and try again',
    description: 'Button that reloads the page and generates again.',
  },
  refRegenerate: {
    message: 'Regenerate',
    description: 'Button that generates the transform again with the follow-up request.',
  },
  discard: {
    message: 'Discard',
    description: 'Button that throws away the unsaved transform.',
  },
  refReloadAndRun: {
    message: 'Reload and run it',
    description: 'Button that reloads the page and runs the generated JavaScript.',
  },
  refReading: {
    message: 'Reading the code…',
    description: 'Button text while a second model reads the code.',
  },
  refReadFirst: {
    message: 'Read the code first',
    description: 'Button that asks a second model to read the code before it runs.',
  },
  refKeep: {
    message: 'Keep it',
    description: 'Button that keeps the previewed transform.',
  },
  revStep3: {
    message: 'Step 3 of 3 · Approve',
    description: 'Small heading above the last step of saving a transform.',
  },
  revReading: {
    message: 'Reading the code…',
    description: 'Shown while the review of the code is running.',
  },
  revRunsIn: {
    message: 'Runs in: $WORLD$',
    description: 'Title of the card about the execution world. $WORLD$ is the name of the world.',
    placeholders: ['WORLD'],
  },
  revModelAskedMain: {
    message: 'The model asked to run this code in the page\'s own world. It stays in the isolated world until you allow it here.',
    description: 'Explains that the model requested the page\'s own world.',
  },
  revReasonGiven: {
    message: 'Reason given: $REASON$',
    description: 'Gives the model\'s reason for the world it chose. $REASON$ is the reason.',
    placeholders: ['REASON'],
  },
  revNoReason: {
    message: 'No reason was given.',
    description: 'Says the model gave no reason for the world it chose.',
  },
  revRunsInMain: {
    message: 'This code runs in the page\'s own world.',
    description: 'Says the code runs in the page\'s own world.',
  },
  revRunsIsolated: {
    message: 'The code runs apart from the page\'s own scripts, and the page cannot change it.',
    description: 'Says the code runs in the isolated world.',
  },
  revRunIsolated: {
    message: 'Run in the isolated world instead',
    description: 'Button that moves the code to the isolated world.',
  },
  revAllowMain: {
    message: 'Allow the page\'s own world',
    description: 'Button that lets the code run in the page\'s own world.',
  },
  revBlockedTitle: {
    message: 'This cannot be saved as it is',
    description: 'Title of a card about code that cannot be saved.',
  },
  revBlockedFinding: {
    message: 'Line $LINE$ uses $API$. $EXPLANATION$',
    description: 'A problem that stops the code from being saved. $LINE$ is a line number, $API$ is the name of a function or property and $EXPLANATION$ says what is wrong.',
    placeholders: ['LINE', 'API', 'EXPLANATION'],
  },
  revRefused: {
    message: 'You refused what this code needs, so it will not be saved. Go back and describe what you want without it.',
    description: 'Hint under a card about code that cannot be saved.',
  },
  revGoBackDifferent: {
    message: 'Go back and describe what you want differently.',
    description: 'Hint under a card about code that cannot be saved.',
  },
  revUrlsTitle: {
    message: 'This CSS loads addresses outside this site',
    description: 'Title of a card about addresses that the CSS loads.',
  },
  revUrlsBodyOne: {
    message: 'The browser requests this address on every visit. A request can carry information about the page, and the server that receives it can see it. Only the addresses listed here will be allowed to load.',
    description: 'Body of a card about one address that the CSS loads.',
  },
  revUrlsBodyMany: {
    message: 'The browser requests these addresses on every visit. A request can carry information about the page, and the server that receives it can see it. Only the addresses listed here will be allowed to load.',
    description: 'Body of a card about several addresses that the CSS loads.',
  },
  revWarnLine: {
    message: 'Line $LINE$ uses $API$.',
    description: 'A warning about code that uses a function or property. $LINE$ is a line number and $API$ is the name.',
    placeholders: ['LINE', 'API'],
  },
  revWarnDeclared: {
    message: 'That is $CAPABILITY$ this transform declared, so it will work.',
    description: 'Part of a warning. $CAPABILITY$ is a capability name such as network or storage.',
    placeholders: ['CAPABILITY'],
  },
  revWarnUndeclared: {
    message: 'That is $CAPABILITY$, which this transform did not declare, so it cannot be saved as it stands.',
    description: 'Part of a warning. $CAPABILITY$ is a capability name such as network or storage.',
    placeholders: ['CAPABILITY'],
  },
  revRequested: {
    message: 'requested · nothing else',
    description: 'Shown after the list of capabilities that the code requested.',
  },
  revCspBlocks: {
    message: 'Anything it did not ask for is blocked while it runs.',
    description: 'Explains how declared capabilities are enforced.',
  },
  revNotEnforced: {
    message: 'The browser does not police this once it is saved. Approving is what allows it; refusing means the code is not saved at all.',
    description: 'Explains that the browser does not enforce declared capabilities.',
  },
  revMismatchTitle: {
    message: 'The second model does not agree this matches your description',
    description: 'Title of a card about the second model\'s verdict.',
  },
  revYouAskedFor: {
    message: 'You asked for: $DESCRIPTION$',
    description: 'Repeats the user\'s description. $DESCRIPTION$ is the text the user wrote.',
    placeholders: ['DESCRIPTION'],
  },
  revRunsOn: {
    message: 'Runs on',
    description: 'Row label for the pages the transform applies to.',
  },
  revWhere: {
    message: '$SCHEMES$; $SITES$; $PAGES$.',
    description: 'Which pages the transform applies to. The three values are phrases, for example https pages, every site, every page.',
    placeholders: ['SCHEMES', 'SITES', 'PAGES'],
  },
  revWhereVariants: {
    message: '$SCHEMES$; $SITES$; $PAGES$. $VARIANTS$',
    description: 'Which pages the transform applies to, followed by a sentence about variants of the address.',
    placeholders: ['SCHEMES', 'SITES', 'PAGES', 'VARIANTS'],
  },
  revNoneDeclared: {
    message: 'None declared. Code that uses network, storage or cookies without declaring it cannot be saved.',
    description: 'Says that the code declares no capabilities.',
  },
  revCssCheck: {
    message: 'CSS check',
    description: 'Row label for the result of the CSS check.',
  },
  revCodeScan: {
    message: 'Code scan',
    description: 'Row label for the result of the static analysis of JavaScript.',
  },
  revNoFindingsJs: {
    message: 'No known patterns found. The scan looks for known patterns and cannot prove the code harmless. The code still runs with access to this page.',
    description: 'Result of the static analysis when it found nothing.',
  },
  revNoFindingsCss: {
    message: 'No known patterns found. The check looks for addresses the CSS would load.',
    description: 'Result of the CSS check when it found nothing.',
  },
  revFindingsOne: {
    message: '1 finding, listed above.',
    description: 'Result of the check when it found one problem.',
  },
  revFindings: {
    message: '$COUNT$ findings, listed above.',
    description: 'Result of the check when it found problems. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  revSecondModel: {
    message: 'Second model',
    description: 'Row label for the second model\'s review.',
  },
  revCssNotReviewed: {
    message: 'CSS is not sent to a second model.',
    description: 'Result of the second model\'s review.',
  },
  revNotReviewed: {
    message: 'Not reviewed.',
    description: 'Result of the second model\'s review.',
  },
  revModelAgreed: {
    message: 'Read the code and agreed it does what you described.',
    description: 'Result of the second model\'s review.',
  },
  revModelNote: {
    message: 'Its note: $NOTE$',
    description: 'The second model\'s comment. $NOTE$ is the comment.',
    placeholders: ['NOTE'],
  },
  revVerdict: {
    message: 'Verdict: $VERDICT$. $EXPLANATION$',
    description: 'Result of the second model\'s review. $VERDICT$ is a single word and $EXPLANATION$ is the model\'s comment.',
    placeholders: ['VERDICT', 'EXPLANATION'],
  },
  revCodeToRun: {
    message: 'Code to be run, and rationale',
    description: 'Heading of the section that shows the code.',
  },
  revGrant: {
    message: 'Saving asks Firefox for permission to run on $ORIGIN$. Without it the transform saves but never applies.',
    description: 'Explains the permission requested when a CSS transform is saved. $ORIGIN$ is a site address.',
    placeholders: ['ORIGIN'],
  },
  revGrantJs: {
    message: 'Saving asks Firefox for permission to run on $ORIGIN$, and to run user scripts. Without it the transform saves but never applies.',
    description: 'Explains the permissions requested when a JavaScript transform is saved. $ORIGIN$ is a site address.',
    placeholders: ['ORIGIN'],
  },
  revDeclinedTitle: {
    message: 'Permission was declined',
    description: 'Title of a card shown when the user refused the permission.',
  },
  revDeclinedBody: {
    message: 'Nothing was saved. A transform without this grant would sit in the list looking active and do nothing on every visit.',
    description: 'Body of a card shown when the user refused the permission.',
  },
  back: {
    message: 'Back',
    description: 'Button that returns to the previous step.',
  },
  revApproveAddress: {
    message: 'Approve this address',
    description: 'Button that approves one address that the CSS loads.',
  },
  revApproveAddresses: {
    message: 'Approve these addresses',
    description: 'Button that approves several addresses that the CSS loads.',
  },
  revRefuse: {
    message: 'Refuse $CAPABILITIES$',
    description: 'Button that refuses what the code needs. $CAPABILITIES$ is a list of capability names joined with and.',
    placeholders: ['CAPABILITIES'],
  },
  revAllowSave: {
    message: 'Allow and save',
    description: 'Button that approves the declared capabilities and saves the transform.',
  },
  revSave: {
    message: 'Save transform',
    description: 'Button that saves the transform.',
  },
  settingsRegion: {
    message: 'Settings',
    description: 'Accessible name of the settings panel.',
  },
  settingsAccent: {
    message: 'Accent colour',
  },
  settingsProvider: {
    message: 'Provider',
    description: 'Label above the active provider.',
  },
  settingsActive: {
    message: 'ACTIVE',
    description: 'Marks the provider that is in use.',
  },
  settingsOauth: {
    message: 'oauth',
    description: 'How the provider is signed in to.',
  },
  settingsApiKey: {
    message: 'api key',
    description: 'How the provider is signed in to.',
  },
  settingsSignInAgain: {
    message: 'Sign in again for this provider',
    description: 'Says that the saved credential is no longer available.',
  },
  settingsEnterKeyAgain: {
    message: 'Enter the key again for this provider',
    description: 'Says that the saved credential is no longer available.',
  },
  settingsKeyConfigured: {
    message: 'Key configured',
    description: 'Says whether a credential is saved.',
  },
  settingsNoCredential: {
    message: 'No credential',
    description: 'Says whether a credential is saved.',
  },
  settingsWritesCode: {
    message: 'Writes the code',
    description: 'Label of the model that writes the code.',
  },
  settingsReviewsCode: {
    message: 'Reviews the code',
    description: 'Label of the model that reviews the code.',
  },
  settingsReviewNote: {
    message: 'code and intent only',
    description: 'Says what the review model receives.',
  },
  settingsNoProvider: {
    message: 'No provider is set up. Nothing can be generated until one is.',
    description: 'Shown when no provider is set up.',
  },
  settingsAddProvider: {
    message: 'Add a provider →',
    description: 'Link that opens the full settings page to add a provider.',
  },
  settingsHealth: {
    message: 'Check for broken transforms',
  },
  settingsHealthEvery: {
    message: 'Every page load',
    description: 'Choice of when to check for broken transforms.',
  },
  settingsHealthDefault: {
    message: 'default',
    description: 'Marks the choice that is used unless the user changes it.',
  },
  settingsHealthOnce: {
    message: 'Once per site per session',
    description: 'Choice of when to check for broken transforms.',
  },
  settingsHealthManual: {
    message: 'Manual only',
    description: 'Choice of when to check for broken transforms.',
  },
  settingsKeepShot: {
    message: 'Keep screenshot permission',
    description: 'Label of a switch.',
  },
  settingsKeepShotNote: {
    message: 'Screenshots need access to all sites. Kept on, you are not asked again — and you stop being asked per site when saving transforms too.',
    description: 'Explains the switch that keeps the permission to take screenshots.',
  },
  settingsWhereStored: {
    message: 'Where your keys are stored',
    description: 'Heading of the notes about how keys are stored.',
  },
  settingsOpenFull: {
    message: 'Open the full settings page →',
    description: 'Link that opens the full settings page.',
  },
  settingsFullNote: {
    message: 'Adding providers lives there.',
    description: 'Says what is only on the full settings page.',
  },
  trAnotherTransform: {
    message: 'another transform',
    description: 'Stands in for the name of a transform that no longer exists.',
  },
  trListTwo: {
    message: '$FIRST$ and $SECOND$',
    description: 'Joins two CSS property names.',
    placeholders: ['FIRST', 'SECOND'],
  },
  trListMore: {
    message: '$LIST$ and $COUNT$ more',
    description: 'Ends a list of CSS property names. $LIST$ is two names and $COUNT$ is the number of other names.',
    placeholders: ['LIST', 'COUNT'],
  },
  trReorder: {
    message: 'Reorder $NAME$. Arrow keys move it.',
    description: 'Accessible name of the handle that reorders a transform. $NAME$ is the name of the transform.',
    placeholders: ['NAME'],
  },
  trEnable: {
    message: 'Enable $NAME$',
    description: 'Accessible name of the switch that turns a transform on. $NAME$ is the name of the transform.',
    placeholders: ['NAME'],
  },
  trName: {
    message: 'Name',
    description: 'Accessible name of the box where a transform is renamed.',
  },
  trNeedsRegen: {
    message: 'needs regenerating',
    description: 'Marks a transform that has no code.',
  },
  trOverriddenBy: {
    message: 'Overridden by $NAMES$',
    description: 'Tooltip of a transform whose CSS is overridden. $NAMES$ is a list of transform names.',
    placeholders: ['NAMES'],
  },
  trOverridden: {
    message: 'overridden',
    description: 'Marks a transform whose CSS is overridden by another.',
  },
  trStopped: {
    message: 'Stopped working',
    description: 'Tooltip of the status dot of a transform.',
  },
  trWorking: {
    message: 'Working',
    description: 'Tooltip of the status dot of a transform.',
  },
  trNoAccess: {
    message: 'No access to this site',
    description: 'Says that the extension has no permission for the site.',
  },
  trGrant: {
    message: 'Grant access',
    description: 'Button that asks for permission to use the site.',
  },
  trNeedsRegenNote: {
    message: 'Needs regenerating. It has no code, so it cannot run.',
    description: 'Says that a transform has no code.',
  },
  trReviewDescription: {
    message: 'Review description',
    description: 'Button that opens a transform\'s description.',
  },
  trRestoredNote: {
    message: 'Restored from a backup. It stays off until its code is approved.',
    description: 'Says that restored JavaScript is waiting for approval.',
  },
  trReviewCode: {
    message: 'Review code',
    description: 'Button that opens restored code for review.',
  },
  trDescriptionImported: {
    message: 'Description from an imported file',
    description: 'Heading above the description of a transform.',
  },
  trYouWanted: {
    message: 'You wanted',
    description: 'Heading above the description of a transform.',
  },
  trEnvChanged: {
    message: 'Environment changed',
    description: 'Heading of a notice about a transform that was moved out of the page\'s own world.',
  },
  trOpenEditorEnv: {
    message: 'Open the editor to turn on the page\'s environment',
    description: 'Button that opens the editor to turn on the page\'s environment.',
  },
  trNotApplying: {
    message: 'Not applying',
    description: 'Heading of a list of CSS conflicts.',
  },
  trOverrides: {
    message: 'Overrides',
    description: 'Heading of a list of CSS conflicts.',
  },
  trLosesOne: {
    message: '$PROPERTIES$ is set by $WINNER$ on $ELEMENTS$, and it wins$REASON$.',
    description: 'Explains why a CSS rule does not apply. $PROPERTIES$ is one property name, $WINNER$ is a transform name, $ELEMENTS$ and $REASON$ are phrases.',
    placeholders: ['PROPERTIES', 'WINNER', 'ELEMENTS', 'REASON'],
  },
  trLosesMany: {
    message: '$PROPERTIES$ are set by $WINNER$ on $ELEMENTS$, and it wins$REASON$.',
    description: 'Explains why CSS rules do not apply. $PROPERTIES$ is a list of property names, $WINNER$ is a transform name, $ELEMENTS$ and $REASON$ are phrases.',
    placeholders: ['PROPERTIES', 'WINNER', 'ELEMENTS', 'REASON'],
  },
  trSameElement: {
    message: 'the same element',
    description: 'Phrase that says how many elements a CSS conflict affects.',
  },
  trSameElements: {
    message: '$COUNT$ of the same elements',
    description: 'Phrase that says how many elements a CSS conflict affects. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  trWinsImportant: {
    message: ' — it marks them !important, so it wins despite being earlier in the list',
    description: 'Reason a CSS rule wins. It follows the words "and it wins".',
  },
  trWinsLater: {
    message: ', being later in the list',
    description: 'Reason a CSS rule wins. It follows the words "and it wins".',
  },
  trWinsOver: {
    message: 'This one wins $PROPERTIES$ over $LOSER$.',
    description: 'Says which CSS rules this transform wins. $PROPERTIES$ is a list of property names and $LOSER$ is a transform name.',
    placeholders: ['PROPERTIES', 'LOSER'],
  },
  trWinsOverImportant: {
    message: 'This one wins $PROPERTIES$ over $LOSER$, because it marks them !important.',
    description: 'Says which CSS rules this transform wins. $PROPERTIES$ is a list of property names and $LOSER$ is a transform name.',
    placeholders: ['PROPERTIES', 'LOSER'],
  },
  trMoveLater: {
    message: 'Move this one later in the list to win instead.',
    description: 'Hint about how to make a transform win a CSS conflict.',
  },
  trWhatBroke: {
    message: 'What broke',
    description: 'Heading above why a transform stopped working.',
  },
  trPageError: {
    message: 'Error text reported by the page: $TEXT$',
    description: 'The error text that the page reported. $TEXT$ is that text.',
    placeholders: ['TEXT'],
  },
  trAssumed: {
    message: 'This transform assumed $ASSUMPTION$.',
    description: 'Says which assumption of the transform was false. $ASSUMPTION$ is a phrase.',
    placeholders: ['ASSUMPTION'],
  },
  trStoppedDefault: {
    message: 'It stopped working.',
    description: 'Reason sent with a repair request when none was recorded.',
  },
  trRepair: {
    message: 'Repair with AI',
    description: 'Button that asks the model to repair a broken transform.',
  },
  trDisable: {
    message: 'Disable',
    description: 'Button that turns a transform off.',
  },
  trDeleteAsk: {
    message: 'Delete this transform?',
    description: 'Question shown before a transform is deleted.',
  },
  trDelete: {
    message: 'Delete',
    description: 'Button that deletes a transform.',
  },
  trRename: {
    message: 'Rename',
    description: 'Button that renames a transform.',
  },
  trEditDescription: {
    message: 'Edit description',
    description: 'Button that opens the description of a transform for editing.',
  },
  trChangeWithAi: {
    message: 'Change with AI',
    description: 'Button that asks the model to change a transform.',
  },
  trEditCode: {
    message: 'Edit code',
    description: 'Button that opens the code of a transform for editing.',
  },
  appReloadOneTab: {
    message: 'Reload 1 open tab of this site to run JavaScript transforms there again.',
    description: 'Shown after everything is turned back on for a site.',
  },
  appReloadTabs: {
    message: 'Reload $COUNT$ open tabs of this site to run JavaScript transforms there again.',
    description: 'Shown after everything is turned back on for a site. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  appEditedByHand: {
    message: 'Edited by hand. Any description of the previous code no longer applies.',
    description: 'Saved with a transform whose code the user edited, in place of the model\'s description of its approach.',
  },
  appBrand: {
    message: 'Web Alchemist',
    description: 'Name shown at the top of the sidebar.',
  },
  appDone: {
    message: 'Done',
    description: 'Button that closes the settings panel in the sidebar.',
  },
  appSettings: {
    message: 'Settings',
  },
  appBlockedOne: {
    message: '1 transform is blocked by the current safety check and is not running. This count covers every site.',
    description: 'Banner shown when the safety check blocks a saved transform.',
  },
  appBlockedMany: {
    message: '$COUNT$ transforms are blocked by the current safety check and are not running. This count covers every site.',
    description: 'Banner shown when the safety check blocks saved transforms. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  appPausedTitle: {
    message: 'Still describing something on $HOST$',
    description: 'Heading shown when the user left the page that a run belongs to. $HOST$ is a site name.',
    placeholders: ['HOST'],
  },
  appPausedBody: {
    message: 'This run is about an element on that page, so it stays there rather than following you here. Go back to carry on, or discard it and start fresh.',
    description: 'Explains why a run does not follow the user to another page.',
  },
  appBackTo: {
    message: 'Back to $HOST$',
    description: 'Button that returns to the page that a run belongs to. $HOST$ is a site name.',
    placeholders: ['HOST'],
  },
  appDiscardIt: {
    message: 'Discard it',
    description: 'Button that discards the run in progress.',
  },
  appNothingTitle: {
    message: 'Nothing to change here',
    description: 'Heading shown on a browser page.',
  },
  appNothingBody: {
    message: 'This is a browser page, not a website. Open a site and the panel will show what can be changed on it.',
    description: 'Explains that the extension does not work on a browser page.',
  },
  appEmptyTitle: {
    message: 'Point at something on this page and say what you want changed.',
    description: 'Heading of the empty list.',
  },
  appEmptyBody: {
    message: 'An AI writes the CSS or JavaScript. It is saved for $HOST$ and applied on every visit. You approve the code before it runs.',
    description: 'Explains what the extension does. $HOST$ is a site name.',
    placeholders: ['HOST'],
  },
  appEmptyBodyNoHost: {
    message: 'An AI writes the CSS or JavaScript. It is saved for this site and applied on every visit. You approve the code before it runs.',
    description: 'Explains what the extension does.',
  },
  appSelect: {
    message: 'Select an element',
    description: 'Button that starts picking an element on the page.',
  },
  appDragHint: {
    message: 'Or drag a rectangle on the page',
    description: 'Hint under the button that starts picking.',
  },
  appWriteMyself: {
    message: 'Write it myself',
    description: 'Button that opens the editor to write a transform by hand.',
  },
  appCheckTitle: {
    message: 'Check whether these still work',
    description: 'Tooltip of the button that checks saved transforms.',
  },
  appChecking: {
    message: 'Checking…',
    description: 'Button text while saved transforms are checked.',
  },
  appCheck: {
    message: 'Check',
    description: 'Button that checks whether saved transforms still work.',
  },
  appActive: {
    message: '$COUNT$ active',
    description: 'Number of transforms that are turned on. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  appSiteOff: {
    message: 'Everything is turned off on this site.',
    description: 'Shown when every transform is turned off for the site.',
  },
  appBrokenOne: {
    message: '1 transform stopped working',
    description: 'Banner shown when the health check finds a broken transform.',
  },
  appBroken: {
    message: '$COUNT$ transforms stopped working',
    description: 'Banner shown when the health check finds broken transforms. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  appOrderHint: {
    message: 'Order decides conflicts — later wins',
    description: 'Hint under the list of transforms.',
  },
  appTurnOn: {
    message: 'Turn everything back on for this site',
    description: 'Button that turns the transforms of a site back on.',
  },
  appTurnOff: {
    message: 'Turn off everything on this site',
    description: 'Button that turns off the transforms of a site.',
  },
  appSiteOffNote: {
    message: 'No transform runs on this site while this is off. They stay saved.',
    description: 'Explains the state after the transforms of a site were turned off.',
  },
  appSiteOnNote: {
    message: 'Stops every CSS and JavaScript transform on this site. Open tabs of this site that ran JavaScript are reloaded.',
    description: 'Explains the button that turns off the transforms of a site.',
  },
  flowNeedsPermission: {
    message: 'Web Alchemist needs permission to read $HOST$ before it can point at anything on it.',
    description: 'Error shown when the user has not granted access to the site. $HOST$ is a site name.',
    placeholders: ['HOST'],
  },
  flowThisSite: {
    message: 'this site',
    description: 'Stands in for the site name when the address cannot be read. It follows the words \'permission to read\'.',
  },
  flowElementGoneRepair: {
    message: 'Web Alchemist cannot find the element $NAME$ was written for on this page, so there is nothing to repair against. Pick it again to write a new transform.',
    description: 'Error shown when a repair cannot find the element. $NAME$ is the name of the transform.',
    placeholders: ['NAME'],
  },
  flowElementGone: {
    message: 'Web Alchemist cannot find the element $NAME$ was written for on this page. Open a page it applies to, or pick the element again.',
    description: 'Error shown when a transform cannot find its element. $NAME$ is the name of the transform.',
    placeholders: ['NAME'],
  },
  flowScreenshotNeedsAllSites: {
    message: 'Firefox only lets an extension capture a page with access to all sites. Without it, screenshots cannot be taken; everything else still works.',
    description: 'Error shown when the permission for screenshots was refused.',
  },
  flowNeedsUserScripts: {
    message: 'Running a script needs Firefox’s user scripts permission. Nothing was run.',
    description: 'Error shown when the permission for user scripts was refused.',
  },
  flowPreviewNoApproval: {
    message: 'The review that allows a preview has no approval, so nothing was run. Read the code again.',
    description: 'Error shown when the preview of JavaScript is refused.',
  },
  msgConnectionDropped: {
    message: 'The connection to the extension dropped before the response arrived.',
    description: 'Error shown when the background did not answer.',
  },
})
