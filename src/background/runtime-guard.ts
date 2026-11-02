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
 * The part of the guard that wraps the functions that make elements, parse
 * markup or write stylesheet text. It is text for the guard's function, which
 * supplies `failed`, `hide` and `refuse`. Two refusals are made, each switched
 * on by a flag:
 *
 *  - frames: an element with a browsing context of its own (`iframe`, `frame`,
 *    `frameset`, `object`, `embed`) is not created. A window reached by index
 *    (`window[0]`) is the window of a frame, and no definition on the window can
 *    hide an index (test/runtime-guard/README.md), so the frame is refused where
 *    it is made, by every API that makes elements from a name or from markup.
 *    This also stops the request of an `iframe` with an address.
 *  - style: CSS text that makes the browser request an address (`url()`,
 *    `@import`, `image-set()`, `src()`) is not written, for a transform that did
 *    not declare `network`. The world's CSP does not govern a `style` element,
 *    and the page's policy decides, so the text is checked where it is written.
 *
 * The wrappers are built to resist what a transform can do to them:
 *
 *  - Every native function they depend on is read once, here, before the
 *    transform runs, because a transform can redefine the methods of a
 *    prototype it can see. The regular expression engine, the string methods
 *    and the call are the captured ones. The wrappers use no iteration of an
 *    array and no regular-expression method of a string, which a transform can
 *    redefine.
 *  - An argument that is an object and not a node is converted to a string once,
 *    and the string is what is checked and what is passed on, so an object whose
 *    `toString` returns something else the second time cannot pass the check.
 *  - A tag name is compared whole, after removing a namespace prefix, so
 *    `createElementNS(ns, 'x:iframe')` is refused as well.
 *  - Markup is refused when it holds an opening tag of one of the five
 *    elements, whatever the case, namespace prefix or attributes.
 *  - Text written to a style element is checked together with the text that is
 *    already there, so a token split over two writes is seen, and escapes such
 *    as `u\72l(` are decoded before the check.
 */
