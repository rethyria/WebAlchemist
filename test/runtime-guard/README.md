# Removing undeclared features from a transform's world at run time (#139)

Static analysis of JavaScript cannot be complete, and the world's CSP does not stop `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or `EventSource` (see `test/csp`). The runtime guard is a second protection. Before a transform runs in its USER_SCRIPT world, the guard (`src/background/runtime-guard.ts`) removes every feature that the transform did not declare a capability for. This directory records what was measured to decide how to do that, what the guard stops, and what stays reachable.

Measured on 2026-11-01 in Firefox 159.0 (flatpak build, SteamOS), with Firefox started by `npm run start:firefox`.

## Result

The guard hides the listed features from every route to the window that the issue names: the bare name, `window`, `self`, `top`, `parent`, `document.defaultView`, `getRootNode()`, `parentNode`, `Object.getPrototypeOf(globalThis)`, `this` in a timer callback, the target of an event on `window` or on `document`, `frames[0]`, and the `contentWindow` of a created iframe. It also hides two routes that the issue did not list and that the measurements found: `window.wrappedJSObject` (the page's real window) and `element.constructor.constructor` (the page's `Function`). A transform that declared a capability keeps the features of that capability. The page's own use of every feature is unaffected.

The guard refuses to create an element with a browsing context of its own, which closes the windows reached by index (`window[0]`) for frames that the transform creates and the request of an `iframe` with an `src`. For a transform that did not declare `network` it also refuses CSS text that loads an address, which closes the requests of `url()`, `@import` and `@font-face` in a style element and in a sheet. The frames that the page already had stay reachable by index and have every feature. The Xray waiver on any element, event or collection stays open (see the sections below), so the guard is a second protection and not a boundary against a transform written to evade the static analysis. The acceptance criterion of #139 asks for each feature to be unreachable from a transform that declared nothing, through every route, so it is not met in full.

## What was measured

### Ways of removing a feature

`techniques.mjs` tries five ways of removing `fetch` and `localStorage` and reads both back through 13 routes to a window.

| Technique | Result |
|---|---|
| none (control) | Both features reachable through all 13 routes |
| `delete globalThis[name]` | Nothing removed; both features reachable through all 13 routes |
| `globalThis[name] = undefined` | `fetch` hidden when read by its bare name only; reachable through the other 12 routes. Assigning to the accessor `localStorage` has no effect. |
| `Object.defineProperty(globalThis, name, throwing getter)` | Both hidden when read by their bare names only; reachable through the other 12 routes |
| `Object.defineProperty(window, name, throwing getter)` | Both hidden through every route except `wrappedJSObject`, a created iframe's `contentWindow` and `frames[0]` |

