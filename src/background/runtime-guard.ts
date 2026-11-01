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
 * Windows reached by index (`window[0]`) cannot be hidden, because no property
 * can be defined on an index of the window. The guard instead refuses to create
 * an element with a browsing context of its own (iframe, frame, frameset,
 * object, embed), through every API that makes elements. The frames that the
 * page already had stay reachable by index.
 *
 * This is not a complete defence and the module does not claim that. The Xray
 * waiver on elements, events and collections stays open, and so do several
 * loads that are made by attributes of inserted elements. What stays reachable
 * is recorded in test/runtime-guard/README.md.
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

/**
 * The part of the guard that refuses to create an element that has a browsing
 * context of its own: `iframe`, `frame`, `frameset`, `object` and `embed`. It
 * is text for the guard's function, which supplies `failed` and `refuse`.
 *
 * A window reached by index (`window[0]`) is the window of a frame, and no
 * definition on the window can hide an index (test/runtime-guard/README.md), so
 * the frame is refused at the point where it is made, by every API that makes
 * elements from a name or from markup. The wrappers are built to resist what a
 * transform can do to them:
 *
 *  - Every native function they depend on is read once, here, before the
 *    transform runs, because a transform can redefine the methods of a
 *    prototype it can see. The regular expression, the string conversion and the
 *    call are the captured ones.
 *  - An argument that is an object is converted to a string once, and the
 *    string is what is checked and what is passed on, so an object whose
 *    `toString` returns something else the second time cannot pass the check.
 *  - A tag name is compared whole, after removing a namespace prefix, so
 *    `createElementNS(ns, 'x:iframe')` is refused as well.
 *  - Markup is refused when it holds an opening tag of one of the five
 *    elements, whatever the case, namespace prefix or attributes.
 */
const FRAME_BLOCK = String.raw`
  const call = Reflect.apply;
  const execRegExp = RegExp.prototype.exec;
  const toText = String;
  const FRAME_NAME = /^(?:[^:]*:)?(?:iframe|frameset|frame|object|embed)$/i;
  const FRAME_MARKUP = /<(?:[a-z][a-z0-9_.-]*:)?(?:iframe|frameset|frame|object|embed)(?![a-z0-9_.:-])/i;
  const matches = (pattern, text) => call(execRegExp, pattern, [text]) !== null;
  // A string stays as it is, and so do null and undefined, which some setters
  // treat as an empty string. An object is converted once.
  const plain = (value) => (value !== null && (typeof value === 'object' || typeof value === 'function') ? toText(value) : value);
  const refuseName = (name) => { if (matches(FRAME_NAME, toText(name))) refuse(); };
  const refuseMarkup = (markup) => { if (markup !== undefined && matches(FRAME_MARKUP, toText(markup))) refuse(); };
  // Replaces a method with one that checks the arguments, converts each checked
  // argument once, and then calls the original.
  const wrapMethod = (owner, name, indexes, check) => {
    try {
      const original = Object.getOwnPropertyDescriptor(owner, name).value;
      if (typeof original !== 'function') throw new TypeError(name);
      Object.defineProperty(owner, name, {
        value: function (...args) {
          for (let i = 0; i < indexes.length; i += 1) if (indexes[i] < args.length) args[indexes[i]] = plain(args[indexes[i]]);
          check(args);
          return call(original, this, args);
        },
        configurable: false,
        writable: false,
      });
    } catch (_) { failed.push(name); }
  };
  const wrapSetter = (owner, name, check) => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      const original = descriptor.set;
      if (typeof original !== 'function') throw new TypeError(name);
      Object.defineProperty(owner, name, {
        get: descriptor.get,
        set: function (value) {
          const text = plain(value);
          check(text);
          call(original, this, [text]);
        },
        configurable: false,
      });
    } catch (_) { failed.push(name); }
  };
  wrapMethod(Document.prototype, 'createElement', [0], (a) => refuseName(a[0]));
  wrapMethod(Document.prototype, 'createElementNS', [1], (a) => refuseName(a[1]));
  wrapMethod(DOMImplementation.prototype, 'createDocument', [1], (a) => refuseName(a[1]));
  // A customized built-in element is made by calling the class that extends the
  // built-in one, so an option that extends a frame element is refused. The
  // option is read once and a new options object is passed on.
  wrapMethod(CustomElementRegistry.prototype, 'define', [], (a) => {
    if (a.length > 2 && a[2] !== null && typeof a[2] === 'object') {
      const extended = a[2].extends;
      const options = {};
      if (extended !== undefined) {
        const name = toText(extended);
        refuseName(name);
        options.extends = name;
      }
      a[2] = options;
    }
  });
  wrapMethod(Element.prototype, 'insertAdjacentHTML', [1], (a) => refuseMarkup(a[1]));
  wrapMethod(Element.prototype, 'setHTMLUnsafe', [0], (a) => refuseMarkup(a[0]));
  wrapMethod(Element.prototype, 'setHTML', [0], (a) => refuseMarkup(a[0]));
  wrapMethod(ShadowRoot.prototype, 'setHTMLUnsafe', [0], (a) => refuseMarkup(a[0]));
  wrapMethod(ShadowRoot.prototype, 'setHTML', [0], (a) => refuseMarkup(a[0]));
  wrapMethod(Document, 'parseHTMLUnsafe', [0], (a) => refuseMarkup(a[0]));
  wrapMethod(Range.prototype, 'createContextualFragment', [0], (a) => refuseMarkup(a[0]));
  wrapMethod(DOMParser.prototype, 'parseFromString', [0], (a) => refuseMarkup(a[0]));
  // Markup given to write can be split over calls, and a call after the page
  // has loaded replaces the whole document, so write is refused outright.
  hide(Document.prototype, 'write');
  hide(Document.prototype, 'writeln');
  wrapMethod(Document.prototype, 'execCommand', [2], (a) => refuseMarkup(a[2]));
  wrapSetter(Element.prototype, 'innerHTML', refuseMarkup);
  wrapSetter(Element.prototype, 'outerHTML', refuseMarkup);
  wrapSetter(ShadowRoot.prototype, 'innerHTML', refuseMarkup);
`

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
 * to be hidden. `errorName` is the attribute of script-errors.ts. `blockFrames`
 * is false only in the probe that measures what the refusal of frame creation
 * adds, and is true otherwise.
 */
export function runtimeGuardSource(
  capabilities: Capability[],
  errorName: string,
  options: { blockFrames?: boolean } = {},
): string {
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
  ${options.blockFrames === false ? '' : FRAME_BLOCK}
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
