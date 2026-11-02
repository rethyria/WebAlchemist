import { defineMessages } from './define'

/** Messages of the safety surface. */
export const safetyMessages = defineMessages({
  saOpensAPersistentNetworkConnection: {
    message: 'Opens a persistent network connection.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReadsOrWritesThisSiteS: {
    message: 'Reads or writes this site\'s stored data.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saCreatesAnImageElementWhichRequests: {
    message: 'Creates an image element, which requests the address it is given.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saCreatesAnAudioElementWhichRequests: {
    message: 'Creates an audio element, which requests the address it is given.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSendsDataToAServerIn: {
    message: 'Sends data to a server in the background.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReadsOrWritesThisSiteS2: {
    message: 'Reads or writes this site\'s cookies, which can include your session.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReadsOrWritesThisSiteS3: {
    message: 'Reads or writes this site\'s stored database.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReadsOrWritesThisSiteS4: {
    message: 'Reads or writes this site\'s cached responses.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saRunsCodeBuiltAtRuntimeWhich: {
    message: 'Runs code built from text, which cannot be checked before it runs.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saBuildsANewFunctionFromText: {
    message: 'Builds a new function from text, which cannot be checked before it runs.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saRefersToThePageGlobalObject: {
    message: 'Uses the page\'s global object, which gives access to every browser feature, including ones this check cannot see.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saRefersToTheTopLevelWindow: {
    message: 'Uses the page\'s top-level window, which gives access to every browser feature.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saRefersToTheParentWindowOf: {
    message: 'Uses the page\'s parent window, which gives access to every browser feature.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saRefersToThePageWindowsWhich: {
    message: 'Uses the page\'s windows, which give access to every browser feature.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saUsesTheWindowAsAValue: {
    message: 'Stores or passes on the window. Only direct reads such as window.innerWidth are allowed, because this check cannot follow a stored copy.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saUsesTheDocumentAsAValue: {
    message: 'Stores or passes on the document. Only direct calls and reads such as document.querySelector are allowed, because this check cannot follow a stored copy.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saUsesNavigatorAsAValueOnly: {
    message: 'Stores or passes on navigator. Only direct reads such as navigator.language are allowed, because this check cannot follow a stored copy.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saLooksUpAndCallsMembersBy: {
    message: 'Calls a function whose name is decided while running, so this check cannot tell which one.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saInterceptsPropertyAccessWhichThisCheck: {
    message: 'Intercepts property access, which this check cannot follow.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saNavigatesThePageWhichCanSend: {
    message: 'Loads a new address in the page. The address can carry page data to another site.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saOpensANewWindowOrDocument: {
    message: 'Opens a new window or document, which can send page data to another site.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSendsDataToAnotherWindow: {
    message: 'Sends data to another window.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saChangesTheAddressOfThePage: {
    message: 'Changes the address of the page.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saStartsASeparateScriptThatThis: {
    message: 'Starts a separate script that this check cannot see.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSendsDataToOtherTabs: {
    message: 'Sends data to other tabs.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSendsDataToOtherWindows: {
    message: 'Sends data to other windows.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saBuildsDataThatCanBeLoaded: {
    message: 'Builds data that can be loaded as a script or a page.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saBuildsElementsFromATextString: {
    message: 'Builds elements from a text string, which can load or run content.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saRunsCompiledCodeThatCannotBe: {
    message: 'Runs compiled code that cannot be checked.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saLoadsAndRunsCodeFromAnother: {
    message: 'Loads and runs code from another location.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReachesThePrototypeChainWhichCan: {
    message: 'Uses an object\'s prototype, which can be used to build code from text and run it.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReadsOrChangesHowAProperty: {
    message: 'Reads or changes how a property behaves, which can give access to features this check otherwise blocks.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReachesThePageGlobalObjectOr: {
    message: 'Gets the page\'s global object or another document, which gives access to every browser feature.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReachesAPageObjectThroughAWaiver: {
    message: 'Bypasses Firefox\'s protection between the extension and the page\'s own objects. This gives access to the page window, and through it to running code built from text.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saNavigatesThePageOrOpensA: {
    message: 'Navigates the page or opens a window, which can send page data to another site.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReturnsTheDocumentOrANode: {
    message: 'Gets the whole document from an element, and this check cannot follow the document after that.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saCreatesElementsOrAttributesInA: {
    message: 'Creates elements or attributes in a way this check cannot inspect.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReturnsTheDocumentInsideAnObject: {
    message: 'Gets the separate document inside an object or embed element, which this check cannot follow.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSubmitsAFormWhichSendsIts: {
    message: 'Submits a form, which sends its contents to the form address.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saStartsASeparateScriptOrBuilds: {
    message: 'Starts a separate script or builds a loadable address, which this check cannot see.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReachesAStyleSheetWhereText: {
    message: 'Changes a style sheet directly. A rule such as @import in a style sheet makes the browser load an address.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsStylesThroughTheTypedObject: {
    message: 'Sets styles in a way whose values are not checked the way style text is.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsThePageInsideAFrame: {
    message: 'Sets the content of a frame from text, which can run code.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saRedirectsThePageFromAMeta: {
    message: 'Redirects the page from a meta element.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReplacesContentByParsingAText: {
    message: 'Replaces content by parsing a text string as HTML, which can load or run content.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsTheSourceTextOfAn: {
    message: 'Sets the source text of an element that may be a script.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saThisCodeContainsTheInvisibleOr: {
    message: 'This code contains the invisible or direction-changing character U+$CODE$, which can make the code display differently from what runs. Remove it.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: CODE.',
    placeholders: ['CODE'],
  },
  saWritesToAMemberOfA: {
    message: 'Changes part of $NAME$, a built-in browser object. This can make later code behave in a way this check does not expect.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saAssignsToANameTheCode: {
    message: 'Assigns to $NAME$ without declaring it. This either replaces a built-in browser name or fails with an error, and neither changes the page.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saMovesFromTheHeadOrThe: {
    message: 'Moves into the elements inside the page head or root element. These include style elements, whose text can be rewritten to load an address that this check cannot see.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saChangesWhatDecidesWhetherAnElement: {
    message: 'Changes whether an element that this code did not create runs or loads. This can make an inactive script element run, and this check cannot tell which element it is.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReadsTheContentOfAnElement: {
    message: 'Reads the content of an element that this code did not create. If it is a template, putting its content in the page can start scripts inside it, and this check cannot tell which element it is.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saUsesWithoutCallingItDirectlySo: {
    message: 'Uses $NAME$ without calling it directly, so this check cannot see the arguments it is given.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saContainsStyleTextThatMakesThe: {
    message: 'Contains style text that makes the browser request an address.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saContainsAnAddressThatRunsCode: {
    message: 'Contains an address that runs code when it is followed.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsAnEventHandlerPropertyWhich: {
    message: 'Sets an event handler property, which can give the handler access to the window. Use addEventListener instead.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsAnAddressOnAnElement: {
    message: 'Sets an address on an element, which makes the browser request it or follow it.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsAnAddressThatIsNot: {
    message: 'Sets an address that is not written out in full or does not start with https://, http:// or a path, so this check cannot rule out a javascript: address, which runs code.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsPartOfAnAddressWhich: {
    message: 'Sets part of an address, which changes where a link or form goes.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsDataWhichIsAnAddress: {
    message: 'Sets a data property. On an object element this is an address that the browser loads, and this check cannot tell which kind of element this is.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsDataToAValueThat: {
    message: 'Sets a data property to a value that is not written out in full or does not start with https://, http:// or a path, so this check cannot rule out a javascript: address.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsAStyleThatCanLoad: {
    message: 'Sets a style that can load an address to a value that is not written out, so this check cannot tell what it loads.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsAStyleFromAVariable: {
    message: 'Sets a style from a variable that can hold an address, so this check cannot tell what it loads.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsACustomStylePropertyTo: {
    message: 'Sets a custom style property to a value that is not written out, so this check cannot tell whether it holds an address.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saTakesTheEventOfAWindow: {
    message: 'Unpacks the event in a window or document listener, so this check cannot follow where the event target goes.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReadsAPropertyWhoseNameIs: {
    message: 'Reads a property whose name is decided while running, so this check cannot tell what it accesses.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saUsesWhichIsNotOnThe: {
    message: 'Uses $NAME$.$NAME2$, which is not on the list of features a transform may use.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME, NAME2.',
    placeholders: ['NAME', 'NAME2'],
  },
  saUsesObjectWithoutCallingItDirectly: {
    message: 'Uses Object.$NAME$ without calling it directly, so this check cannot see the value it is given.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saReadsWhichObjectAnEventWas: {
    message: 'Reads the event target in a window or document listener, where the target can be the window or the document itself.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saPassesSomethingOtherThanAFunction: {
    message: 'Passes something other than a function written in this code to a timer. A text argument runs as code, which cannot be checked before it runs.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saGivesAddeventlistenerSomethingOtherThanA: {
    message: 'Gives $NAME$.addEventListener something other than a function written out in this code, so this check cannot follow the event it receives.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saAnimatesKeyframesThatAreNotWritten: {
    message: 'Animates styles that are not written out in this code, so this check cannot tell whether they load an address.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saCreatesAnElementWhoseTypeIs: {
    message: 'Creates an element whose type is decided while running, so this check cannot tell whether it loads or runs anything.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saCreatesAnElementThatRequestsAn: {
    message: 'Creates an element that requests an address.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saCreatesAElementWhichCanLoad: {
    message: 'Creates a $LOWER$ element, which can load or run content or send data.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: LOWER.',
    placeholders: ['LOWER'],
  },
  saSetsAnAttributeWhoseNameIs: {
    message: 'Sets an attribute whose name is decided while running, so this check cannot tell whether it carries an address or code.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsAnEventHandlerAttributeWhich: {
    message: 'Sets an event handler attribute, which runs text as code.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saRemovesAnAttributeWhoseNameIs: {
    message: 'Removes an attribute whose name is decided while running, so this check cannot tell whether it is one that keeps a script element from running.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSetsAStyleWhoseNameIs: {
    message: 'Sets a style whose name is decided while running, so this check cannot tell whether it can load an address.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saCopiesPropertiesFromAValueWhose: {
    message: 'Copies properties from a value whose names are not written out, so this check cannot tell which properties it sets.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saCopiesPropertiesWhoseNamesAreNot: {
    message: 'Copies properties whose names are not written out, so this check cannot tell which properties it sets.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saListsTheNamesOfAValue: {
    message: 'Lists the property names of a value that is not written out in this code, which can find features that this check blocks by name.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSelectsElementsWithASelectorOr: {
    message: 'Selects elements with a selector or tag name that is not written out in this code, so this check cannot tell whether it selects a script or style element.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSelectsAScriptOrStyleElement: {
    message: 'Selects a script or style element. Transforms may not do this, because the text of these elements can be rewritten to run code or load an address that this check cannot see.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saSelectsEveryElementWhichIncludesScript: {
    message: 'Selects every element, which includes script and style elements whose text can be rewritten, and this check cannot see what is written.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saUsesTheEventOfAWindow: {
    message: 'Uses the event of a window or document listener as a value. Only direct reads such as event.key are allowed, because its target can be the window or the document.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saReadsTheArgumentsOfAWindow: {
    message: 'Reads the arguments of a window or document listener, which include its event, so this check cannot follow where the event target goes.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saUsesAsAValueOnlyDirect: {
    message: 'Stores or passes on $NAME$. Only direct uses such as Object.assign, Math.floor and Array.from are allowed, because this check cannot follow a stored copy.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saUsesWhichIsNotOnThe2: {
    message: 'Uses $NAME$, which is not on the list of features a transform may use.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saUsesThisOutsideAFunctionWhere: {
    message: 'Uses "this" outside a function, where it is the page\'s global object, which gives access to every browser feature.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saLoadsAndRunsCodeFromAnother2: {
    message: 'Loads and runs code from another location, which is never allowed.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saMakesNamesResolveAgainstAnObject: {
    message: 'Makes names resolve against an object chosen while running, so this check cannot tell what they refer to.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saThisCssAsksTheBrowserTo: {
    message: 'This CSS makes the browser load $SHOWN$. A request like this can send information about the page to another server.$OWN$',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: SHOWN, OWN.',
    placeholders: ['SHOWN', 'OWN'],
  },
  saThisCssImportsAnotherStylesheetThe: {
    message: 'This CSS imports another stylesheet. The imported file can change after the transform is approved, so @import is never allowed.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saThisCssContainsAUrlThat: {
    message: 'This CSS contains a url() that could not be read, so it cannot be checked.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saThisCssBuildsAUrlWith: {
    message: 'This CSS builds an address with $NAME$() inside $ENCLOSING$(), which cannot be checked before it runs.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME, ENCLOSING.',
    placeholders: ['NAME', 'ENCLOSING'],
  },
  saThisCssHasAWhoseAddress: {
    message: 'This CSS has a $NAME$() whose address is not a plain string, so it cannot be checked.',
    description: 'A finding of the safety check, shown to the user before code is saved. Placeholders: NAME.',
    placeholders: ['NAME'],
  },
  saSendsANetworkRequest: {
    message: 'Sends a network request.',
    description: 'A finding of the safety check, shown to the user before code is saved.',
  },
  saThisCodeCouldNotBeParsed: {
    message: 'This code could not be read, so it cannot be checked: $ERROR$',
    description: 'A finding of the safety check, shown to the user before code is saved. $ERROR$ is the message of the parser.',
    placeholders: ['ERROR'],
  },
  saOwnSameOrigin: {
    message: 'By default only data: addresses are allowed. The setting "Advanced: addresses CSS may load" can also allow the page\'s own addresses (same domain, protocol and port).',
    description: 'A finding of the safety check, shown to the user before code is saved. This sentence is added to the explanation of a refused address.',
  },
  saOwnSameOriginOnly: {
    message: 'Only data: addresses and the page\'s own addresses (same domain, protocol and port) are allowed.',
    description: 'A finding of the safety check, shown to the user before code is saved. This sentence is added to the explanation of a refused address.',
  },
  saOwnDataOnly: {
    message: 'By default only data: addresses are allowed.',
    description: 'A finding of the safety check, shown to the user before code is saved. This sentence is added to the explanation of a refused address.',
  },
  saApiHiddenCharacter: {
    message: '(hidden character)',
    description: 'Name of the function, property or case that a finding of the safety check is about, shown after the words \'Line N uses\'.',
  },
  saApiParse: {
    message: '(parse)',
    description: 'Name of the function, property or case that a finding of the safety check is about, shown after the words \'Line N uses\'.',
  },
  saApiExistingElement: {
    message: '$API$ (existing element)',
    description: 'Name of the function, property or case that a finding of the safety check is about, shown after the words \'Line N uses\'. $API$ is the name of a property.',
    placeholders: ['API'],
  },
  saApiEventHandlerProperty: {
    message: '$NAME$ (event handler property)',
    description: 'Name of the function, property or case that a finding of the safety check is about, shown after the words \'Line N uses\'. $NAME$ is the name of a property.',
    placeholders: ['NAME'],
  },
  saApiJavascriptAddress: {
    message: '$NAME$ (javascript: address)',
    description: 'Name of the function, property or case that a finding of the safety check is about, shown after the words \'Line N uses\'. $NAME$ is the name of a property. The words javascript: are a code prefix and stay as written.',
    placeholders: ['NAME'],
  },
  saApiEventParameter: {
    message: 'event parameter',
    description: 'Name of the function, property or case that a finding of the safety check is about, shown after the words \'Line N uses\'.',
  },
  saApiDynamicProperty: {
    message: '(property name decided while running)',
    description: 'Name of the function, property or case that a finding of the safety check is about, shown after the words \'Line N uses\'.',
  },
  saApiNotWrittenOut: {
    message: '$NAME$ (not written out)',
    description: 'Name of the function, property or case that a finding of the safety check is about, shown after the words \'Line N uses\'. $NAME$ is the name of a function.',
    placeholders: ['NAME'],
  },
})
