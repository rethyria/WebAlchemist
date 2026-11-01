# Removing undeclared features from a transform's world at run time (#139)

Static analysis of JavaScript cannot be complete, and the world's CSP does not stop `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or `EventSource` (see `test/csp`). The runtime guard is a second protection. Before a transform runs in its USER_SCRIPT world, the guard (`src/background/runtime-guard.ts`) removes every feature that the transform did not declare a capability for. This directory records what was measured to decide how to do that, what the guard stops, and what stays reachable.

Measured on 2026-11-01 in Firefox 159.0 (flatpak build, SteamOS), with Firefox started by `npm run start:firefox`.

## Result

The guard hides the listed features from every route to the window that the issue names: the bare name, `window`, `self`, `top`, `parent`, `document.defaultView`, `getRootNode()`, `parentNode`, `Object.getPrototypeOf(globalThis)`, `this` in a timer callback, the target of an event on `window` or on `document`, `frames[0]`, and the `contentWindow` of a created iframe. It also hides two routes that the issue did not list and that the measurements found: `window.wrappedJSObject` (the page's real window) and `element.constructor.constructor` (the page's `Function`). A transform that declared a capability keeps the features of that capability. The page's own use of every feature is unaffected.

One route stays open: a window reached by numeric index, `window[0]` and `window[1]` for the iframes a transform has created. It reaches every feature. The acceptance criterion of #139 asks for each feature to be unreachable from a transform that declared nothing, through every route, so it is not met in full, and the commit refers to the issue and does not close it. The static analysis refuses code that creates an iframe, which is the only protection against this route today.

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
| Guard, nothing declared | Of the 19 routes, 12 give a window with none of the 18 features, 5 throw instead of giving a window (`wrappedJSObject`, `contentWindow`, `contentDocument.defaultView`, the `contentWindow` getter taken from the prototype, and `frames[0]`), and 2 (`window[0]` and `window[1]`) give a window with all 18. The server sees no request from the first 17 routes. |
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

For the rows marked Page: with an open world CSP and a page that sends `default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; frame-src 'none'`, the three style loads do not arrive. For the rows marked World: with an open world CSP and the page policy above, those elements still arrive, so the page policy does not govern them. For the iframe: the request arrives under a strict world policy and under that page policy, which has `frame-src 'none'`, so neither policy stopped it. The image route that #21 found closed for `new Image()` is closed for inserted `img` elements as well. The four routes marked Page or Neither are open to a transform, and the guard does not change them. The static analysis refuses an address written to an element or to a style that can load a resource, so these routes depend on that check.

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

- Windows reached by index. `window[0]`, `window[1]` and so on, for iframes that the transform creates, reach every feature. A property cannot be defined on an index of the window wrapper (the call succeeds and the read is unchanged), so the guard cannot hide them. They could be closed only by refusing the creation of frames at run time through every API that creates elements, which was not attempted.
- The Xray waiver on elements, text nodes, events and collections, and `XPCNativeWrapper.unwrap`. They reach the page's window and its `Function` (see the section on the waiver). Only the static analysis refuses them.
- A `video` poster, `link rel="modulepreload"` and a click on a submit button, which load or send without a feature of the window.
- Requests made by inserted elements: `style` elements containing `url()`, `@import` or `@font-face`, and `iframe` with `src`, as in the table above.
- Navigation. Setting `location` was not measured. The static analysis refuses it.
- Code run by the page through DOM sinks: inline event handler attributes, `javascript:` addresses, `script` elements, `document.write` and `innerHTML`. They were not measured. The static analysis refuses them, and the guard does not affect them. A `script` element with a `src` was refused by the world CSP in this run.
- The guard hides names, not the page. A transform can still change the page's DOM, which the page's own scripts then act on, and that includes the page's own `fetch` calls.

## What was not verified

- Resource-loading and sending APIs beyond those listed: only `FontFace`, `audioWorklet`, the origin private file system, form submission, `video` poster and the `link` relations above were measured.
- A transform in the MAIN world, which the guard cannot be applied to.
- Other Firefox versions. The extension requires 140 or later; only 159.0 was measured.
- Pages that have their own content security policy, other than the one test page described above.
- A transform running on a page that already contains iframes, and frames of other origins.
- The cost of the guard on page load.
- Every Web API that can send data (for example `navigator.mediaDevices`, `BroadcastChannel`, `postMessage` to other windows, and form submission). Only the features listed above were tested.
- Behaviour with the guard when the page replaces `window.Function`, `EventTarget` or `Object` before the guard runs. A page script runs before the guard at `document_idle`, so a page can do this, and the effect on the guard was not measured.
- The production build has no probe for the failure path of the guard (a definition that throws). It is covered only by a unit test with a frozen stand-in window.

## Files

| File | Purpose |
|---|---|
| `techniques.mjs` | Which way of removing a feature works, per route |
| `probe.mjs` | Reachability by route with and without the guard, the page controls and the inserted elements |
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
```

`probe.mjs` imports `src/background/runtime-guard.ts` directly, which needs a Node version that strips TypeScript types (22.18 or later). Each probe prints its controls with its results and exits with 1 when a row of its verdict fails.
