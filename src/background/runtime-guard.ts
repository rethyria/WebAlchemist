/**
 * Removes the features a transform did not declare a capability for, from the
 * world the transform runs in (#139).
 *
 * WHY THIS EXISTS
 * ---------------
 * The static analysis cannot be complete, and the world's CSP does not stop
 * fetch, XMLHttpRequest, WebSocket, sendBeacon or EventSource (test/csp). This
 * is a second protection that works while the code runs and does not depend on
 * reading the code.
 *
 * WHAT THE MEASUREMENTS SHOWED (test/runtime-guard/README.md)
 * -----------------------------------------------------------
 * In a USER_SCRIPT world the global object that code sees is a sandbox object
 * whose prototype is an Xray wrapper of the page's window. Three results shaped
 * this file:
 *
 *  - `delete` on the global does nothing, and assigning to the global hides a
 *    feature only when it is read by its bare name. `window.fetch`, `self.fetch`,
 *    `this` in a timer callback, the target of an event on `window`, and
 *    `document.defaultView` all reach the wrapper and not the sandbox object.
 *  - Defining a property on the window wrapper itself hides the feature from
 *    every one of those routes at once, and the page does not see it: the page
 *    still calls its own fetch. The definitions are made non-configurable, so
 *    the transform cannot define them again.
 *  - `window.wrappedJSObject` is the page's real window, with every feature
 *    present, and a created iframe has a window of its own that none of the
 *    definitions reach. Both are hidden by defining a throwing property, on the
 *    window and on the iframe element prototypes.
 *
 * `eval` and `Function` of the sandbox itself are already refused by the world's
 * CSP, which has no 'unsafe-eval'. That was measured. The page's `Function` is
 * not refused by it: `document.body.constructor.constructor('...')` builds and
 * runs code in the page, with the page's `fetch`. It is closed by defining
 * `constructor` on the page's Function.prototype as the world sees it.
 *
 * This is not a complete defence and the module does not claim that. What stays
 * reachable is recorded in test/runtime-guard/README.md.
 *
 * This file imports nothing at run time, so the live probe can load it directly.
 */

import type { Capability } from '@shared/types'

/** A feature, the capability that opens it (null: no capability does), and where it is defined. */
interface Feature {
  name: string
  capability: Capability | null
}

/**
 * Properties of the window. A capability here matches the one the static
 * analysis attaches to the same name, so a transform that declared it is not
 * stopped from using what it declared.
 */
const WINDOW_FEATURES: Feature[] = [
  { name: 'fetch', capability: 'network' },
  { name: 'XMLHttpRequest', capability: 'network' },
  { name: 'WebSocket', capability: 'network' },
  { name: 'EventSource', capability: 'network' },
  { name: 'WebTransport', capability: 'network' },
  { name: 'RTCPeerConnection', capability: 'network' },
  { name: 'webkitRTCPeerConnection', capability: 'network' },
  { name: 'open', capability: null },
  { name: 'Worker', capability: null },
  { name: 'SharedWorker', capability: null },
  { name: 'importScripts', capability: null },
  { name: 'eval', capability: null },
  { name: 'Function', capability: null },
  { name: 'indexedDB', capability: 'storage' },
  { name: 'localStorage', capability: 'storage' },
  { name: 'sessionStorage', capability: 'storage' },
  { name: 'caches', capability: 'storage' },
  { name: 'cookieStore', capability: 'cookies' },
  // A font loaded from an address. The world's CSP does not govern it
  // (test/runtime-guard/README.md), and the request arrived.
  { name: 'FontFace', capability: 'network' },
  // The page's real window. Nothing declares a capability for it.
  { name: 'wrappedJSObject', capability: null },
  // The windows of frames, which have none of the definitions made here.
  { name: 'frames', capability: null },
]

/** The names a transform with these capabilities cannot reach on the window. */
export function guardedWindowNames(capabilities: Capability[]): string[] {
  return WINDOW_FEATURES.filter((f) => f.capability === null || !capabilities.includes(f.capability)).map(
    (f) => f.name,
  )
}

/**
 * The text of a script that hides the features, to run in the world before the
 * transform. It throws, after writing the marker named by `errorName`, when a
 * definition fails, so that a transform never runs with a feature that was meant
 * to be hidden. `errorName` is the attribute of script-errors.ts.
 */
export function runtimeGuardSource(capabilities: Capability[], errorName: string): string {
  const windowNames = guardedWindowNames(capabilities)
  const network = capabilities.includes('network')
  const cookies = capabilities.includes('cookies')
  const storage = capabilities.includes('storage')
  return `(() => {
  'use strict';
  const failed = [];
  const refuse = () => { throw new Error('Web Alchemist: this feature was not declared by the transform.'); };
  const hide = (target, name) => {
    try {
      Object.defineProperty(target, name, { get: refuse, set: refuse, configurable: false });
    } catch (_) { failed.push(name); }
  };
  for (const name of ${JSON.stringify(windowNames)}) hide(window, name);
  ${network ? '' : "hide(navigator, 'sendBeacon'); hide(Navigator.prototype, 'sendBeacon');"}
  hide(navigator, 'serviceWorker'); hide(Navigator.prototype, 'serviceWorker');
  ${storage ? '' : "hide(navigator, 'storage'); hide(Navigator.prototype, 'storage');"}
  // The page's own objects, reached through the waiver of an Xray wrapper. A
  // definition on an instance hides it for that object only, and one on a
  // prototype is read only when the prototype itself is the object, so these
  // are the objects that exist once. Every other node, event or collection
  // keeps its waiver (test/runtime-guard/README.md).
  for (const object of [document, navigator, location, history, Node.prototype, EventTarget.prototype, Document.prototype, Element.prototype, HTMLElement.prototype, Navigator.prototype, Location.prototype, History.prototype]) hide(object, 'wrappedJSObject');
  // Helpers of the sandbox that hand out or take page objects. XPCNativeWrapper
  // is not here: it and its unwrap method cannot be configured, so they cannot be hidden.
  for (const name of ['exportFunction', 'cloneInto', 'createObjectIn', 'importFunction', 'Components']) hide(globalThis, name);
  // Loads a module of code from an address, which the world's CSP does not stop.
  hide(BaseAudioContext.prototype, 'audioWorklet');
  ${network ? '' : "hide(HTMLFormElement.prototype, 'submit'); hide(HTMLFormElement.prototype, 'requestSubmit');"}
  ${cookies ? '' : "hide(document, 'cookie'); hide(Document.prototype, 'cookie');"}
  // The Function of the page, reached as element.constructor.constructor: the
  // first step is an interface object, and its prototype is the page's
  // Function.prototype, whose constructor builds code that runs in the page.
  hide(Object.getPrototypeOf(EventTarget), 'constructor');
  for (const proto of [HTMLIFrameElement.prototype, HTMLFrameElement.prototype, HTMLObjectElement.prototype, HTMLEmbedElement.prototype]) {
    hide(proto, 'contentWindow');
    hide(proto, 'contentDocument');
  }
  for (const name of ['setTimeout', 'setInterval']) {
    const original = window[name];
    try {
      Object.defineProperty(window, name, {
        value: function (handler, ...rest) {
          if (typeof handler !== 'function') refuse();
          return original.call(window, handler, ...rest);
        },
        configurable: false,
        writable: false,
      });
    } catch (_) { failed.push(name); }
  }
  if (failed.length > 0) {
    try { document.documentElement.setAttribute(${JSON.stringify(errorName)}, 'could not restrict: ' + failed.join(', ')); } catch (_) {}
    throw new Error('Web Alchemist: could not restrict ' + failed.join(', '));
  }
})();`
}