function refusalSource(options: { frames: boolean; style: boolean }): string {
  return String.raw`
  const FRAMES = ${options.frames};
  const STYLE = ${options.style};
  const call = Reflect.apply;
  const execRegExp = RegExp.prototype.exec;
  const toText = String;
  const sliceText = String.prototype.slice;
  const indexOfText = String.prototype.indexOf;
  const fromCodePoint = String.fromCodePoint;
  const parseNumber = parseInt;
  // The native getter of a property, found on the prototype chain, or a stand-in
  // that records the failure so that the transform does not run.
  const getter = (owner, name) => {
    for (let object = owner; object !== null && object !== undefined; object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, name);
      if (descriptor && typeof descriptor.get === 'function') return descriptor.get;
    }
    failed.push(name);
    return () => undefined;
  };
  const FRAME_NAME = /^(?:[^:]*:)?(?:iframe|frameset|frame|object|embed)$/i;
  const FRAME_MARKUP = /<(?:[a-z][a-z0-9_.-]*:)?(?:iframe|frameset|frame|object|embed)(?![a-z0-9_.:-])/i;
  const STYLE_MARKUP = /<style|\bstyle\s*=/i;
  const matches = (pattern, text) => call(execRegExp, pattern, [text]) !== null;
  // A string stays as it is, and so do null and undefined, which some setters
  // treat as an empty string. An object is converted once.
  const plain = (value) => (value !== null && (typeof value === 'object' || typeof value === 'function') ? toText(value) : value);
  const refuseName = (name) => { if (FRAMES && matches(FRAME_NAME, toText(name))) refuse(); };

  // Stylesheet text that makes the browser request an address.
  const LOADING = /@import|\burl\s*\(|\bimage-set\s*\(|\bimage\s*\(|\bcross-fade\s*\(|\bsrc\s*\(/gi;
  const ESCAPE = /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^0-9a-fA-F\n])/g;
  const decode = (text) => {
    if (call(indexOfText, text, ['\\']) === -1) return text;
    let out = '';
    let last = 0;
    ESCAPE.lastIndex = 0;
    for (;;) {
      const found = call(execRegExp, ESCAPE, [text]);
      if (found === null) break;
      out += call(sliceText, text, [last, found.index]);
      if (found[1] !== undefined) {
        const code = parseNumber(found[1], 16);
        out += fromCodePoint(code === 0 || code > 0x10ffff ? 0xfffd : code);
      } else out += found[2];
      last = ESCAPE.lastIndex;
    }
    return out + call(sliceText, text, [last]);
  };
  const countIn = (text) => {
    let count = 0;
    LOADING.lastIndex = 0;
    while (call(execRegExp, LOADING, [text]) !== null) count += 1;
    return count;
  };
  const loadingCount = (text) => {
    const raw = toText(text);
    const decoded = decode(raw);
    return countIn(raw) + (decoded === raw ? 0 : countIn(decoded));
  };
  const refuseCss = (text) => { if (STYLE && text !== undefined && text !== null && loadingCount(text) > 0) refuse(); };

  // Which node is a style element, or a text node inside one.
  const nodeTypeOf = getter(Node.prototype, 'nodeType');
  const parentOf = getter(Node.prototype, 'parentNode');
  const textOf = getter(Node.prototype, 'textContent');
  const localNameOf = getter(Element.prototype, 'localName');
  const startContainerOf = getter(Range.prototype, 'startContainer');
  const isStyle = (node) => {
    try { return call(nodeTypeOf, node, []) === 1 && call(localNameOf, node, []) === 'style'; } catch (_) { return false; }
  };
  const styleOf = (node) => {
    if (isStyle(node)) return node;
    try {
      const type = call(nodeTypeOf, node, []);
      if (type === 3 || type === 4) { const parent = call(parentOf, node, []); if (parent !== null && isStyle(parent)) return parent; }
    } catch (_) {}
    return null;
  };
  // The text of a node or string, for the check. A node is read, and not passed through toString.
  const textFrom = (value) => {
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      try { return call(textOf, value, []); } catch (_) { return toText(value); }
    }
    return toText(value);
  };
  // An argument that is a node stays, and any other object is converted once.
  const snapshot = (value) => {
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      try { call(nodeTypeOf, value, []); return value; } catch (_) { return toText(value); }
    }
    return value;
  };
  // Refuses text written into a style element (or a text node inside one) when it
  // makes the browser request an address, alone or together with the text there.
  const refuseStyleWrite = (self, text) => {
    if (!STYLE) return;
    const style = styleOf(self);
    if (style === null) return;
    const added = textFrom(text);
    if (loadingCount(added) > 0) refuse();
    const existing = call(textOf, style, []);
    if (loadingCount(existing + added) > loadingCount(existing)) refuse();
  };
  const refuseStyleWriteOf = (self, values) => {
    if (!STYLE || styleOf(self) === null) return;
    let joined = '';
    for (let i = 0; i < values.length; i += 1) joined += textFrom(values[i]);
    refuseStyleWrite(self, joined);
  };
  const refuseMarkup = (markup, self) => {
    if (markup === undefined) return;
    const text = toText(markup);
    if (FRAMES && matches(FRAME_MARKUP, text)) refuse();
    if (STYLE) {
      if (matches(STYLE_MARKUP, text) && loadingCount(text) > 0) refuse();
      if (self !== undefined) refuseStyleWrite(self, text);
    }
  };

  // Replaces a method with one that checks the arguments and then calls the
  // original. Each argument in 'indexes' is converted once with 'convert', and
  // the converted value is what is checked and what is passed on.
  const wrapMethod = (owner, name, indexes, check, convert = plain) => {
    try {
      const original = Object.getOwnPropertyDescriptor(owner, name).value;
      if (typeof original !== 'function') throw new TypeError(name);
      Object.defineProperty(owner, name, {
        value: function (...args) {
          for (let i = 0; i < indexes.length; i += 1) if (indexes[i] < args.length) args[indexes[i]] = convert(args[indexes[i]]);
          check(args, this);
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
          check(text, this);
          call(original, this, [text]);
        },
        configurable: false,
      });
    } catch (_) { failed.push(name); }
  };
  const every = (count) => { const list = []; for (let i = 0; i < count; i += 1) list[list.length] = i; return list; };
  const ALL = every(32);

  if (FRAMES) {
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
    // Markup given to write can be split over calls, and a call after the page
    // has loaded replaces the whole document, so write is refused outright.
    hide(Document.prototype, 'write');
    hide(Document.prototype, 'writeln');
  }
  if (FRAMES || STYLE) {
    wrapMethod(Element.prototype, 'insertAdjacentHTML', [1], (a, self) => refuseMarkup(a[1], self));
    wrapMethod(Element.prototype, 'setHTMLUnsafe', [0], (a, self) => refuseMarkup(a[0], self));
    wrapMethod(Element.prototype, 'setHTML', [0], (a, self) => refuseMarkup(a[0], self));
    wrapMethod(ShadowRoot.prototype, 'setHTMLUnsafe', [0], (a) => refuseMarkup(a[0]));
    wrapMethod(ShadowRoot.prototype, 'setHTML', [0], (a) => refuseMarkup(a[0]));
    wrapMethod(Document, 'parseHTMLUnsafe', [0], (a) => refuseMarkup(a[0]));
    wrapMethod(Range.prototype, 'createContextualFragment', [0], (a) => refuseMarkup(a[0]));
    wrapMethod(DOMParser.prototype, 'parseFromString', [0], (a) => refuseMarkup(a[0]));
    wrapMethod(Document.prototype, 'execCommand', [2], (a) => { refuseMarkup(a[2]); if (typeof a[2] === 'string') refuseCss(a[2]); });
    wrapSetter(Element.prototype, 'innerHTML', refuseMarkup);
    wrapSetter(Element.prototype, 'outerHTML', (text) => refuseMarkup(text));
    wrapSetter(ShadowRoot.prototype, 'innerHTML', (text) => refuseMarkup(text));
  }
  if (STYLE) {
    // Text of a style element and of the text nodes inside it.
    wrapSetter(Node.prototype, 'textContent', (text, self) => refuseStyleWrite(self, text));
    wrapSetter(Node.prototype, 'nodeValue', (text, self) => refuseStyleWrite(self, text));
    wrapSetter(CharacterData.prototype, 'data', (text, self) => refuseStyleWrite(self, text));
    wrapSetter(HTMLElement.prototype, 'innerText', (text, self) => refuseStyleWrite(self, text));
    wrapMethod(CharacterData.prototype, 'appendData', [0], (a, self) => refuseStyleWrite(self, a[0]));
    wrapMethod(CharacterData.prototype, 'insertData', [1], (a, self) => refuseStyleWrite(self, a[1]));
    wrapMethod(CharacterData.prototype, 'replaceData', [2], (a, self) => refuseStyleWrite(self, a[2]));
    wrapMethod(Element.prototype, 'insertAdjacentText', [1], (a, self) => refuseStyleWrite(self, a[1]));
    for (const name of ['before', 'after', 'replaceWith']) {
      wrapMethod(CharacterData.prototype, name, ALL, (a, self) => refuseStyleWriteOf(self, a), snapshot);
    }
    for (const name of ['append', 'prepend', 'replaceChildren']) {
      wrapMethod(Element.prototype, name, ALL, (a, self) => refuseStyleWriteOf(self, a), snapshot);
    }
    wrapMethod(Node.prototype, 'appendChild', [0], (a, self) => refuseStyleWrite(self, a[0]), snapshot);
    wrapMethod(Node.prototype, 'insertBefore', [0], (a, self) => refuseStyleWrite(self, a[0]), snapshot);
    wrapMethod(Node.prototype, 'replaceChild', [0], (a, self) => refuseStyleWrite(self, a[0]), snapshot);
    wrapMethod(Range.prototype, 'insertNode', [0], (a, self) => {
      const container = call(startContainerOf, self, []);
      refuseStyleWrite(container, a[0]);
    }, snapshot);
    // The text of a sheet.
    wrapMethod(CSSStyleSheet.prototype, 'insertRule', [0], (a) => refuseCss(a[0]));
    wrapMethod(CSSStyleSheet.prototype, 'addRule', [1], (a) => refuseCss(a[1]));
    wrapMethod(CSSStyleSheet.prototype, 'replace', [0], (a) => refuseCss(a[0]));
    wrapMethod(CSSStyleSheet.prototype, 'replaceSync', [0], (a) => refuseCss(a[0]));
    wrapMethod(CSSGroupingRule.prototype, 'insertRule', [0], (a) => refuseCss(a[0]));
    // The declarations of a rule, and of any other style object.
    wrapMethod(CSSStyleDeclaration.prototype, 'setProperty', [1], (a) => refuseCss(a[1]));
    wrapSetter(CSSStyleDeclaration.prototype, 'cssText', (text) => refuseCss(text));
    for (const name of Object.getOwnPropertyNames(CSSStyleProperties.prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(CSSStyleProperties.prototype, name);
      if (descriptor && typeof descriptor.set === 'function') wrapSetter(CSSStyleProperties.prototype, name, (text) => refuseCss(text));
    }
  }
`
}

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
 * and `blockStyleText` are false only in the probe that measures what each
 * refusal adds, and are true otherwise. Style text is not checked for a
 * transform that declared `network`, because that capability covers addresses
 * in CSS.
 */
export function runtimeGuardSource(
  capabilities: Capability[],
  errorName: string,
  options: { blockFrames?: boolean; blockStyleText?: boolean } = {},
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
  ${refusalSource({ frames: options.blockFrames !== false, style: options.blockStyleText !== false && !network })}
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
