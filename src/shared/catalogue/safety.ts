import { defineMessages } from './define'

/** Messages of the safety surface. */
export const safetyMessages = defineMessages({
  saOpensAPersistentNetworkConnection: {
    message: 'Opens a persistent network connection.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReadsOrWritesThisSiteS: {
    message: 'Reads or writes this site\'s stored data.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saCreatesAnImageElementWhichRequests: {
    message: 'Creates an image element, which requests the address it is given.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saCreatesAnAudioElementWhichRequests: {
    message: 'Creates an audio element, which requests the address it is given.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSendsDataToAServerIn: {
    message: 'Sends data to a server in the background.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReadsOrWritesThisSiteS2: {
    message: 'Reads or writes this site\'s cookies, which can include your session.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReadsOrWritesThisSiteS3: {
    message: 'Reads or writes this site\'s stored database.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReadsOrWritesThisSiteS4: {
    message: 'Reads or writes this site\'s cached responses.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saRunsCodeBuiltAtRuntimeWhich: {
    message: 'Runs code built at runtime, which cannot be reviewed before it executes.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saBuildsANewFunctionFromText: {
    message: 'Builds a new function from text, which cannot be reviewed before it executes.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saRefersToThePageGlobalObject: {
    message: 'Refers to the page global object, which can reach any browser feature under a name this check cannot see.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saRefersToTheTopLevelWindow: {
    message: 'Refers to the top-level window of the page, which can reach any browser feature.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saRefersToTheParentWindowOf: {
    message: 'Refers to the parent window of the page, which can reach any browser feature.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saRefersToThePageWindowsWhich: {
    message: 'Refers to the page windows, which can reach any browser feature.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saUsesTheWindowAsAValue: {
    message: 'Uses the window as a value. Only direct reads such as window.innerWidth are allowed, because a copy of the window hides what is later done with it.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saUsesTheDocumentAsAValue: {
    message: 'Uses the document as a value. Only direct calls and reads such as document.querySelector are allowed, because a copy of the document hides what is later done with it.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saUsesNavigatorAsAValueOnly: {
    message: 'Uses navigator as a value. Only direct reads such as navigator.language are allowed, because a copy hides what is later done with it.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saLooksUpAndCallsMembersBy: {
    message: 'Looks up and calls members by a computed name, which this check cannot follow.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saInterceptsPropertyAccessWhichThisCheck: {
    message: 'Intercepts property access, which this check cannot follow.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saNavigatesThePageWhichCanSend: {
    message: 'Navigates the page, which can send page data to another site in the address.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saOpensANewWindowOrDocument: {
    message: 'Opens a new window or document, which can send page data to another site.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSendsDataToAnotherWindow: {
    message: 'Sends data to another window.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saChangesTheAddressOfThePage: {
    message: 'Changes the address of the page.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saStartsASeparateScriptThatThis: {
    message: 'Starts a separate script that this check cannot see.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSendsDataToOtherTabs: {
    message: 'Sends data to other tabs.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSendsDataToOtherWindows: {
    message: 'Sends data to other windows.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saBuildsDataThatCanBeLoaded: {
    message: 'Builds data that can be loaded as a script or a page.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saBuildsElementsFromATextString: {
    message: 'Builds elements from a text string, which can load or run content.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saRunsCompiledCodeThatCannotBe: {
    message: 'Runs compiled code that cannot be reviewed.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saLoadsAndRunsCodeFromAnother: {
    message: 'Loads and runs code from another location.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReachesThePrototypeChainWhichCan: {
    message: 'Reaches the prototype chain, which can produce the Function constructor and run code built from text.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReadsOrChangesHowAProperty: {
    message: 'Reads or changes how a property behaves, which can reach members that are otherwise refused.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReachesThePageGlobalObjectOr: {
    message: 'Reaches the page global object or another document, which can reach any browser feature.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saNavigatesThePageOrOpensA: {
    message: 'Navigates the page or opens a window, which can send page data to another site.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReturnsTheDocumentOrANode: {
    message: 'Returns the document, or a node whose parent chain leads to it, so the document would be held as a value that this check cannot follow.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saCreatesElementsOrAttributesInA: {
    message: 'Creates elements or attributes in a way this check cannot inspect.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReturnsTheDocumentInsideAnObject: {
    message: 'Returns the document inside an object or embed element, which is another document that this check cannot follow.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSubmitsAFormWhichSendsIts: {
    message: 'Submits a form, which sends its contents to the form address.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saStartsASeparateScriptOrBuilds: {
    message: 'Starts a separate script or builds a loadable address, which this check cannot see.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReachesAStyleSheetWhereText: {
    message: 'Reaches a style sheet, where text such as an import rule makes the browser request an address.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsStylesThroughTheTypedObject: {
    message: 'Sets styles through the Typed Object Model, whose values are not checked as the text of a style is.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsThePageInsideAFrame: {
    message: 'Sets the page inside a frame from a text string, which can run content.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saRedirectsThePageFromAMeta: {
    message: 'Redirects the page from a meta element.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReplacesContentByParsingAText: {
    message: 'Replaces content by parsing a text string as HTML, which can load or run content.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsTheSourceTextOfAn: {
    message: 'Sets the source text of an element that may be a script.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saThisCodeContainsTheInvisibleOr: {
    message: 'This code contains the invisible or direction-changing character U+$CODE$, which can make the code display differently from what runs. Remove it.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: CODE.',
    placeholders: ['CODE'],
  },
  saWritesToAMemberOfA: {
    message: 'Writes to a member of $NAME$, a browser global. Code that replaces a member of a global can make a later call return a value this check assumed it could not.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saAssignsToANameTheCode: {
    message: 'Assigns to $NAME$, a name the code does not declare. In a strict-mode script this either replaces a browser global or throws, and neither is a transform.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saMovesFromTheHeadOrThe: {
    message: 'Moves from the head or the root element to the nodes inside it, which include style elements whose text can be rewritten to load an address, and this check cannot see what is written.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saChangesWhatDecidesWhetherAnElement: {
    message: 'Changes what decides whether an element in the page runs or loads, on an element this code did not create. A script element that never ran (JSON data or a template, for example) can be made to run this way, and this check cannot tell which element it is.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReadsTheContentOfAnElement: {
    message: 'Reads the content of an element the code did not create. The content of a template element holds script elements that have not started, and putting it in the page starts them, and this check cannot tell which element it is.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saUsesWithoutCallingItDirectlySo: {
    message: 'Uses $NAME$ without calling it directly, so this check cannot see the arguments it is given.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saContainsStyleTextThatMakesThe: {
    message: 'Contains style text that makes the browser request an address.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saContainsAnAddressThatRunsCode: {
    message: 'Contains an address that runs code when it is followed.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsAnEventHandlerPropertyWhich: {
    message: 'Sets an event handler property, which can be called with the window as its `this` or as the target of its event. Use addEventListener instead.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsAnAddressOnAnElement: {
    message: 'Sets an address on an element, which makes the browser request it or follow it.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsAnAddressThatIsNot: {
    message: 'Sets an address that is not written out, or does not start with https://, http:// or a path, so this check cannot tell that it is not a javascript: address, which runs code.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsPartOfAnAddressWhich: {
    message: 'Sets part of an address, which changes where a link or form goes.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsDataWhichIsAnAddress: {
    message: 'Sets data, which is an address on an object element and text on a text node, and this check cannot tell which this is.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsDataToAValueThat: {
    message: 'Sets data to a value that is not written out, or does not start with https://, http:// or a path, so this check cannot tell that it is not a javascript: address.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsAStyleThatCanLoad: {
    message: 'Sets a style that can load an address, and the value is not written out, so this check cannot tell.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsAStyleFromAVariable: {
    message: 'Sets a style from a variable that can hold an address, so this check cannot tell what it loads.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsACustomStylePropertyTo: {
    message: 'Sets a custom style property to a value that is not written out, so this check cannot tell whether it holds an address.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saTakesTheEventOfAWindow: {
    message: 'Takes the event of a window or document listener as something other than a plain name, so this check cannot follow where its target goes.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReadsAPropertyWhoseNameIs: {
    message: 'Reads a property whose name is decided while running, so this check cannot tell what it accesses.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saUsesWhichIsNotOnThe: {
    message: 'Uses $NAME$.$NAME2$, which is not on the list of things a page transform may use.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME, NAME2.',
    placeholders: ['NAME', 'NAME2'],
  },
  saUsesObjectWithoutCallingItDirectly: {
    message: 'Uses Object.$NAME$ without calling it directly, so this check cannot see the value it is given.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saReadsWhichObjectAnEventWas: {
    message: 'Reads which object an event was sent to, inside a listener on the window or the document, where it can be the window or the document itself.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saPassesSomethingOtherThanAFunction: {
    message: 'Passes something other than a function written in this code to a timer. A text argument runs as code, which cannot be reviewed before it executes.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saGivesAddeventlistenerSomethingOtherThanA: {
    message: 'Gives $NAME$.addEventListener something other than a function written out in this code, so this check cannot follow the event it receives.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saAnimatesKeyframesThatAreNotWritten: {
    message: 'Animates keyframes that are not written out in this code, so this check cannot tell which styles they set, and a style can load an address.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saCreatesAnElementWhoseTypeIs: {
    message: 'Creates an element whose type is decided while running, so this check cannot tell whether it loads or runs anything.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saCreatesAnElementThatRequestsAn: {
    message: 'Creates an element that requests an address.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saCreatesAElementWhichCanLoad: {
    message: 'Creates a $LOWER$ element, which can load or run content or send data.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: LOWER.',
    placeholders: ['LOWER'],
  },
  saSetsAnAttributeWhoseNameIs: {
    message: 'Sets an attribute whose name is decided while running, so this check cannot tell whether it carries an address or code.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsAnEventHandlerAttributeWhich: {
    message: 'Sets an event handler attribute, which runs text as code.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saRemovesAnAttributeWhoseNameIs: {
    message: 'Removes an attribute whose name is decided while running, so this check cannot tell whether it is one that keeps a script element from running.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSetsAStyleWhoseNameIs: {
    message: 'Sets a style whose name is decided while running, so this check cannot tell whether it can load an address.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saCopiesPropertiesFromAValueWhose: {
    message: 'Copies properties from a value whose names are not written out, so this check cannot tell which properties it sets.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saCopiesPropertiesWhoseNamesAreNot: {
    message: 'Copies properties whose names are not written out, so this check cannot tell which properties it sets.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saListsTheNamesOfAValue: {
    message: 'Lists the names of a value that is not written out in this code, which can find members this check refuses by name.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSelectsElementsWithASelectorOr: {
    message: 'Selects elements with a selector or tag name that is not written out in this code, so this check cannot tell whether it selects a script or style element.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSelectsAScriptOrStyleElement: {
    message: 'Selects a script or style element. Their text can be rewritten to run code or to load an address, and this check cannot see what is written, so they are not available to a page transform.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saSelectsEveryElementWhichIncludesScript: {
    message: 'Selects every element, which includes script and style elements whose text can be rewritten, and this check cannot see what is written.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saUsesTheEventOfAWindow: {
    message: 'Uses the event of a window or document listener as a value. Only direct reads such as event.key are allowed, because its target can be the window or the document.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saReadsTheArgumentsOfAWindow: {
    message: 'Reads the arguments of a window or document listener, which include its event, so this check cannot follow where the event target goes.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saUsesAsAValueOnlyDirect: {
    message: 'Uses $NAME$ as a value. Only direct uses such as Object.assign, Math.floor and Array.from are allowed, because a copy hides which member is later written or called.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saUsesWhichIsNotOnThe2: {
    message: 'Uses $NAME$, which is not on the list of browser features a page transform may use, so this check cannot tell what it does.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saUsesThisOutsideAFunctionWhere: {
    message: 'Uses `this` outside a function, where it is the page global object, which can reach any browser feature.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saLoadsAndRunsCodeFromAnother2: {
    message: 'Loads and runs code from another location, which is never allowed.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saMakesNamesResolveAgainstAnObject: {
    message: 'Makes names resolve against an object chosen while running, so this check cannot tell what they refer to.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saThisCssAsksTheBrowserTo: {
    message: 'This CSS asks the browser to load $SHOWN$. A stylesheet can use a request like this to send information about the page to another server.$OWN$',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: SHOWN, OWN.',
    placeholders: ['SHOWN', 'OWN'],
  },
  saThisCssImportsAnotherStylesheetThe: {
    message: 'This CSS imports another stylesheet. The imported file can change after the transform is approved, so @import is never allowed.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saThisCssContainsAUrlThat: {
    message: 'This CSS contains a url() that could not be read, so it cannot be checked.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saThisCssBuildsAUrlWith: {
    message: 'This CSS builds a URL with $NAME$() inside $ENCLOSING$(), which cannot be checked before it runs.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME, ENCLOSING.',
    placeholders: ['NAME', 'ENCLOSING'],
  },
  saThisCssHasAWhoseAddress: {
    message: 'This CSS has a $NAME$() whose address is not a plain string, so it cannot be checked.',
    description: 'A finding of the code check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saSendsANetworkRequest: {
    message: 'Sends a network request.',
    description: 'A finding of the code check, shown to the user before code is saved.',
  },
  saThisCodeCouldNotBeParsed: {
    message: 'This code could not be parsed, so it cannot be checked: $ERROR$',
    description: 'A finding of the code check, shown to the user before code is saved. $ERROR$ is the message of the parser.',
    placeholders: ['ERROR'],
  },
  saOwnSameOrigin: {
    message: 'By default only data: URLs are allowed. A per-site setting allows URLs on the same origin as the page.',
    description: 'A finding of the code check, shown to the user before code is saved. This sentence is added to the explanation of a refused address.',
  },
  saOwnSameOriginOnly: {
    message: 'Only data: URLs and URLs on the same origin as the page are allowed.',
    description: 'A finding of the code check, shown to the user before code is saved. This sentence is added to the explanation of a refused address.',
  },
  saOwnDataOnly: {
    message: 'By default only data: URLs are allowed.',
    description: 'A finding of the code check, shown to the user before code is saved. This sentence is added to the explanation of a refused address.',
  },
  saApiHiddenCharacter: {
    message: '(hidden character)',
    description: 'Name of the function, property or case that a finding of the code check is about, shown after the words \'Line N uses\'.',
  },
  saApiParse: {
    message: '(parse)',
    description: 'Name of the function, property or case that a finding of the code check is about, shown after the words \'Line N uses\'.',
  },
  saApiExistingElement: {
    message: '$API$ (existing element)',
    description: 'Name of the function, property or case that a finding of the code check is about, shown after the words \'Line N uses\'. $API$ is the name of a property.',
    placeholders: ['API'],
  },
  saApiEventHandlerProperty: {
    message: '$NAME$ (event handler property)',
    description: 'Name of the function, property or case that a finding of the code check is about, shown after the words \'Line N uses\'. $NAME$ is the name of a property.',
    placeholders: ['NAME'],
  },
  saApiJavascriptAddress: {
    message: '$NAME$ (javascript: address)',
    description: 'Name of the function, property or case that a finding of the code check is about, shown after the words \'Line N uses\'. $NAME$ is the name of a property. The words javascript: are a code prefix and stay as written.',
    placeholders: ['NAME'],
  },
  saApiEventParameter: {
    message: 'event parameter',
    description: 'Name of the function, property or case that a finding of the code check is about, shown after the words \'Line N uses\'.',
  },
  saApiDynamicProperty: {
    message: '(dynamic property access)',
    description: 'Name of the function, property or case that a finding of the code check is about, shown after the words \'Line N uses\'.',
  },
  saApiNotWrittenOut: {
    message: '$NAME$(not written out)',
    description: 'Name of the function, property or case that a finding of the code check is about, shown after the words \'Line N uses\'. $NAME$ is the name of a function.',
    placeholders: ['NAME'],
  },
})