The control that explains the table: in a USER_SCRIPT world the global object that the code sees is not the window (`window === globalThis` is false). It is a sandbox object whose prototype is an Xray wrapper (a wrapper that shows the page's objects to the extension without exposing changes made by the page) of the window. Changes made to the sandbox object are seen only by code that reads the bare name. A property defined on the window wrapper is seen by every route that arrives at the window, and the page does not see it, as the page controls below show. The guard therefore defines non-configurable throwing accessors on `window`.

### Reachability with and without the guard

`probe.mjs` runs the same measuring code as a user script in a USER_SCRIPT world on a test page served from `http://localhost:8791/page`. For each of 19 routes that produce a window, it reads 18 features and makes one real request for each of fetch, XMLHttpRequest, WebSocket, `sendBeacon` and EventSource. A local server records which requests arrive, so the server and not the measuring code decides whether a request left.

| Configuration | Result |
|---|---|
| Baseline, no guard (control) | All 19 routes reach all 18 features. Calling the bare-name `eval` and `Function` fails with an EvalError from the world CSP. The server sees every request from every route. |
| Guard of commit 76d9244, nothing declared | Of the 19 routes, 12 give a window with none of the 18 features, 5 throw instead of giving a window (`wrappedJSObject`, `contentWindow`, `contentDocument.defaultView`, the `contentWindow` getter taken from the prototype, and `frames[0]`), and 2 (`window[0]` and `window[1]`) give a window with all 18. The server sees no request from the first 17 routes. |
| Guard with the refusal of frame creation, nothing declared | The same 12 routes give a window with none of the 18 features. The iframes are not created, so `window[0]`, `window[1]` and the named frame give no window, and the other routes that need a frame throw. The server sees no request from any route. |
| Guard, `network` declared | `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource` and `RTCPeerConnection` work and the server sees the requests; storage, cookies, workers, `open` and `serviceWorker` stay hidden |
| Guard, `storage` and `cookies` declared | `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `cookieStore` and `document.cookie` work; network features stay hidden and the server sees none |

Features hidden when nothing is declared: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `RTCPeerConnection`, `open`, `Worker`, `SharedWorker`, `importScripts`, `eval`, `Function`, `indexedDB`, `localStorage`, `sessionStorage`, `caches`, `cookieStore`, `navigator.sendBeacon`, `navigator.serviceWorker`, `document.cookie`, `wrappedJSObject`, `frames`, and a string given to `setTimeout` or `setInterval`. The probe does not read `importScripts` (a window has none), `WebTransport` or `webkitRTCPeerConnection`; the guard defines them, and the unit tests check the definitions.

Other routes checked with the guard on and nothing declared:

| Route | Baseline | With the guard |
|---|---|---|
| `Reflect.get(window, 'fetch')` | works | refused |
| `Object.getOwnPropertyDescriptor(Navigator.prototype, 'sendBeacon').value.call(navigator, url)` | request arrives | refused |
| `Navigator.prototype.sendBeacon.call(navigator, url)` | request arrives | refused |
| `Document.prototype` cookie getter called on `document` | returns the cookie | refused |
| `document.implementation.createHTMLDocument().cookie` | returns an empty string | refused |
| `window.eval('1 + 1')` | works (runs in the page) | refused |
| `document.body.constructor.constructor('...')()` | runs code in the page; `fetch` in it reached the server | refused |
| The same through `window`, `Event`, `MutationObserver`, a `NodeList`, `getBoundingClientRect()`, `navigator`, `location` and `history` | works | refused |
| `setTimeout('code', 0)` and `setInterval('code', 5)` | the code runs | refused |
| `setTimeout(function, 0, 'x', 'y')` | runs, with arguments | runs, with arguments |
| `eval`, `Function`, `[].constructor.constructor` and `(() => {}).constructor` of the sandbox itself | refused by the world CSP with an EvalError | refused by the world CSP |
| `import('http://localhost:8791/mod.js')` | no request arrived; the request arrives when the world CSP is open | unchanged |

Controls for the `eval` rows: with `'unsafe-eval'` added to the world CSP, the sandbox's `eval` and `Function` work, so the refusal in the baseline comes from the CSP and not from anything else. The page-realm `Function` is not refused by the CSP, which is why the guard defines `constructor` on the page's `Function.prototype` as the world sees it, found as `Object.getPrototypeOf(EventTarget)`.

### The page and other worlds

After each run the page itself, evaluated from its own context, was checked. In all three guarded configurations the page's `fetch` is native code; its `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` and `EventSource` requests reach the server; `localStorage`, `sessionStorage` and `document.cookie` work; `eval` and `Function` run; a string given to `setTimeout` runs; `window.frames` and `window.open` exist; a new iframe has a `contentWindow` with a `fetch`; and `Worker` and `navigator.serviceWorker` exist. These checks can fail, because the same reads made from the world are refused in the same runs. The probe prints the same page-side results for the baseline run and does not assert them there.

The guard was not applied to a world other than USER_SCRIPT. In the MAIN world the world is the page, and removing `fetch` would break the page.

### Elements the transform inserts

`probe.mjs` also inserts ten elements and reads from the server whether each request arrived. Controls: with the world CSP set to `default-src * 'unsafe-inline'` and a page without a policy, all ten arrive.

| Element | Strict world CSP (nothing declared) | World CSP with `img-src *` (network declared) | Governing policy |
|---|---|---|---|
| `new Image().src` | refused | arrives | World |
| `img` in the document | refused | arrives | World |
| `link rel="stylesheet"` | refused | refused | World |
| Inline style property with `url()` | refused | arrives | World |
| `audio` with `src` | refused | refused | World |
| `script` with `src` | refused | refused | World |
| `style` element containing `url()` | arrives | arrives | Page |
| `style` element containing `@import` | arrives | arrives | Page |
| `style` element containing `@font-face` | arrives | arrives | Page |
| `iframe` with `src` | arrives | arrives | Neither |

For the rows marked Page: with an open world CSP and a page that sends `default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; frame-src 'none'`, the three style loads do not arrive. For the rows marked World: with an open world CSP and the page policy above, those elements still arrive, so the page policy does not govern them. For the iframe: the request arrives under a strict world policy and under that page policy, which has `frame-src 'none'`, so neither policy stopped it. The image route that #21 found closed for `new Image()` is closed for inserted `img` elements as well. These four routes were open to a transform under the guard of commit 76d9244. The sections that follow measure what the guard does to them now.

### Requests from stylesheet text and from iframe src

The four routes above that no policy governed are closed by two refusals in the guard: the refusal to create frames (see the next section), which stops the `iframe` with an `src`, and a check of the CSS text that a transform writes, for a transform that did not declare `network`. `styles.mjs` measures the text check on 2026-11-01 in Firefox 159.0, on a page that has a style element of its own. It puts CSS that loads an address into the document by 69 paths, each for an element with its own id and its own address, so the server's log shows which path made a request. The paths are:

- the text of a style element: `textContent`, `innerHTML`, `innerText`, `appendChild`, `insertBefore` and `replaceChild` of a text node, `append`, `prepend`, `replaceChildren`, `insertAdjacentText`, and a range's `insertNode`;
- the text node inside a style element: `data`, `nodeValue`, `textContent`, `appendData`, `insertData`, `replaceData`, `replaceWith`, `before`, `after`, and `splitText` followed by `data`;
- a style element built before it is inserted, a clone of one, an SVG style element, the page's own style element (written with `+=` and with `appendChild`), and a style element in a shadow root;
- markup that holds a style element or a style attribute, through `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `createContextualFragment`, `DOMParser`, a `template`, `setHTMLUnsafe` and a shadow root's `innerHTML`;
- the text of a sheet: `insertRule` (also with `@import`), the legacy `addRule`, `insertRule` of a grouping rule, `replaceSync`, `replace` and `insertRule` on a constructed sheet put in `document.adoptedStyleSheets` or a shadow root's `adoptedStyleSheets`, and a sheet whose text came from another document;
- the declarations of a rule in a sheet: `setProperty`, `cssText`, the property setters `backgroundImage` and `background`, a custom property used by `var()`, and the declarations of a keyframe;
- the forms of the text, written through `textContent`: `url()` unquoted, quoted and in upper case, `@import` with `url()` and with a string, `@font-face` whose font is used, `image-set()` with and without the `-webkit-` prefix, `list-style-image`, `cursor`, `content: url()`, an escape inside `url` and inside `@import` (`u\72l(`, `@\69mport`), a token split over two writes (`@imp` then `ort ...`), and a split over two text nodes.

Controls and results:

| Check | Result |
|---|---|
| Baseline, no guard (control) | All 69 paths request their address, and the server sees each one. The two inline style paths (`style.cssText` and `setAttribute('style', ...)` on an element) send no request, because the world's CSP refuses them, which also shows that the world's policy governs inline style and not the `style` element. A form with a `data:` address and a form with no address send no request. |
| The page, from its own context, in every configuration | The same 69 paths make their requests under other addresses, so the page is unaffected by the wrappers. |
| Guard of commit bb130c3, with the frame refusal and without the text check | All 69 paths still request their addresses. Refusing the creation of frames does not close them. |
| Guard with the text check, nothing declared | None of the 69 paths requests its address, and each one raised the guard's error. A rule with no address (`color: red; content: "\201C"`) is accepted. The inline style set with `setAttribute` is not touched. |
| Guard with the text check, `network` declared | All 69 paths request their addresses again, so the check refuses undeclared addresses and is not a general block of CSS. |
| `probe.mjs`, the `iframe` with an `src`, nothing declared | No request: the frame was refused. With the world CSP and the page policy that were measured before, the request had arrived. |

How the text check works. The guard wraps every function and setter of the list above. A text is refused when it contains `@import`, `url(`, `image-set(`, `image(`, `cross-fade(` or `src(`, which are the names that the static analysis uses for CSS that loads an address, with the addition of three functions. Escapes are decoded first, so `u\72l(` is read as `url(`. A write into a style element, or into a text node inside one, is checked together with the text that is already there, and is refused when the two together hold more of these tokens than the existing text did; this is what stops a token split over two writes and still allows a page's own style element, which may already hold an address, to be written to. A node that is passed (a text node, a fragment) is read for its text once, and any other object is converted once, as in the frame refusal. Markup is refused when it holds one of the tokens and also a `style` element or a `style` attribute. All of this is skipped when `network` is declared. The check treats a `data:` address as an address, because the static analysis does too: `url(data:...)` is refused for a transform that did not declare `network`.

Cost: the guard took 1 to 2 ms to run in the world without the text check and 5 ms with it, in this browser, which reports times in whole milliseconds. This is not a measurement of page load.

Not demonstrated as routes, because they sent no request even with no guard: `execCommand('insertText')` into an editable style element, a declaration of a nested rule (the nested rule had nothing to load), and the `src` descriptor of an `@font-face` rule, which Firefox refuses (a `NotSupportedError`). `rule.styleMap` does not exist in this version.

### Windows reached by index

`window[0]` is the window of the first frame, and a window reached this way has every feature, so it was the one route of the first version that stayed open. `frames.mjs` measures three ways to close it, on 2026-11-01 in Firefox 159.0 on the page `/page-frames` (which has two frames of its own), with nothing declared. Each creation route inserts an element, reads `window.length` before and after, and when it grew, makes a `fetch` through `window[length - 1]` so that the server shows whether the request left.

| Way to close it | Result |
|---|---|
| Throwing getters for `contentWindow` and `contentDocument` on the prototypes of `HTMLIFrameElement`, `HTMLFrameElement`, `HTMLObjectElement` and `HTMLEmbedElement` (the guard of commit 3da7cb7) | Does not close it. 28 of 38 creation routes made a frame and the server saw the request through `window[n]` for each of them, the same as with no guard. The getters hide the element's property and not the index. |
| Hiding the index and `length` on the window | Does not work for the index. `Object.defineProperty(window, '0', ...)` and the same for `1` succeed as calls, and the read still returns the frame's window; `delete window[0]` returns true and the read still works. `length` can be hidden (a throwing getter defined on it makes the read throw), but the index is reachable without reading it. `frames` was already hidden. A `Proxy` around the window does not help, because other routes give the real window. |
| Refusing the creation of the element in the world | Closes it for the frames the transform creates. 28 of 38 routes were refused, 6 made no frame because the markup was not a frame tag or an object was converted once, and 4 made a frame: the clone routes (`cloneNode`, `importNode`, `cloneContents`) applied to a frame that the page already had. |

The 38 routes, with the control that shows each can make a frame: with no guard, 28 made a frame. The routes are `createElement` and `createElementNS` (also in upper case, and with a namespace prefix), `object`, `embed` and a `frame` inside a `frameset`, `insertAdjacentHTML`, `innerHTML` and `outerHTML` on an element and on a detached element, `createContextualFragment`, `DOMParser` for HTML and for XML (with the node appended and with `importNode`), a `template`, an element made by `createHTMLDocument`, `setHTMLUnsafe`, `Document.parseHTMLUnsafe`, an `innerHTML` in a shadow root, `createDocument` with a frame as the root element, a customized built-in element (`class extends HTMLIFrameElement`, defined with `extends: 'iframe'` and made with `new`), tag names and markup given as objects, and `document.write` in a new document. `object` and `embed` with `about:blank` did not add to `window.length` even without the guard, and the `frame` in a `frameset` made a frame whose window threw a SecurityError when read; they are refused anyway.

The guard now wraps `createElement`, `createElementNS`, `DOMImplementation.createDocument`, `CustomElementRegistry.define` (the `extends` option), `insertAdjacentHTML`, `setHTML`, `setHTMLUnsafe`, `createContextualFragment`, `parseFromString`, `Document.parseHTMLUnsafe`, `execCommand` and the setters of `innerHTML` and `outerHTML` (and of `innerHTML` on a shadow root), and hides `document.write` and `document.writeln`. A markup string is refused when it holds an opening tag of `iframe`, `frame`, `frameset`, `object` or `embed`, in any case and with any namespace prefix. The clone routes are not wrapped: a cloned frame is a copy of one that the page has, and that frame's window is reachable by `window[0]` without any creation, so wrapping them would not close anything.

Controls and results of the refusal:

| Check | Result |
|---|---|
| Naive check (control): a wrapper on `createElement`, `insertAdjacentHTML` and `innerHTML` that converts the argument to a string to test it and then passes the original object on | Refuses a plain `iframe`, and is passed by an object whose `toString` returns `div` or `<p>` first and `iframe` second: a frame is made by each of the three. This shows that the rows below can fail. |
| The guard with an object whose `toString` changes | No frame. The guard converts an object once and passes the string it checked. |
| The same, after the code redefined `RegExp.prototype.exec` and `test`, `Function.prototype.apply` and `call`, `Reflect.apply`, `Array.prototype.join` and its iterator, `String.prototype.toString` and `window.String` | The same 28 routes refused and the same 4 clone routes. The guard reads the functions it depends on before the transform runs. Two routes in this run call a redefined built-in themselves, so their refusal is not counted for the guard. |
| Markup that is not a tag (`< iframe>`, text) | Not refused, and the naive check, which tests the substring, refuses it. |
| The page, from its own context, in both guarded runs | Creates a frame by `createElement`, `createElementNS`, `insertAdjacentHTML`, `innerHTML`, `outerHTML`, `createContextualFragment`, `DOMParser`, a `template`, `setHTMLUnsafe`, a customized built-in element and `createDocument`, and `window[n].fetch` is a function for each; its `createElement` and `insertAdjacentHTML` and the `innerHTML` setter are native code; `document.write` is a function. |

One route stays open: the windows of frames that the page already had. On `/page-frames`, `window[0]` reaches `fetch` with the guard, and the server sees the request. The page's own frames are not created by the transform and no definition on the window hides an index. A frame of another origin is not reachable this way, because its window is cross-origin; that was not measured.

### Page objects reached through the Xray waiver

A review of the first version of the guard (commit 76d9244) pointed out that `wrappedJSObject` is not specific to the window: Firefox offers the same waiver on every Xray-wrapped page object, and a waived page object leads back to the page's unmodified window. `resources.mjs` measures this on 2026-11-01 in Firefox 159.0, on the page `/page-frames`, in three configurations: no guard (the control), the guard with nothing declared, and the guard with `network` and `storage` declared.

Control: with no guard every route below works, and the server sees the requests that the routes make.

| Route | No guard | Guard, nothing declared |
|---|---|---|
| `document.wrappedJSObject.defaultView.fetch` | works, request arrives | refused |
| `navigator.wrappedJSObject.sendBeacon` | works, request arrives | refused |
| `location.wrappedJSObject`, `history.wrappedJSObject` | works | refused |
| `Node.prototype.wrappedJSObject.constructor.constructor('...')()` (the page's `Function`) | runs code | refused |
| `document.body.wrappedJSObject.ownerDocument.defaultView.fetch` | works, request arrives | works, request arrives |
| `document.createElement('div').wrappedJSObject` leading to the window | works, request arrives | works, request arrives |
| `e.target.wrappedJSObject` for an event on an element | works, request arrives | works, request arrives |
| `document.body.wrappedJSObject.constructor.constructor('return 10')()` | runs code in the page | runs code in the page |
| `XPCNativeWrapper.unwrap(document).defaultView.fetch` | works, request arrives | works, request arrives |

What was tried to close the open rows, and why it did not work:

- A property defined on `Node.prototype`, `EventTarget.prototype`, `Document.prototype`, `Navigator.prototype` or `Location.prototype` hides the waiver only when that prototype object is itself waived. It does not shadow `wrappedJSObject` on an instance: after the definition, `document.body.wrappedJSObject`, a new `div`, a text node, a `NodeList` and an `Event` still returned the page object. Firefox resolves `wrappedJSObject` on each Xray wrapper before it looks at the prototype chain. A definition on the instance works, so the guard defines it on `document`, `navigator`, `location` and `history`, which exist once each, and on the prototype objects. Every element, text node, event and collection is a new wrapper and cannot be covered this way.
- `XPCNativeWrapper` is a non-configurable, non-writable property of the sandbox's global object, and its `unwrap` method is non-configurable and non-writable. Defining a replacement throws a TypeError, so neither can be hidden, and `XPCNativeWrapper.unwrap(document)` gives the page's document.

The guard does hide the sandbox helpers `exportFunction`, `cloneInto`, `createObjectIn`, `importFunction` and `Components`, which are configurable. The static analysis now refuses the names `wrappedJSObject`, `XPCNativeWrapper`, `exportFunction`, `cloneInto`, `createObjectIn`, `importFunction` and `Components` (they are in `DENIED_NAMES`). The analysis is itself not complete, and these routes are not measured against its other limits here. With these open routes the guard is a second protection against code that passes the analysis without the denied names, and it is not a boundary that a transform written to evade the analysis cannot cross.

### Loads that the world's CSP does not stop

The same run measures routes that the review named, and others of the same kind. With no guard and the strict world CSP of a transform that declared nothing, these requests arrived at the server: `FontFace` loading a font, `AudioContext.audioWorklet.addModule` loading a script, `form.submit()` and `form.requestSubmit()` and a click on a submit button (each a POST), a `video` poster, and a `link` with `rel="modulepreload"`. `navigator.storage.getDirectory()` wrote and removed a file in the origin private file system. A `link` with `rel="prefetch"` was inserted and its request arrived in one of two runs, so it is not counted.

| Route | Guard, nothing declared | Guard, `network` and `storage` declared |
|---|---|---|
| `new FontFace('f', 'url(...)').load()` | refused (`FontFace` is hidden unless `network` is declared) | works, request arrives |
| `audioWorklet.addModule(url)` | refused (the property is hidden on `BaseAudioContext.prototype`; no capability allows it) | refused |
| `navigator.storage.getDirectory()` | refused (hidden unless `storage` is declared) | works |
| `form.submit()`, `form.requestSubmit()` | refused (hidden unless `network` is declared) | works, request arrives |
| Click on a submit button | request arrives | request arrives |
| `video` poster | request arrives | request arrives |
| `link rel="modulepreload"` | request arrives | request arrives |

The last three routes are attributes of inserted elements, in the same family as the `style` and `iframe` routes below, and are not closed. The page's own use of `FontFace`, `audioWorklet`, `form.submit()`, `navigator.storage` and the origin private file system is unaffected in both guarded configurations, and its form submission reaches the server; the page also still sees `wrappedJSObject` as undefined, as without the extension.

### The registration the extension makes

`integration.mjs` stores two transforms that pass the static analysis, switches them on with the `set-enabled` message from the options page, and reads the registration back with `userScripts.getScripts`. Controls and results: both transforms are registered; the one that declared nothing has the guard hiding `fetch` and `localStorage`; the one that declared `network` has the guard without `fetch` and with `localStorage` hidden; both transforms ran (one set an attribute on the page and the other changed its text, so the guard did not stop the wrapper); the one that declared `network` reached the server with `fetch`; and no error marker was written. A transform that declares nothing and passes the analysis cannot call `fetch`, so the refusal itself is shown by `probe.mjs` and by the unit tests.

## What remains reachable

- Windows reached by index for frames that the page already had (see the section on windows reached by index). A property cannot be defined on an index of the window wrapper.
- The Xray waiver on elements, text nodes, events and collections, and `XPCNativeWrapper.unwrap`. They reach the page's window and its `Function` (see the section on the waiver). Only the static analysis refuses them.
- A `video` poster, `link rel="modulepreload"` and a click on a submit button, which load or send without a feature of the window.
- Requests from stylesheet text are refused only for the 69 paths measured and the sinks that the guard wraps. A path that writes text into a style element that is not on the list, for example an editing command that was not shown to work, or a new interface that Firefox adds, is not covered.
- CSS that loads an address is checked by its text. An address built from several pieces that never form `url(` in one write (for example through a custom property set from separate writes) was not measured.
- Navigation. Setting `location` was not measured. The static analysis refuses it.
- Code run by the page through DOM sinks: inline event handler attributes, `javascript:` addresses, `script` elements, `document.write` and `innerHTML`. They were not measured. The static analysis refuses them, and the guard does not affect them. A `script` element with a `src` was refused by the world CSP in this run.
- The guard hides names, not the page. A transform can still change the page's DOM, which the page's own scripts then act on, and that includes the page's own `fetch` calls.

## What was not verified

- Resource-loading and sending APIs beyond those listed: only `FontFace`, `audioWorklet`, the origin private file system, form submission, `video` poster and the `link` relations above were measured.
- A transform in the MAIN world, which the guard cannot be applied to.
- Other Firefox versions. The extension requires 140 or later; only 159.0 was measured.
- Pages that have their own content security policy, other than the one test page described above.
- Frames of other origins, and a transform running on a page that creates its own frames after the transform ran. Only a page with two same-origin frames present at load was measured.
- The cost of the guard on page load. Only the time to run the guard script (1 to 5 ms, to the whole millisecond) was read, once per configuration.
- Every Web API that can send data (for example `navigator.mediaDevices`, `BroadcastChannel` and `postMessage` to other windows). Only the features listed above were tested.
- Whether a page that redefines `Document.prototype.createElement`, `Node.prototype.appendChild` or a CSS interface before the guard runs changes what the wrappers see. The guard reads the wrapper of the page's object that the world has, and the effect of a page redefinition on it was not measured.
- Behaviour with the guard when the page replaces `window.Function`, `EventTarget` or `Object` before the guard runs. A page script runs before the guard at `document_idle`, so a page can do this, and the effect on the guard was not measured.
- The production build has no probe for the failure path of the guard (a definition that throws). It is covered only by a unit test with a frozen stand-in window.

## Files

| File | Purpose |
|---|---|
| `techniques.mjs` | Which way of removing a feature works, per route |
| `probe.mjs` | Reachability by route with and without the guard, the page controls and the inserted elements |
| `styles.mjs`, `styles-code.mjs` | Requests made by stylesheet text, by 69 paths, with and without the text check |
| `frames.mjs`, `frames-code.mjs` | Windows reached by index, and the refusal of frame creation through every API that makes elements |
| `integration.mjs` | The guard in the registration that the extension makes |
| `resources.mjs`, `resources-code.mjs` | Page objects reached through the waiver, and loads that the world's CSP does not stop |
| `world.mjs` | Registers code in a world, opens a page and reads the report; shared by the probes that measure one part of the guard |
| `grant.mjs` | Grants or removes the `http://localhost/*` permission from the parent process, and compares the stored data with a saved hash |
| `measure-code.mjs` | The code that runs in the world for `probe.mjs` |
| `server.mjs` | The loopback server that records which requests arrive and serves the test pages |

## Reproducing

The probes need Firefox with the extension, remote debugging, the `userScripts` permission and the host permission for `http://localhost/*`. `web-ext run` chooses a random debugging port; the port is found with `ss -ltnp` and passed as `WA_RDP_PORT`. The host permission can be granted from the parent process with `ExtensionPermissions.add`, since an optional permission cannot be requested without a user gesture.

```
WA_RDP_PORT=<port> node test/runtime-guard/techniques.mjs
WA_RDP_PORT=<port> node test/runtime-guard/probe.mjs
WA_RDP_PORT=<port> node test/runtime-guard/integration.mjs
WA_RDP_PORT=<port> node test/runtime-guard/resources.mjs
WA_RDP_PORT=<port> node test/runtime-guard/frames.mjs
WA_RDP_PORT=<port> node test/runtime-guard/styles.mjs
```

`probe.mjs` imports `src/background/runtime-guard.ts` directly, which needs a Node version that strips TypeScript types (22.18 or later). Each probe prints its controls with its results and exits with 1 when a row of its verdict fails.
