/**
 * Deterministic pass over generated JavaScript, run before the code is ever
 * executed and before the model review.
 *
 * WHAT THIS IS FOR
 * ----------------
 * This is, together with the capability gate (applyCapabilityPolicy), the only
 * automatic control that runs before the user approves model-written
 * JavaScript. It is not backed by a runtime control. The per-world Content
 * Security Policy was expected to block external connections, but Firefox does
 * not apply `connect-src` in a USER_SCRIPT world: fetch, XMLHttpRequest,
 * sendBeacon and WebSocket all reached a server that was watching (measured in
 * test/csp/README.md). Anything this pass lets through therefore runs with the
 * page's cookies and the user's session.
 *
 * Static analysis is still useful because it is free, it always runs, and
 * unlike the model review nothing written on a webpage can talk it out of its
 * answer.
 *
 * HOW IT DECIDES: AN ALLOWLIST, NOT A DENY-LIST
 * ----------------------------------------------
 * The first version matched a list of dangerous dotted paths such as
 * `navigator.sendBeacon`. That matched only the literal text, so
 * `const n = navigator; n.sendBeacon(...)`, `Reflect.get(globalThis, 'fetch')`,
 * `[].constructor.constructor('...')()` and a created `<script>` element all
 * passed (#48). A deny-list cannot be completed, because the page's global
 * object has hundreds of members and any of them can be reached by a name the
 * analyser has not listed.
 *
 * This version inverts the question. Code passes only when everything it
 * touches is on a list of ordinary DOM reading and writing:
 *
 *  - A free identifier (one the code does not declare itself) must be a known
 *    harmless global such as `Math` or `MutationObserver`. `document`,
 *    `window` and `navigator` are accepted only as the object of a member
 *    access to an allowed member, never as a value, because an alias such as
 *    `const d = document` would carry them past every later check.
 *  - `globalThis`, `self`, `top`, `parent`, `frames`, `Reflect`, `Proxy` and a
 *    top-level `this` are refused, because each yields the global object or
 *    lets code look up a member by a computed name.
 *  - Property names that lead to the global object, to a new execution
 *    context, to a prototype or to an HTML-string sink are refused on any
 *    object. The check is on the name rather than the object because the
 *    analyser cannot know what an arbitrary value holds.
 *  - Computed access is accepted only when the key is a literal or provably a
 *    number. A number is a numeric literal or operation, a counter, the index
 *    parameter of forEach and its relatives on an array, or the result of
 *    indexOf on an array.
 *  - The window and the document are not reachable as values by another route
 *    either (audit of 00cc5f7). `this` is refused except in class and
 *    object-literal methods, the event of a listener on `window` or `document`
 *    can be read only for its properties other than the target, and
 *    `getRootNode`, `parentNode` chains, `Object.entries` and similar on
 *    values not written out in the code are refused.
 *  - A value written to an address property, or to a style that can load a
 *    resource, is checked as written, after CSS escapes are decoded, and for
 *    every text it can take through names and conditions between literals.
 *  - Elements that load or run things cannot be created, and attributes and
 *    properties that carry a URL cannot be set, unless the transform declares
 *    the network capability.
 *
 * The capability model is unchanged: use of `fetch`, `document.cookie`,
 * `localStorage` and the like is a finding that carries a capability, and
 * applyCapabilityPolicy raises it to a block when the transform did not
 * declare it. Aliasing and reflection stay blocked even when the capability is
 * declared, because they hide which capability is in use.
 *
 * WHAT THIS CANNOT DO
 * -------------------
 * It does not follow data across calls, so it cannot prove that an element
 * handed in from elsewhere is not a script element. It treats a selector that
 * names `script` as refused for that reason, and a few comparable gaps remain
 * (see the final comment on DENIED_NAMES). It also cannot judge intent: code
 * that only reads page text and writes it into a permitted element passes.
 *
 * WHAT HAPPENS WHEN THE ANALYSIS CANNOT TELL
 * ------------------------------------------
 * Fully dynamic access (`window[a + b]()`) cannot be resolved without running
 * the code. Because nothing downstream catches it, "cannot tell" is a block,
 * not a warning.
 */

import { parse } from 'acorn'
import type { Node } from 'acorn'
import type { Capability, StaticFinding } from '@shared/types'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** An acorn node. The tree is walked generically, so fields are read by name. */
interface N {
  type: string
  start: number
  end: number
  loc?: { start: { line: number; column: number } }
  [key: string]: any
}

interface Rule {
  /** Shown to the user as the matched API, e.g. "navigator.sendBeacon". */
  api: string
  capability: Capability | null
  severity: 'block' | 'warn'
  explanation: string
}

const NETWORK_SEND = 'Sends a network request.'
const NETWORK_OPEN = 'Opens a persistent network connection.'
const STORAGE_RW = "Reads or writes this site's stored data."

/**
 * Names that always belong to a capability, whether reached as a free
 * identifier, as `window.name`, or as a property of any object. Matching the
 * name on any object is what catches `x.fetch` and `Reflect`-free aliases such
 * as `top.navigator.sendBeacon`.
 */
const CAPABILITY_NAMES = new Map<string, Rule>([
  ['fetch', { api: 'fetch', capability: 'network', severity: 'warn', explanation: NETWORK_SEND }],
  ['XMLHttpRequest', { api: 'XMLHttpRequest', capability: 'network', severity: 'warn', explanation: NETWORK_SEND }],
  ['WebSocket', { api: 'WebSocket', capability: 'network', severity: 'warn', explanation: NETWORK_OPEN }],
  ['EventSource', { api: 'EventSource', capability: 'network', severity: 'warn', explanation: NETWORK_OPEN }],
  ['WebTransport', { api: 'WebTransport', capability: 'network', severity: 'warn', explanation: NETWORK_OPEN }],
  ['RTCPeerConnection', { api: 'RTCPeerConnection', capability: 'network', severity: 'warn', explanation: NETWORK_OPEN }],
  ['webkitRTCPeerConnection', { api: 'RTCPeerConnection', capability: 'network', severity: 'warn', explanation: NETWORK_OPEN }],
  ['Image', { api: 'Image', capability: 'network', severity: 'warn', explanation: 'Creates an image element, which requests the address it is given.' }],
  ['Audio', { api: 'Audio', capability: 'network', severity: 'warn', explanation: 'Creates an audio element, which requests the address it is given.' }],
  ['sendBeacon', { api: 'navigator.sendBeacon', capability: 'network', severity: 'warn', explanation: 'Sends data to a server in the background.' }],
  ['cookie', { api: 'document.cookie', capability: 'cookies', severity: 'warn', explanation: "Reads or writes this site's cookies, which can include your session." }],
  ['cookieStore', { api: 'cookieStore', capability: 'cookies', severity: 'warn', explanation: "Reads or writes this site's cookies, which can include your session." }],
  ['localStorage', { api: 'localStorage', capability: 'storage', severity: 'warn', explanation: STORAGE_RW }],
  ['sessionStorage', { api: 'sessionStorage', capability: 'storage', severity: 'warn', explanation: STORAGE_RW }],
  ['indexedDB', { api: 'indexedDB', capability: 'storage', severity: 'warn', explanation: "Reads or writes this site's stored database." }],
  ['caches', { api: 'caches', capability: 'storage', severity: 'warn', explanation: "Reads or writes this site's cached responses." }],
])

/** Code-from-string constructs. They hide the real behaviour in text. */
const CODE_FROM_STRING = new Map<string, string>([
  ['eval', 'Runs code built at runtime, which cannot be reviewed before it executes.'],
  ['Function', 'Builds a new function from text, which cannot be reviewed before it executes.'],
])

/**
 * Free identifiers that are never allowed, with the reason shown to the user.
 * Each either is the global object, reaches it, or gives code a way to look up
 * or intercept members by a computed name.
 */
const REFUSED_GLOBALS = new Map<string, string>([
  ['globalThis', 'Refers to the page global object, which can reach any browser feature under a name this check cannot see.'],
  ['self', 'Refers to the page global object, which can reach any browser feature under a name this check cannot see.'],
  ['top', 'Refers to the top-level window of the page, which can reach any browser feature.'],
  ['parent', 'Refers to the parent window of the page, which can reach any browser feature.'],
  ['frames', 'Refers to the page windows, which can reach any browser feature.'],
  ['window', 'Uses the window as a value. Only direct reads such as window.innerWidth are allowed, because a copy of the window hides what is later done with it.'],
  ['document', 'Uses the document as a value. Only direct calls and reads such as document.querySelector are allowed, because a copy of the document hides what is later done with it.'],
  ['navigator', 'Uses navigator as a value. Only direct reads such as navigator.language are allowed, because a copy hides what is later done with it.'],
  ['Reflect', 'Looks up and calls members by a computed name, which this check cannot follow.'],
  ['Proxy', 'Intercepts property access, which this check cannot follow.'],
  ['location', 'Navigates the page, which can send page data to another site in the address.'],
  ['open', 'Opens a new window or document, which can send page data to another site.'],
  ['postMessage', 'Sends data to another window.'],
  ['history', 'Changes the address of the page.'],
  ['Worker', 'Starts a separate script that this check cannot see.'],
  ['SharedWorker', 'Starts a separate script that this check cannot see.'],
  ['BroadcastChannel', 'Sends data to other tabs.'],
  ['MessageChannel', 'Sends data to other windows.'],
  ['Blob', 'Builds data that can be loaded as a script or a page.'],
  ['DOMParser', 'Builds elements from a text string, which can load or run content.'],
  ['WebAssembly', 'Runs compiled code that cannot be reviewed.'],
  ['importScripts', 'Loads and runs code from another location.'],
])

/**
 * Free identifiers a page transform may use. Chosen as the browser features
 * that read or build values and elements without sending anything anywhere or
 * running text as code. Timers are listed separately because they are allowed
 * only when called with a function.
 */
const ALLOWED_GLOBALS = new Set([
  'undefined', 'NaN', 'Infinity', 'arguments',
  'console', 'Math', 'JSON', 'Date', 'Intl', 'RegExp', 'Symbol', 'BigInt',
  'Object', 'Array', 'String', 'Number', 'Boolean',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Promise',
  'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Uint8Array', 'Int32Array', 'Float64Array', 'TextEncoder', 'TextDecoder',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'atob', 'btoa',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'structuredClone', 'queueMicrotask', 'URL', 'URLSearchParams', 'AbortController',
  'performance',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'getComputedStyle', 'matchMedia', 'getSelection', 'CSS',
  'innerWidth', 'innerHeight', 'scrollX', 'scrollY', 'scrollTo', 'scrollBy', 'devicePixelRatio',
  'Node', 'Element', 'NodeFilter', 'NodeList', 'HTMLCollection', 'DocumentFragment', 'Text', 'DOMRect',
  'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'InputEvent', 'PointerEvent', 'WheelEvent',
  'clearTimeout', 'clearInterval',
])
/**
 * Assignment operators whose result can be the right-hand side itself or text
 * built from it. Every other compound operator (`-=`, `*=`, `<<=` and so on)
 * converts both sides to numbers.
 */
const VALUE_ASSIGN_OPERATORS = new Set(['=', '+=', '||=', '&&=', '??='])
const ELEMENT_CLASS = /^(HTML|SVG)[A-Za-z]*Element$/

/** Timers: run text as code when given a string, so the first argument is checked. */
const TIMERS = new Set(['setTimeout', 'setInterval'])

/**
 * Members of `document`, `window` and `navigator` that a transform may read or
 * call. Anything else on these objects is refused, which is the allowlist for
 * the three objects through which most of the dangerous features are reached.
 */
const DOCUMENT_MEMBERS = new Set([
  'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName',
  'getElementsByTagName', 'getElementsByName', 'createElement', 'createTextNode',
  'createDocumentFragment', 'createComment', 'createTreeWalker', 'createNodeIterator',
  'body', 'head', 'documentElement', 'title', 'activeElement', 'scrollingElement',
  'readyState', 'hidden', 'visibilityState', 'hasFocus', 'contains', 'links', 'images',
  'elementFromPoint', 'elementsFromPoint', 'getSelection', 'URL',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
])
const WINDOW_MEMBERS = new Set([
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'scrollX', 'scrollY',
  'pageXOffset', 'pageYOffset', 'scrollTo', 'scrollBy', 'scroll', 'devicePixelRatio',
  'getComputedStyle', 'matchMedia', 'getSelection', 'visualViewport',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'CSS', 'console',
])
const NAVIGATOR_MEMBERS = new Set([
  'language', 'languages', 'userAgent', 'platform', 'onLine', 'hardwareConcurrency', 'maxTouchPoints',
])

/**
 * Property names refused on any object, with the reason. They are matched by
 * name because the analyser cannot know what an arbitrary value holds; a
 * name that never appears cannot be reached except through computed access,
 * which is refused separately.
 *
 * Gaps that remain: this does not stop code from copying an existing element
 * it found by a means other than a selector naming `script`, and it does not
 * stop navigation through a link the page already has, such as calling
 * `click()` on an existing anchor. Both need data-flow tracking across calls.
 */
const DENIED_NAMES = new Map<string, string>()
function deny(reason: string, ...names: string[]) {
  for (const name of names) DENIED_NAMES.set(name, reason)
}
deny(
  'Reaches the prototype chain, which can produce the Function constructor and run code built from text.',
  'constructor', 'prototype', '__proto__', 'caller', 'callee',
)
deny(
  'Reads or changes how a property behaves, which can reach members that are otherwise refused.',
  'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'defineProperty', 'defineProperties',
  'getPrototypeOf', 'setPrototypeOf', 'lookupGetter', 'lookupSetter',
)
deny(
  'Reaches the page global object or another document, which can reach any browser feature.',
  'defaultView', 'contentWindow', 'contentDocument', 'ownerDocument', 'view', 'composedPath',
  'window', 'globalThis', 'document', 'frames', 'self', 'parent', 'opener',
  'scripts', 'currentScript',
)
deny(
  'Navigates the page or opens a window, which can send page data to another site.',
  'location', 'history', 'postMessage', 'navigation', 'open',
)
deny(
  'Returns the document, or a node whose parent chain leads to it, so the document would be held as a value that this check cannot follow.',
  'getRootNode', 'parentNode', 'anchorNode', 'focusNode', 'baseNode', 'extentNode',
  'commonAncestorContainer', 'startContainer', 'endContainer',
)
deny(
  'Builds elements from a text string, which can load or run content.',
  'insertAdjacentHTML', 'setHTMLUnsafe', 'setHTML', 'parseHTMLUnsafe', 'createContextualFragment',
  'write', 'writeln', 'execCommand',
)
deny(
  'Creates elements or attributes in a way this check cannot inspect.',
  'createElementNS', 'setAttributeNS', 'setAttributeNode', 'setAttributeNodeNS',
  'createAttribute', 'createAttributeNS', 'attributes', 'importNode', 'adoptNode',
  // An attribute node is written through its own `value`, which skips every
  // check made on setAttribute.
  'getAttributeNode', 'getAttributeNodeNS',
  // Replaces the keyframes of an animation after element.animate was checked.
  'setKeyframes',
)
deny(
  'Submits a form, which sends its contents to the form address.',
  'submit', 'requestSubmit',
)
deny(
  'Starts a separate script or builds a loadable address, which this check cannot see.',
  'createObjectURL', 'Worker', 'SharedWorker', 'importScripts', 'serviceWorker', 'Blob',
  'Function', 'eval', 'Reflect', 'Proxy', 'DOMParser', 'BroadcastChannel',
)
deny(
  'Reaches a style sheet, where text such as an import rule makes the browser request an address.',
  'sheet', 'styleSheets', 'adoptedStyleSheets', 'insertRule', 'addRule', 'replaceSync',
)
deny('Sets the page inside a frame from a text string, which can run content.', 'srcdoc')
deny('Redirects the page from a meta element.', 'httpEquiv', 'http-equiv')

/**
 * Event properties that name the object an event was dispatched on. On an
 * event heard by a listener on `window` or `document` they can be the window
 * or the document, so they are refused inside such a listener. On a listener
 * on an element they are that element or a descendant and stay allowed.
 */
const EVENT_TARGET_NAMES = new Set([
  'target', 'currentTarget', 'srcElement', 'originalTarget', 'explicitOriginalTarget', 'composedTarget',
])

/**
 * What may follow `.parentNode` directly. The parent of the root element is
 * the document, and `parentNode` can be repeated to climb to it, so the value
 * is accepted only when it is used at once by one of these members, which
 * hold or return no way to a window. Names that reach more of the document,
 * such as `open`, `defaultView` or `cookie`, are refused wherever they appear.
 */
const PARENT_NODE_USES = new Set([
  'insertBefore', 'removeChild', 'replaceChild', 'appendChild', 'append', 'prepend', 'replaceChildren',
  'insertAdjacentElement', 'insertAdjacentText', 'contains', 'querySelector', 'querySelectorAll',
  'getElementsByClassName', 'getElementsByTagName', 'children', 'childNodes',
  'firstElementChild', 'lastElementChild', 'nodeName', 'nodeType', 'tagName', 'classList',
])

/** `Object` methods that list names a value has, refused unless the value is written out in the code. */
/**
 * Array methods that call a function with the position of each item, and the
 * position of that parameter. When the receiver is provably an array, that
 * parameter is a number. On a `Map` or `Set` the second parameter is a key of
 * any type, and on an object written in the code the method can call the
 * function with anything, so the receiver has to be shown to be an array.
 */
const INDEX_PARAMETER = new Map([
  ['forEach', 1], ['map', 1], ['filter', 1], ['some', 1], ['every', 1], ['find', 1],
  ['findIndex', 1], ['findLast', 1], ['findLastIndex', 1], ['flatMap', 1],
  ['reduce', 2], ['reduceRight', 2],
])
/** Methods that return a list, which makes their result an array or an array-like list of nodes. */
const LIST_METHODS = new Set([
  'querySelectorAll', 'getElementsByClassName', 'getElementsByTagName', 'getElementsByTagNameNS', 'getElementsByName',
])
/** Array methods whose result is an array when the receiver is one. */
const CHAIN_METHODS = new Set([
  'filter', 'map', 'slice', 'sort', 'concat', 'reverse', 'flat', 'flatMap', 'toSorted', 'toReversed', 'toSpliced', 'splice',
])
/** Methods that return a position in an array, or -1. */
const POSITION_METHODS = new Set(['indexOf', 'lastIndexOf', 'findIndex', 'findLastIndex'])
/** The properties of `location` that may be read. Writing them, or reading any other, is refused. */
const LOCATION_READS = new Set(['pathname', 'search', 'hash', 'href'])

const OBJECT_ENUMERATORS = new Set(['entries', 'values', 'keys', 'getOwnPropertyNames'])

/**
 * Methods that must be called directly. Reading one without calling it, as in
 * `const c = document.createElement; c.call(document, 'script')`, would let
 * the call-site checks below be skipped.
 */
const CALL_ONLY = new Set(['createElement', 'setAttribute', 'toggleAttribute', 'setProperty', 'assign', 'setTimeout', 'setInterval'])

/** Properties that run or build HTML when assigned. Reading them is harmless. */
const WRITE_REFUSED = new Map<string, string>([
  ['innerHTML', 'Replaces content by parsing a text string as HTML, which can load or run content.'],
  ['outerHTML', 'Replaces content by parsing a text string as HTML, which can load or run content.'],
  ['srcdoc', 'Sets the page inside a frame from a text string, which can run content.'],
  ['text', 'Sets the source text of an element that may be a script.'],
])
/**
 * Properties that carry a URL. Setting one makes the browser request it or
 * follow it. `baseVal` and `animVal` are the value of an SVG `href`, which is
 * an object, so `el.href.baseVal = '...'` sets the address.
 */
const WRITE_URL = new Set([
  'src', 'href', 'srcset', 'action', 'formAction', 'poster', 'ping', 'background', 'codebase', 'lowsrc',
  'baseVal', 'animVal',
])
/**
 * The parts of an address on a link or a form. Setting one changes where the
 * element goes (`a.hostname = 'evil.example'`), so each is network use, but
 * none can make the address a `javascript:` URL, so the check for that does
 * not apply. They are ordinary on a `URL` object, which loads nothing.
 */
const ADDRESS_PARTS = new Set([
  'hostname', 'host', 'protocol', 'pathname', 'search', 'hash', 'port', 'username', 'password',
])
/**
 * `data` is the address of an `object` element and also the text of a text
 * node, so the name alone cannot be refused. It is treated as an address
 * unless the object is provably a text node or comment made in this code.
 */
const DATA_PROPERTY = 'data'
/** The start of an address that cannot be a `javascript:` URL. */
const SAFE_URL_START = /^(https?:\/\/|\/|#|\?|\.\.?\/)/i
/** Attribute names that carry a URL, or run code, when set with setAttribute. */
const ATTRIBUTE_URL = new Set([
  'src', 'href', 'srcset', 'action', 'formaction', 'poster', 'ping', 'background',
  'codebase', 'lowsrc', 'xlink:href', 'data', 'manifest',
])

/** Elements that are inert when created: they request nothing and run nothing. */
const INERT_TAGS = new Set((
  'div span p a button ul ol li section article header footer nav aside main ' +
  'h1 h2 h3 h4 h5 h6 strong em b i u s small label input textarea select option optgroup ' +
  'table thead tbody tfoot tr td th caption colgroup col hr br pre code blockquote details ' +
  'summary dialog figure figcaption dl dt dd time mark kbd samp var sub sup abbr cite q ' +
  'address fieldset legend menu wbr picture progress meter output data bdi bdo ruby rt rp ' +
  'del ins canvas'
).split(' '))
/** Elements that request the address they are given. Allowed only with network. */
const LOADING_TAGS = new Set(['img', 'link', 'audio', 'video', 'source', 'track'])

/**
 * Methods that take a selector or tag name, checked for `script`, with the
 * position of that argument. The namespaced form takes the namespace first.
 */
const SELECTOR_METHODS = new Map([
  ['querySelector', 0], ['querySelectorAll', 0], ['getElementsByTagName', 0],
  ['getElementsByTagNameNS', 1], ['closest', 0], ['matches', 0],
])

/** Functions that resolve to another value later, so a literal using one proves nothing. */
const CSS_INDIRECT = /\b(var|env|attr)\s*\(/i
const CSS_LOADING_TEXT = /@import|\burl\s*\(|\bimage-set\s*\(|\bsrc\s*\(/i

/**
 * True when the text is a `javascript:` address as the browser reads it. A
 * browser removes tabs and line breaks anywhere in an address and ignores
 * leading control characters and spaces, so `java\tscript:` and `\n javascript:`
 * are both `javascript:`.
 */
function isJavascriptUrl(text: string): boolean {
  return /^javascript:/i.test(text.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, ''))
}

/**
 * Replaces CSS escapes with the characters they stand for, so that `u\72 l(`
 * is read as `url(` the way the browser reads it. An escape is a backslash and
 * one to six hexadecimal digits with one optional space after them, or a
 * backslash and any other character. The CSS checks run on the raw text and on
 * this text, because the raw text is what an author sees and the decoded text
 * is what the browser applies. The CSS tokenizer in css-check.ts decodes the
 * same way, but it checks stylesheet text and returns urls rather than
 * answering "does this text load something", so the small decoder is repeated
 * here instead of importing a tokenizer for one regular expression.
 */
function decodeCssEscapes(text: string): string {
  return text.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n])/g, (_match, hex?: string, other?: string) => {
    if (other !== undefined) return other
    const code = parseInt(hex!, 16)
    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code)
  })
}

/**
 * Style properties whose value can load a resource, compared after lowercasing
 * and removing dashes and vendor prefixes, so `backgroundImage`,
 * `background-image` and `-webkit-mask-image` all match. The list is exact
 * rather than a prefix match so that `backgroundColor` and `backgroundSize`,
 * which cannot load anything and are common, are not treated as URL-bearing.
 */
const URL_STYLE_NAMES = new Set([
  'background', 'backgroundimage', 'borderimage', 'borderimagesource', 'content', 'cursor',
  'filter', 'backdropfilter', 'liststyle', 'liststyleimage', 'mask', 'maskimage',
  'maskborder', 'maskbordersource', 'shapeoutside', 'clippath', 'offsetpath',
  'csstext', 'style',
  // SVG paint and marker properties accept `url(#id)` and a full address, and
  // `-webkit-box-reflect` accepts an image address.
  'fill', 'stroke', 'marker', 'markerstart', 'markermid', 'markerend', 'boxreflect',
])
function isUrlBearingStyleName(name: string): boolean {
  return URL_STYLE_NAMES.has(name.toLowerCase().replace(/^-?(webkit|moz)-?/, '').replace(/-/g, ''))
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/**
 * A name the code declares. `sources` lists every value written to it, which
 * is what the numeric and function proofs below inspect. `opaque` is set when
 * the value cannot be traced (a parameter, a destructured name, a loop
 * variable over keys).
 */
interface Binding {
  sources: { value: N | null; op: string; scope: Scope }[]
  opaque: boolean
  functionDeclaration: boolean
  /** The event parameter of a listener on `window` or `document`. */
  docEvent?: boolean
  /** The parameter that holds the position of each item, and the array it counts. */
  indexOf?: { receiver: N; scope: Scope } | undefined
}

class Scope {
  readonly vars = new Map<string, Binding>()
  constructor(readonly parent: Scope | null) {}
  lookup(name: string): Binding | null {
    for (let s: Scope | null = this; s; s = s.parent) {
      const found = s.vars.get(name)
      if (found) return found
    }
    return null
  }
  declare(name: string, opaque: boolean, functionDeclaration = false): Binding {
    let binding = this.vars.get(name)
    if (!binding) {
      binding = { sources: [], opaque, functionDeclaration }
      this.vars.set(name, binding)
    } else {
      binding.opaque ||= opaque
      binding.functionDeclaration ||= functionDeclaration
    }
    return binding
  }
}

/**
 * Declares every name in a binding pattern. A name bound directly by
 * `const x = value` is traceable; one bound through destructuring, a
 * parameter or a loop is not.
 */
function declarePattern(pattern: N | null, scope: Scope, traceable: boolean): void {
  if (!pattern) return
  switch (pattern.type) {
    case 'Identifier':
      scope.declare(pattern['name'], !traceable)
      return
    case 'ObjectPattern':
      for (const prop of pattern['properties'] as N[]) {
        declarePattern(prop.type === 'RestElement' ? prop['argument'] : prop['value'], scope, false)
      }
      return
    case 'ArrayPattern':
      for (const el of pattern['elements'] as (N | null)[]) declarePattern(el, scope, false)
      return
    case 'AssignmentPattern':
      declarePattern(pattern['left'], scope, false)
      return
    case 'RestElement':
      declarePattern(pattern['argument'], scope, false)
      return
  }
}

/** The names a binding pattern introduces. */
function patternNames(pattern: N | null, into: string[] = []): string[] {
  if (!pattern) return into
  switch (pattern.type) {
    case 'Identifier':
      into.push(pattern['name'])
      break
    case 'ObjectPattern':
      for (const prop of pattern['properties'] as N[]) {
        patternNames(prop.type === 'RestElement' ? prop['argument'] : prop['value'], into)
      }
      break
    case 'ArrayPattern':
      for (const el of pattern['elements'] as (N | null)[]) patternNames(el, into)
      break
    case 'AssignmentPattern':
      patternNames(pattern['left'], into)
      break
    case 'RestElement':
      patternNames(pattern['argument'], into)
      break
  }
  return into
}

/** Declares `var` names and function-scope function declarations, without entering nested functions. */
function hoistVars(node: N | null | undefined, scope: Scope): void {
  if (!node || typeof node !== 'object') return
  switch (node.type) {
    case 'VariableDeclaration':
      if (node['kind'] === 'var') {
        for (const d of node['declarations'] as N[]) declarePattern(d['id'], scope, d['id'].type === 'Identifier')
      }
      return
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return
  }
  for (const key of ['body', 'consequent', 'alternate', 'block', 'handler', 'finalizer', 'init', 'left', 'cases', 'test']) {
    const child = node[key]
    if (Array.isArray(child)) child.forEach((c) => hoistVars(c, scope))
    else if (child && typeof child === 'object' && typeof child.type === 'string') hoistVars(child, scope)
  }
}

/** Declares `let`, `const`, class and function names that belong directly to a block. */
function declareLexical(statements: N[], scope: Scope): void {
  for (const stmt of statements) {
    if (stmt.type === 'VariableDeclaration' && stmt['kind'] !== 'var') {
      for (const d of stmt['declarations'] as N[]) declarePattern(d['id'], scope, d['id'].type === 'Identifier')
    } else if (stmt.type === 'ClassDeclaration' && stmt['id']) {
      scope.declare(stmt['id'].name, true)
    } else if (stmt.type === 'FunctionDeclaration' && stmt['id']) {
      scope.declare(stmt['id'].name, false, true)
    }
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export interface AnalysisOutcome {
  findings: StaticFinding[]
  /** Capabilities the code actually uses, derived from the findings. */
  usedCapabilities: Capability[]
  /** True when the source could not be parsed; treated as blocking. */
  parseError?: string
}

export function analyseJavaScript(source: string): AnalysisOutcome {
  let ast: Node
  try {
    ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: true,
    })
  } catch (error) {
    return {
      findings: [
        {
          line: 0,
          column: 0,
          api: '(parse)',
          capability: null,
          severity: 'block',
          explanation: `This code could not be parsed, so it cannot be checked: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      usedCapabilities: [],
      parseError: error instanceof Error ? error.message : String(error),
    }
  }

  const findings: StaticFinding[] = []
  const seen = new Set<string>()
  /** Checks that need every assignment to a name, so they run after the walk. */
  const deferred: (() => void)[] = []
  /** Identifier nodes already accepted as the object of an allowed member access. */
  const acceptedObjects = new Set<N>()
  /** Functions passed directly to `new Promise`, whose first parameter is a function. */
  const promiseExecutors = new Set<N>()
  /** Callback functions given to forEach and its relatives, with the array they walk. */
  const indexCallbacks = new Map<N, { receiver: N; scope: Scope; position: number }>()
  /**
   * Names of members the code defines itself: object-literal keys, class
   * members, and `x.name = ...` assignments. A method the code defines under
   * the name of a built-in one (`querySelectorAll`, `slice`, `forEach`) can
   * return or pass anything, so such a name proves nothing about its result.
   */
  const definedMembers = new Set<string>()
  /** Set when members can be defined under names this check cannot read, which ends every array proof. */
  let dynamicDefinitions = false
  /**
   * Keys that name a member by an expression: `x[k] = v` and `{ [k]: v }`. A
   * number cannot name a method, so a key that is provably a number is
   * ignored; any other can, and sets `dynamicDefinitions` before the proofs run.
   */
  const dynamicKeys: { key: N; scope: Scope }[] = []
  /** Function nodes written out as the listener of `window.addEventListener` or `document.addEventListener`. */
  const docListeners = new Set<N>()
  /** `window.location` nodes accepted as the object of a read of its address. */
  const acceptedLocations = new Set<N>()

  const record = (node: N, rule: Rule) => {
    const line = node.loc ? node.loc.start.line : 0
    const column = node.loc ? node.loc.start.column + 1 : 0
    const key = `${line}:${column}:${rule.api}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({
      line,
      column,
      api: rule.api,
      capability: rule.capability,
      severity: rule.severity,
      explanation: rule.explanation,
    })
  }
  const block = (node: N, api: string, explanation: string) =>
    record(node, { api, capability: null, severity: 'block', explanation })
  const needsNetwork = (node: N, api: string, explanation: string) =>
    record(node, { api, capability: 'network', severity: 'warn', explanation })

  // ----- Proofs about values ------------------------------------------------

  /** True when the expression can only evaluate to a number (or bigint). */
  function isNumeric(expr: N | null, scope: Scope, visiting = new Set<Binding>()): boolean {
    if (!expr) return true
    switch (expr.type) {
      case 'Literal':
        return typeof expr['value'] === 'number' || typeof expr['value'] === 'bigint'
      case 'UnaryExpression':
        return ['+', '-', '~'].includes(expr['operator'])
      case 'UpdateExpression':
        return true
      case 'BinaryExpression': {
        const op = expr['operator'] as string
        if (['-', '*', '/', '%', '**', '&', '|', '^', '<<', '>>', '>>>'].includes(op)) return true
        if (op === '+') {
          return isNumeric(expr['left'], scope, visiting) && isNumeric(expr['right'], scope, visiting)
        }
        return false
      }
      case 'ConditionalExpression':
        return (
          isNumeric(expr['consequent'], scope, visiting) && isNumeric(expr['alternate'], scope, visiting)
        )
      case 'SequenceExpression':
        return isNumeric((expr['expressions'] as N[]).at(-1) ?? null, scope, visiting)
      case 'CallExpression': {
        const callee = expr['callee'] as N
        if (callee.type === 'Identifier') {
          return (
            !scope.lookup(callee['name']) && ['Number', 'parseInt', 'parseFloat'].includes(callee['name'])
          )
        }
        // `tabs.indexOf(x)` is a number when `tabs` is an array. A method of
        // that name defined in this code could return anything.
        if (
          callee.type === 'MemberExpression' &&
          POSITION_METHODS.has(staticName(callee) ?? '') &&
          isArrayLike(callee['object'], scope)
        ) {
          return true
        }
        return (
          callee.type === 'MemberExpression' &&
          callee['computed'] !== true &&
          callee['object'].type === 'Identifier' &&
          callee['object'].name === 'Math' &&
          !scope.lookup('Math')
        )
      }
      case 'Identifier': {
        const binding = scope.lookup(expr['name'])
        if (!binding) return false
        // The index parameter of forEach and its relatives is a number when the
        // receiver is an array. Any other parameter or destructured name is not.
        if (binding.indexOf) {
          if (!isArrayLike(binding.indexOf.receiver, binding.indexOf.scope)) return false
        } else if (binding.opaque) return false
        // A name whose value depends on itself, as in `i = i + 1`, is numeric
        // if every other write to it is, so the cycle is not a reason to refuse.
        if (visiting.has(binding)) return true
        visiting.add(binding)
        const ok = binding.sources.every((src) => {
          // Only the operators that always produce a number may skip the check
          // of the right-hand side. The logical forms `||=`, `&&=` and `??=`
          // assign the right-hand side unchanged, so `k ||= 'constructor'`
          // makes `k` a string, and a `+=` can concatenate text.
          if (VALUE_ASSIGN_OPERATORS.has(src.op)) return isNumeric(src.value, src.scope, visiting)
          return true
        })
        visiting.delete(binding)
        return ok
      }
    }
    return false
  }

  /** True when the expression is a function that is defined in this code. */
  function isFunctionValue(expr: N | null, scope: Scope, visiting = new Set<Binding>()): boolean {
    if (!expr) return false
    if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') return true
    if (expr.type !== 'Identifier') return false
    const binding = scope.lookup(expr['name'])
    if (!binding || binding.opaque || visiting.has(binding)) return false
    if (!binding.functionDeclaration && binding.sources.length === 0) return false
    visiting.add(binding)
    const ok = binding.sources.every(
      (src) => src.op === '=' && isFunctionValue(src.value, src.scope, visiting),
    )
    visiting.delete(binding)
    return ok
  }

  /**
   * True when the expression is an object or array literal whose members are
   * all written out, or a name that holds only such literals.
   */
  function isWrittenOut(expr: N | null, scope: Scope, visiting = new Set<Binding>()): boolean {
    if (!expr) return false
    if (expr.type === 'ObjectExpression' || expr.type === 'ArrayExpression') {
      const members = (expr['properties'] ?? expr['elements']) as (N | null)[]
      return members.every((m) => m === null || (m.type !== 'SpreadElement' && !(m.type === 'Property' && m['computed'] === true)))
    }
    if (expr.type !== 'Identifier') return false
    const binding = scope.lookup(expr['name'])
    if (!binding || binding.opaque || visiting.has(binding) || binding.sources.length === 0) return false
    visiting.add(binding)
    const ok = binding.sources.every((src) => src.op === '=' && isWrittenOut(src.value, src.scope, visiting))
    visiting.delete(binding)
    return ok
  }

  /** True when the object is a name that only ever holds an object literal written in this code. */
  function isPlainObject(expr: N | null, scope: Scope): boolean {
    return holdsOnly(expr, scope, (e) => e.type === 'ObjectExpression')
  }

  /**
   * True when the expression satisfies `matches`, or is a name that every write
   * to it satisfies. Used to show what an object is, from where it came.
   */
  function holdsOnly(
    expr: N | null,
    scope: Scope,
    matches: (expr: N, scope: Scope) => boolean,
    visiting = new Set<Binding>(),
  ): boolean {
    if (!expr) return false
    if (matches(expr, scope)) return true
    if (expr.type !== 'Identifier') return false
    const binding = scope.lookup(expr['name'])
    if (!binding || binding.opaque || visiting.has(binding) || binding.sources.length === 0) return false
    visiting.add(binding)
    const ok = binding.sources.every((src) => src.op === '=' && holdsOnly(src.value, src.scope, matches, visiting))
    visiting.delete(binding)
    return ok
  }

  /**
   * True when the expression is provably an array or a list of nodes, so that
   * the position it passes to a callback, or returns from indexOf, is a number.
   * It is an array literal, a result of `Array.from`, `Object.keys` and the
   * like, a DOM list method, or an array method applied to one of these, or a
   * name that only holds such values. A method whose name the code defines
   * itself is not trusted, because the code can make it return anything.
   */
  function isArrayLike(expr: N | null, scope: Scope): boolean {
    if (dynamicDefinitions) return false
    return holdsOnly(expr, scope, (e, sc) => {
      if (e.type === 'ArrayExpression') return true
      if (e.type !== 'CallExpression' || e['callee'].type !== 'MemberExpression') return false
      const callee = e['callee'] as N
      const name = staticName(callee)
      if (name === null || definedMembers.has(name)) return false
      const object = callee['object'] as N
      const named = object.type === 'Identifier' && !sc.lookup(object['name']) ? (object['name'] as string) : null
      if (named === 'Array' && (name === 'from' || name === 'of')) return true
      if (named === 'Object' && ['keys', 'values', 'entries'].includes(name)) return true
      if (LIST_METHODS.has(name)) return true
      return CHAIN_METHODS.has(name) && isArrayLike(object, sc)
    })
  }

  /** `x.style`, the object of a style write. */
  function isStyleMember(expr: N): boolean {
    return expr.type === 'MemberExpression' && staticName(expr) === 'style'
  }

  /** `new URL(...)`, which loads nothing. */
  function isNewUrl(expr: N, scope: Scope): boolean {
    return (
      expr.type === 'NewExpression' &&
      expr['callee'].type === 'Identifier' &&
      expr['callee'].name === 'URL' &&
      !scope.lookup('URL')
    )
  }

  /** A text node or comment made in this code, which holds text and not an address. */
  function isTextNodeMaker(expr: N, scope: Scope): boolean {
    if (expr.type === 'NewExpression') {
      return expr['callee'].type === 'Identifier' && expr['callee'].name === 'Text' && !scope.lookup('Text')
    }
    return (
      expr.type === 'CallExpression' &&
      expr['callee'].type === 'MemberExpression' &&
      ['createTextNode', 'createComment'].includes(staticName(expr['callee']) ?? '')
    )
  }

  /**
   * The start of every text a string expression can have, when it is written
   * out: the whole text of a literal, the first part of a template, and the
   * left operand of a `+`. Null when any part is not written out.
   */
  function leadingTexts(expr: N | null): string[] | null {
    if (!expr) return null
    if (expr.type === 'Literal') return typeof expr['value'] === 'string' ? [expr['value']] : null
    if (expr.type === 'TemplateLiteral') return [((expr['quasis'] as N[])[0] as N)['value'].cooked ?? '']
    if (expr.type === 'ConditionalExpression') {
      const yes = leadingTexts(expr['consequent'])
      const no = leadingTexts(expr['alternate'])
      return yes && no ? [...yes, ...no] : null
    }
    if (expr.type === 'BinaryExpression' && expr['operator'] === '+') return leadingTexts(expr['left'])
    return null
  }

  /**
   * True when an address value cannot be a `javascript:` URL: it is written out
   * in full and is not one, or its written-out start is `https://`, `http://`,
   * `/`, `#`, `?` or a relative path. An address built from a variable could be
   * `'java' + 'script:...'`, which runs code when followed, so it is not proved.
   */
  function provablyNotJavascript(expr: N | null): boolean {
    if (!expr) return false
    const full = literalTexts(expr)
    if (full) return full.every((text) => !isJavascriptUrl(text))
    const start = leadingTexts(expr)
    return start !== null && start.every((text) => SAFE_URL_START.test(text))
  }

  /**
   * Every text a string expression can have when it is made only of literals,
   * conditionals between literals and `+` between them, or null when any part
   * is not written out.
   */
  function literalTexts(expr: N | null): string[] | null {
    if (!expr) return null
    if (expr.type === 'Literal') return typeof expr['value'] === 'string' ? [expr['value']] : null
    if (expr.type === 'TemplateLiteral' && (expr['expressions'] as N[]).length === 0) {
      return [(expr['quasis'] as N[]).map((q) => q['value'].cooked ?? '').join('')]
    }
    if (expr.type === 'ConditionalExpression') {
      const yes = literalTexts(expr['consequent'])
      const no = literalTexts(expr['alternate'])
      return yes && no ? [...yes, ...no] : null
    }
    if (expr.type === 'BinaryExpression' && expr['operator'] === '+') {
      const left = literalTexts(expr['left'])
      const right = literalTexts(expr['right'])
      return left && right ? left.flatMap((l) => right.map((r) => l + r)) : null
    }
    return null
  }

  /**
   * Every text a string expression can have when each part is written out, is
   * a name that only holds such text, or is provably a number. A number is
   * stood for by "0": it can add digits, a sign, a point and an exponent, none
   * of which can complete `url(`, `@import` or `var(`, and the digits break any
   * such word that they would sit inside. Null when any part is anything else,
   * or when the combinations are too many to list.
   */
  function possibleTexts(expr: N | null, scope: Scope, visiting = new Set<Binding>()): string[] | null {
    if (!expr) return null
    if (expr.type === 'Literal' && typeof expr['value'] === 'string') return [expr['value']]
    if (isNumeric(expr, scope)) return ['0']
    const combine = (parts: (string[] | null)[]): string[] | null => {
      let out = ['']
      for (const part of parts) {
        if (part === null) return null
        out = out.flatMap((head) => part.map((tail) => head + tail))
        if (out.length > 256) return null
      }
      return out
    }
    switch (expr.type) {
      case 'TemplateLiteral': {
        const quasis = expr['quasis'] as N[]
        const expressions = expr['expressions'] as N[]
        const parts: (string[] | null)[] = []
        quasis.forEach((q, i) => {
          parts.push([q['value'].cooked ?? ''])
          if (i < expressions.length) parts.push(possibleTexts(expressions[i]!, scope, visiting))
        })
        return combine(parts)
      }
      case 'ConditionalExpression': {
        const yes = possibleTexts(expr['consequent'], scope, visiting)
        const no = possibleTexts(expr['alternate'], scope, visiting)
        return yes && no ? [...yes, ...no] : null
      }
      case 'BinaryExpression':
        return expr['operator'] === '+'
          ? combine([possibleTexts(expr['left'], scope, visiting), possibleTexts(expr['right'], scope, visiting)])
          : null
      case 'Identifier': {
        const binding = scope.lookup(expr['name'])
        if (!binding || binding.opaque || visiting.has(binding) || binding.sources.length === 0) return null
        visiting.add(binding)
        const all: string[] = []
        let ok = true
        for (const src of binding.sources) {
          // A compound assignment builds a new text from the old one, which
          // this does not follow, so it ends the proof.
          const texts = src.op === '=' ? possibleTexts(src.value, src.scope, visiting) : null
          if (texts === null) {
            ok = false
            break
          }
          all.push(...texts)
        }
        visiting.delete(binding)
        return ok ? all : null
      }
    }
    return null
  }

  /** The text of a string expression with exactly one possible value, or null. */
  function literalText(expr: N | null): string | null {
    const all = literalTexts(expr)
    return all && all.length === 1 ? all[0]! : null
  }

  /**
   * The property name of a member access when it is written out, as in
   * `a.b`, `a['b']` or a template with no substitutions. Null when computed.
   */
  function staticName(member: N): string | null {
    if (member['computed'] !== true) {
      return member['property'].type === 'Identifier' ? member['property'].name : null
    }
    const prop = member['property'] as N
    if (prop.type === 'Literal' && (typeof prop['value'] === 'string' || typeof prop['value'] === 'number')) {
      return String(prop['value'])
    }
    return literalText(prop)
  }

  // ----- Rules on names -----------------------------------------------------

  /** Rules that depend only on a property name, whatever object it is read from. */
  function checkName(name: string, node: N, callee: boolean): void {
    const capability = CAPABILITY_NAMES.get(name)
    if (capability) record(node, capability)
    const code = CODE_FROM_STRING.get(name)
    if (code) block(node, name, code)
    const reason = DENIED_NAMES.get(name)
    if (reason) block(node, name, reason)
    else if (/^__.*__$/.test(name)) {
      block(node, name, 'Reaches the prototype chain, which can produce the Function constructor and run code built from text.')
    }
    if (CALL_ONLY.has(name) && !callee) {
      block(
        node,
        name,
        `Uses ${name} without calling it directly, so this check cannot see the arguments it is given.`,
      )
    }
  }

  /** Checks a string that appears in the code, wherever it is used. */
  function checkText(node: N, raw: string): void {
    const decoded = decodeCssEscapes(raw)
    for (const text of decoded === raw ? [raw] : [raw, decoded]) checkOneText(node, text)
  }

  function checkOneText(node: N, text: string): void {
    if (CSS_LOADING_TEXT.test(text)) {
      needsNetwork(node, 'url()', 'Contains style text that makes the browser request an address.')
    }
    if (isJavascriptUrl(text)) {
      block(node, 'javascript:', 'Contains an address that runs code when it is followed.')
    }
  }

  interface WriteOptions {
    /** `+=`: the value is added to what is there, so it proves nothing about the result. */
    append?: boolean
    /** The object the property is written on, when the code names it. */
    object?: N | null
    /** The write is to a style, as `setProperty` and keyframes are. */
    style?: boolean
  }

  /**
   * Checks the value written to a property or style. A property that carries a
   * URL requests it; a style property that can carry a URL is accepted only
   * with a literal value that does not contain one.
   */
  function checkWrite(target: N, name: string, value: N | null, scope: Scope, options: WriteOptions = {}): void {
    const append = options.append === true
    const object = options.object ?? null
    const onStyle = options.style === true

    const refused = WRITE_REFUSED.get(name)
    if (refused) {
      // A plain object written in this code is not an element, so `state.text`
      // is only a field. The object is known only after the walk.
      deferred.push(() => {
        if (!isPlainObject(object, scope)) block(target, name, refused)
      })
    }
    if (WRITE_URL.has(name)) {
      deferred.push(() => {
        // `background` is also a style, and `style.background = 'red'` is the
        // style property, handled below. On an element it is the obsolete
        // attribute that loads an image.
        if (name === 'background' && (onStyle || holdsOnly(object, scope, isStyleMember))) return
        needsNetwork(target, name, 'Sets an address on an element, which makes the browser request it or follow it.')
        // Network use is declared for an address, but `javascript:` is code and
        // is refused whatever is declared. An address that is not written out
        // could be one, so it is accepted only when its start is.
        if (append || !provablyNotJavascript(value)) {
          // A different api name from the network finding above: findings at the
          // same position with the same name are merged, and the merge kept the
          // warning that a declared capability unlocks.
          block(target, `${name} (javascript: address)`, 'Sets an address that is not written out, or does not start with https://, http:// or a path, so this check cannot tell that it is not a javascript: address, which runs code.')
        }
      })
    }
    if (ADDRESS_PARTS.has(name) || name === DATA_PROPERTY) {
      // Resolved after the walk, because it depends on what the object holds.
      deferred.push(() => {
        const part = ADDRESS_PARTS.has(name)
        if (isPlainObject(object, scope)) return
        if (part && holdsOnly(object, scope, isNewUrl)) return
        if (!part && holdsOnly(object, scope, isTextNodeMaker)) return
        needsNetwork(
          target,
          name,
          part
            ? 'Sets part of an address, which changes where a link or form goes.'
            : 'Sets data, which is an address on an object element and text on a text node, and this check cannot tell which this is.',
        )
        if (!part && (append || !provablyNotJavascript(value))) {
          block(target, `${name} (javascript: address)`, 'Sets data to a value that is not written out, or does not start with https://, http:// or a path, so this check cannot tell that it is not a javascript: address.')
        }
      })
    }

    const isStyle = isUrlBearingStyleName(name)
    const isCustom = name.startsWith('--')
    if (!isStyle && !isCustom && !value) return
    // The values this write can set, known only after the walk because a value
    // may be a name that is assigned later.
    deferred.push(() => {
      // `+=` appends to a value that may already hold part of an address, so
      // the right-hand side alone proves nothing about the result.
      const texts = append ? null : possibleTexts(value, scope)
      // Every text the value can take is checked, so a name that holds
      // 'ur' + 'l(' in two parts, or a condition between two texts, is read
      // the way the browser will read the result.
      if (texts) for (const text of texts) checkText(target, text)
      else {
        const written = literalTexts(value)
        if (written) for (const text of written) checkText(target, text)
      }

      if (isStyle) {
        if (texts === null) {
          needsNetwork(target, name, 'Sets a style that can load an address, and the value is not written out, so this check cannot tell.')
        } else if (texts.some((text) => CSS_INDIRECT.test(text) || CSS_INDIRECT.test(decodeCssEscapes(text)))) {
          needsNetwork(target, name, 'Sets a style from a variable that can hold an address, so this check cannot tell what it loads.')
        }
      } else if (isCustom && texts === null && !isNumeric(value, scope)) {
        // A custom property can hold an address that a later rule uses. A
        // number cannot, so a computed number is accepted and anything else is not.
        needsNetwork(target, name, 'Sets a custom style property to a value that is not written out, so this check cannot tell whether it holds an address.')
      }
    })
  }

  // ----- The walk -----------------------------------------------------------

  type Context = {
    scope: Scope
    thisOk: boolean
    /** Inside a listener attached to `window` or `document`, including its nested functions. */
    inDocListener?: boolean
  }

  function visitAll(nodes: (N | null | undefined)[], ctx: Context, parent: N | null): void {
    for (const n of nodes) if (n) visit(n, ctx, parent)
  }

  function visitFunction(fn: N, ctx: Context, parent: N | null): void {
    const scope = new Scope(ctx.scope)
    if (fn.type === 'FunctionExpression' && fn['id']) scope.declare(fn['id'].name, true)
    // `this` is the object only in a class method or an object-literal method.
    // In any other non-arrow function it is whatever the caller supplies: the
    // window for a timer callback, and the window or the document for a
    // function heard by a listener on one of them. Those are the objects this
    // check keeps out of the code's reach, so `this` there is refused.
    const isMethod =
      parent?.type === 'MethodDefinition' ||
      (parent?.type === 'Property' &&
        (parent['method'] === true || parent['kind'] === 'get' || parent['kind'] === 'set'))
    const listener = docListeners.has(fn)
    const inner: Context = {
      scope,
      thisOk: fn.type === 'ArrowFunctionExpression' ? ctx.thisOk : isMethod,
      inDocListener: ctx.inDocListener || listener,
    }
    for (const param of fn['params'] as N[]) declarePattern(param, scope, false)
    const counted = indexCallbacks.get(fn)
    if (counted) {
      const param = (fn['params'] as N[])[counted.position]
      if (param?.type === 'Identifier') {
        scope.vars.get(param['name'])!.indexOf = { receiver: counted.receiver, scope: counted.scope }
      }
    }
    if (listener) {
      const first = (fn['params'] as N[])[0]
      if (first?.type === 'Identifier') scope.vars.get(first['name'])!.docEvent = true
      else if (first) {
        block(first, 'event parameter', 'Takes the event of a window or document listener as something other than a plain name, so this check cannot follow where its target goes.')
      }
    }
    if (promiseExecutors.has(fn)) {
      // `new Promise((resolve) => setTimeout(resolve, 100))` is the usual way to
      // wait, and `resolve` is always a function there.
      const first = (fn['params'] as N[])[0]
      const binding = first?.type === 'Identifier' ? scope.vars.get(first['name']) : undefined
      if (binding) {
        binding.opaque = false
        binding.sources.push({ value: fn, op: '=', scope: ctx.scope })
      }
    }
    for (const param of fn['params'] as N[]) visitPattern(param, inner, 'binding')
    const body = fn['body'] as N
    if (body.type === 'BlockStatement') {
      hoistVars(body, scope)
      declareLexical(body['body'], scope)
      visitAll(body['body'], inner, body)
    } else {
      visit(body, inner, fn)
    }
  }

  /** Visits a destructuring or assignment target. */
  function visitPattern(pattern: N | null, ctx: Context, mode: 'binding' | 'assign'): void {
    if (!pattern) return
    switch (pattern.type) {
      case 'Identifier':
        if (mode === 'assign') {
          const binding = ctx.scope.lookup(pattern['name'])
          if (binding) {
            binding.opaque = true
            // Assigned from a destructuring or a loop: no longer the position.
            binding.indexOf = undefined
          } else visit(pattern, ctx, pattern)
        }
        return
      case 'MemberExpression':
        visit(pattern, ctx, pattern)
        {
          const name = staticName(pattern)
          if (name !== null) checkWrite(pattern, name, null, ctx.scope, { object: pattern['object'] })
        }
        return
      case 'ObjectPattern':
        for (const prop of pattern['properties'] as N[]) {
          if (prop.type === 'RestElement') {
            visitPattern(prop['argument'], ctx, mode)
            continue
          }
          if (prop['computed'] === true) {
            const key = literalText(prop['key']) ?? (prop['key'].type === 'Literal' ? String(prop['key'].value) : null)
            if (key === null) {
              block(prop, '(dynamic property access)', 'Reads a property whose name is decided while running, so this check cannot tell what it accesses.')
              visit(prop['key'], ctx, prop)
            } else checkName(key, prop, false)
          } else {
            const key = prop['key'] as N
            const name = key.type === 'Identifier' ? key['name'] : String(key['value'])
            checkEventName(name, key, ctx)
            checkName(name, key, false)
          }
          visitPattern(prop['value'], ctx, mode)
        }
        return
      case 'ArrayPattern':
        for (const el of pattern['elements'] as (N | null)[]) visitPattern(el, ctx, mode)
        return
      case 'AssignmentPattern':
        visitPattern(pattern['left'], ctx, mode)
        visit(pattern['right'], ctx, pattern)
        return
      case 'RestElement':
        visitPattern(pattern['argument'], ctx, mode)
        return
    }
    visit(pattern, ctx, pattern)
  }

  function visitMember(node: N, ctx: Context, parent: N | null): void {
    const object = node['object'] as N
    const property = node['property'] as N
    const isCallee = parent?.type === 'CallExpression' && parent['callee'] === node
    const name = staticName(node)

    // `window.location` is accepted only as the object of a read of one of its
    // address properties (see below), and then needs no further check.
    if (acceptedLocations.has(node)) return

    // Reading the address of the page is harmless: it gives text and nothing
    // that can navigate. `location` as a value, any write to it, and every
    // other member are still refused, because each can navigate or send data.
    const base = locationBase(object, ctx)
    if (
      base !== null &&
      name !== null &&
      LOCATION_READS.has(name) &&
      !isCallee &&
      parent !== node &&
      !(parent?.type === 'AssignmentExpression' && parent['left'] === node) &&
      !(parent?.type === 'UpdateExpression') &&
      !(parent?.type === 'UnaryExpression' && parent['operator'] === 'delete') &&
      !((parent?.type === 'ForInStatement' || parent?.type === 'ForOfStatement') && parent['left'] === node)
    ) {
      if (base === 'bare') acceptedObjects.add(object)
      else {
        acceptedLocations.add(object)
        acceptedObjects.add(object['object'])
      }
    }

    // `document`, `window` and `navigator` are accepted only here, as the
    // object of a member access to a member on their list.
    if (object.type === 'Identifier' && !ctx.scope.lookup(object['name'])) {
      const members =
        object['name'] === 'document' ? DOCUMENT_MEMBERS
        : object['name'] === 'window' ? WINDOW_MEMBERS
        : object['name'] === 'navigator' ? NAVIGATOR_MEMBERS
        : null
      if (members) {
        acceptedObjects.add(object)
        if (name === null) {
          block(node, '(dynamic property access)', 'Reads a property whose name is decided while running, so this check cannot tell what it accesses.')
        } else if (!members.has(name) && !CAPABILITY_NAMES.has(name)) {
          block(
            node,
            `${object['name']}.${name}`,
            `Uses ${object['name']}.${name}, which is not on the list of things a page transform may use.`,
          )
        }
      }
    }

    // `Object` is accepted only as the object of a member access or as a
    // callee (see visitIdentifier), because an alias such as `const O = Object`
    // would carry it past the checks that look for `Object.assign` and
    // `Object.entries` by their written form.
    if (object.type === 'Identifier' && object['name'] === 'Object' && !ctx.scope.lookup('Object')) {
      acceptedObjects.add(object)
      if (name !== null && OBJECT_ENUMERATORS.has(name) && !isCallee) {
        block(node, `Object.${name}`, `Uses Object.${name} without calling it directly, so this check cannot see the value it is given.`)
      }
    }

    if (object.type !== 'Super') visit(object, ctx, node)

    if (node['computed'] === true) {
      visit(property, ctx, node)
      if (name === null) {
        deferred.push(() => {
          if (!isNumeric(property, ctx.scope)) {
            block(
              node,
              '(dynamic property access)',
              'Reads a property whose name is decided while running, so this check cannot tell what it accesses.',
            )
          }
        })
      }
    }
    if (name !== null) {
      checkEventName(name, node, ctx)
      // Two names are refused wherever they are read but are ordinary when
      // used in the one way that cannot hand out the window or the document.
      // `open` is also a property of `details` and `dialog`, and writing it
      // with `=` reads nothing back. `parentNode` is common in `parent.removeChild(el)`.
      const writtenOnly = parent?.type === 'AssignmentExpression' && parent['left'] === node && parent['operator'] === '='
      const usedAtOnce =
        parent?.type === 'MemberExpression' &&
        parent['object'] === node &&
        parent['computed'] !== true &&
        parent['property'].type === 'Identifier' &&
        PARENT_NODE_USES.has(parent['property'].name)
      if (!((name === 'open' && writtenOnly) || (name === 'parentNode' && usedAtOnce))) {
        checkName(name, node, isCallee)
      }
    }
  }

  /** Refuses the event properties that can name the window or the document, inside a listener on either. */
  function checkEventName(name: string, node: N, ctx: Context): void {
    if (ctx.inDocListener && EVENT_TARGET_NAMES.has(name)) {
      block(
        node,
        name,
        'Reads which object an event was sent to, inside a listener on the window or the document, where it can be the window or the document itself.',
      )
    }
  }

  /** Whether an object is `location`, or `window.location`, as free names. */
  function locationBase(object: N, ctx: Context): 'bare' | 'window' | null {
    if (object.type === 'Identifier' && object['name'] === 'location' && !ctx.scope.lookup('location')) return 'bare'
    if (
      object.type === 'MemberExpression' &&
      staticName(object) === 'location' &&
      object['object'].type === 'Identifier' &&
      object['object'].name === 'window' &&
      !ctx.scope.lookup('window')
    ) {
      return 'window'
    }
    return null
  }

  function visitCall(node: N, ctx: Context): void {
    const callee = node['callee'] as N
    const args = node['arguments'] as N[]

    let calleeName: string | null = null
    if (callee.type === 'Identifier' && !ctx.scope.lookup(callee['name'])) calleeName = callee['name']
    else if (callee.type === 'MemberExpression') calleeName = staticName(callee)

    if (calleeName !== null && TIMERS.has(calleeName)) {
      const first = args[0] ?? null
      deferred.push(() => {
        if (!isFunctionValue(first, ctx.scope)) {
          block(
            node,
            `${calleeName}(string)`,
            'Passes something other than a function written in this code to a timer. A text argument runs as code, which cannot be reviewed before it executes.',
          )
        }
      })
    }

    if (
      calleeName === 'addEventListener' &&
      callee.type === 'MemberExpression' &&
      callee['object'].type === 'Identifier' &&
      (callee['object'].name === 'window' || callee['object'].name === 'document') &&
      !ctx.scope.lookup(callee['object'].name)
    ) {
      // The event heard here can name the window or the document, so the
      // listener must be written out where its parameter can be followed.
      const listener = args[1]
      if (listener && (listener.type === 'ArrowFunctionExpression' || listener.type === 'FunctionExpression')) {
        docListeners.add(listener)
      } else {
        block(
          node,
          `${callee['object'].name}.addEventListener`,
          `Gives ${callee['object'].name}.addEventListener something other than a function written out in this code, so this check cannot follow the event it receives.`,
        )
      }
    }

    if (callee.type === 'MemberExpression' && calleeName !== null) {
      checkMethodCall(node, callee, calleeName, args, ctx)
    }
    const position = calleeName === null ? undefined : INDEX_PARAMETER.get(calleeName)
    const callback = args[0]
    if (
      position !== undefined &&
      callee.type === 'MemberExpression' &&
      callback &&
      (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression')
    ) {
      indexCallbacks.set(callback, { receiver: callee['object'], scope: ctx.scope, position })
    }
    if (calleeName === 'open') {
      block(node, 'open', 'Opens a new window or document, which can send page data to another site.')
    }

    visit(callee, ctx, node)
    visitAll(args, ctx, node)
  }

  /**
   * Checks the keyframes given to `element.animate`. Each property of a
   * keyframe sets a style, so it is checked as a style write; keyframes that
   * are not written out cannot be checked and are refused.
   */
  function checkKeyframes(node: N, keyframes: N | null, scope: Scope): void {
    const notWritten = () =>
      block(node, 'animate', 'Animates keyframes that are not written out in this code, so this check cannot tell which styles they set, and a style can load an address.')
    const checkFrame = (frame: N) => {
      if (frame.type !== 'ObjectExpression') return notWritten()
      for (const prop of frame['properties'] as N[]) {
        if (prop.type !== 'Property' || prop['computed'] === true) return notWritten()
        const key = prop['key'].type === 'Identifier' ? prop['key'].name : String(prop['key'].value)
        checkName(key, prop, false)
        // The property form gives a list of values for one style.
        const values = prop['value'].type === 'ArrayExpression' ? (prop['value']['elements'] as (N | null)[]) : [prop['value']]
        for (const value of values) {
          if (!value || value.type === 'SpreadElement') return notWritten()
          checkWrite(prop, key, value, scope, { style: true })
        }
      }
    }
    if (keyframes?.type === 'ArrayExpression') {
      for (const frame of keyframes['elements'] as (N | null)[]) {
        if (!frame) continue
        checkFrame(frame)
      }
    } else if (keyframes?.type === 'ObjectExpression') checkFrame(keyframes)
    else notWritten()
  }

  /** Checks calls to the methods that create elements or set attributes and styles. */
  function checkMethodCall(node: N, callee: N, name: string, args: N[], ctx: Context): void {
    if (name === 'createElement') {
      const tag = literalText(args[0] ?? null)
      if (tag === null) {
        block(node, 'createElement', 'Creates an element whose type is decided while running, so this check cannot tell whether it loads or runs anything.')
      } else {
        const lower = tag.toLowerCase()
        if (LOADING_TAGS.has(lower)) {
          needsNetwork(node, `createElement(${lower})`, 'Creates an element that requests an address.')
        } else if (!INERT_TAGS.has(lower)) {
          block(node, `createElement(${lower})`, `Creates a ${lower} element, which can load or run content or send data.`)
        }
      }
    } else if (name === 'setAttribute' || name === 'toggleAttribute') {
      // toggleAttribute creates or removes an attribute by name, so it can set
      // `onclick` or `href` exactly as setAttribute can.
      const attr = literalText(args[0] ?? null)
      if (attr === null) {
        block(node, name, 'Sets an attribute whose name is decided while running, so this check cannot tell whether it carries an address or code.')
      } else {
        const lower = attr.toLowerCase()
        if (lower.startsWith('on')) {
          block(node, `${name}(${lower})`, 'Sets an event handler attribute, which runs text as code.')
        } else if (lower === 'srcdoc') {
          block(node, `${name}(srcdoc)`, 'Sets the page inside a frame from a text string, which can run content.')
        } else if (ATTRIBUTE_URL.has(lower)) {
          needsNetwork(node, `${name}(${lower})`, 'Sets an address on an element, which makes the browser request it or follow it.')
          if (name === 'setAttribute' && !provablyNotJavascript(args[1] ?? null)) {
            block(node, `setAttribute(${lower}) (javascript: address)`, 'Sets an address that is not written out, or does not start with https://, http:// or a path, so this check cannot tell that it is not a javascript: address, which runs code.')
          }
        } else if (lower === 'http-equiv') {
          block(node, `${name}(http-equiv)`, 'Redirects the page from a meta element.')
        } else if (name === 'setAttribute' && isUrlBearingStyleName(lower)) {
          checkWrite(node, lower, args[1] ?? null, ctx.scope, { style: true })
        }
      }
    } else if (name === 'setProperty') {
      const prop = literalText(args[0] ?? null)
      if (prop === null) {
        block(node, 'setProperty', 'Sets a style whose name is decided while running, so this check cannot tell whether it can load an address.')
      } else {
        checkWrite(node, prop, args[1] ?? null, ctx.scope, { style: true })
      }
    } else if (
      name === 'assign' &&
      callee['object'].type === 'Identifier' &&
      callee['object'].name === 'Object'
    ) {
      // Object.assign(el, { src }) is an assignment written as a call, so the
      // keys of each source are checked like assignments. A fresh `{}` target
      // is plain data and needs no check.
      const target = args[0]
      const fresh = target?.type === 'ObjectExpression' && (target['properties'] as N[]).length === 0
      if (!fresh) {
        for (const source of args.slice(1)) {
          if (source.type !== 'ObjectExpression') {
            block(node, 'Object.assign', 'Copies properties from a value whose names are not written out, so this check cannot tell which properties it sets.')
            continue
          }
          for (const prop of source['properties'] as N[]) {
            const key = prop.type === 'Property' && prop['computed'] !== true
              ? prop['key'].type === 'Identifier' ? prop['key'].name : String(prop['key'].value)
              : null
            if (key === null) {
              block(prop, 'Object.assign', 'Copies properties whose names are not written out, so this check cannot tell which properties it sets.')
            } else {
              checkName(key, prop, false)
              checkWrite(prop, key, prop['value'], ctx.scope, { object: target ?? null })
            }
          }
        }
      }
    }

    if (name === 'animate') checkKeyframes(node, args[0] ?? null, ctx.scope)
    // These build an object whose member names come from data, so a method
    // under any name can exist afterwards.
    if (
      (name === 'fromEntries' || name === 'create') &&
      callee['object'].type === 'Identifier' &&
      callee['object'].name === 'Object'
    ) {
      dynamicDefinitions = true
    }

    if (
      OBJECT_ENUMERATORS.has(name) &&
      callee['object'].type === 'Identifier' &&
      callee['object'].name === 'Object' &&
      !ctx.scope.lookup('Object')
    ) {
      // The names a value has are the way to find a member without writing its
      // name, as `Object.entries(window)` does. Listing a value written out in
      // this code reveals nothing the code does not already say.
      const arg = args[0] ?? null
      deferred.push(() => {
        if (!isWrittenOut(arg, ctx.scope)) {
          block(node, `Object.${name}`, `Lists the names of a value that is not written out in this code, which can find members this check refuses by name.`)
        }
      })
    }

    if (SELECTOR_METHODS.has(name)) {
      const selector = literalText(args[SELECTOR_METHODS.get(name)!] ?? null)
      // The tag name is matched in the position where a type selector can
      // stand, so `[style*="width"]` and `.script` do not match.
      const tag = selector === null ? null : /(?:^|[\s,>+~(])(script|style)(?![\w-])(?!\s*[*^$~|]?=)/i.exec(selector)
      if (tag) {
        block(
          node,
          `${name}(${tag[1]!.toLowerCase()})`,
          'Selects a script or style element. Their text can be rewritten to run code or to load an address, and this check cannot see what is written, so they are not available to a page transform.',
        )
      }
    }
  }

  function visitIdentifier(node: N, ctx: Context, parent: N | null): void {
    const name = node['name'] as string
    const declared = ctx.scope.lookup(name)
    if (declared) {
      // The event of a window or document listener is used only through a
      // member access. Copying it, passing it on or destructuring it would
      // carry its target out of the listener, where the target names below
      // are no longer checked.
      if (declared.docEvent && !(parent?.type === 'MemberExpression' && parent['object'] === node)) {
        block(node, name, 'Uses the event of a window or document listener as a value. Only direct reads such as event.key are allowed, because its target can be the window or the document.')
      }
      return
    }
    if (acceptedObjects.has(node)) return
    if (name === 'arguments' && ctx.inDocListener) {
      return block(node, name, 'Reads the arguments of a window or document listener, which include its event, so this check cannot follow where the event target goes.')
    }
    if (name === 'Object') {
      const asCallee =
        ((parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && parent['callee'] === node) ||
        (parent?.type === 'BinaryExpression' && parent['operator'] === 'instanceof' && parent['right'] === node)
      if (!asCallee) {
        block(node, name, 'Uses Object as a value. Only direct uses such as Object.assign and Object.keys are allowed, because a copy hides which method is later called.')
      }
      return
    }

    const capability = CAPABILITY_NAMES.get(name)
    if (capability) return record(node, capability)
    const code = CODE_FROM_STRING.get(name)
    if (code) return block(node, name, code)
    const refused = REFUSED_GLOBALS.get(name)
    if (refused) return block(node, name, refused)
    if (TIMERS.has(name)) {
      if (!(parent?.type === 'CallExpression' && parent['callee'] === node)) {
        block(node, name, `Uses ${name} without calling it directly, so this check cannot see the arguments it is given.`)
      }
      return
    }
    if (ALLOWED_GLOBALS.has(name) || ELEMENT_CLASS.test(name)) return
    block(
      node,
      name,
      `Uses ${name}, which is not on the list of browser features a page transform may use, so this check cannot tell what it does.`,
    )
  }

  function visit(node: N, ctx: Context, parent: N | null): void {
    switch (node.type) {
      case 'Identifier':
        return visitIdentifier(node, ctx, parent)

      case 'ThisExpression':
        if (!ctx.thisOk) {
          block(node, 'this', 'Uses `this` outside a function, where it is the page global object, which can reach any browser feature.')
        }
        return

      case 'MemberExpression':
        return visitMember(node, ctx, parent)

      case 'CallExpression':
        return visitCall(node, ctx)

      case 'NewExpression': {
        const callee = node['callee'] as N
        const first = (node['arguments'] as N[])[0]
        if (
          callee.type === 'Identifier' &&
          callee['name'] === 'Promise' &&
          !ctx.scope.lookup('Promise') &&
          first &&
          (first.type === 'ArrowFunctionExpression' || first.type === 'FunctionExpression')
        ) {
          promiseExecutors.add(first)
        }
        visit(callee, ctx, node)
        visitAll(node['arguments'], ctx, node)
        return
      }

      case 'ImportExpression':
        block(node, 'import()', 'Loads and runs code from another location, which is never allowed.')
        return

      case 'WithStatement':
        block(node, 'with', 'Makes names resolve against an object chosen while running, so this check cannot tell what they refer to.')
        return

      case 'Literal':
        if (typeof node['value'] === 'string') checkText(node, node['value'])
        return

      case 'TemplateLiteral':
        for (const q of node['quasis'] as N[]) checkText(q, q['value'].cooked ?? q['value'].raw)
        visitAll(node['expressions'], ctx, node)
        return

      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return visitFunction(node, ctx, parent)

      case 'Program':
      case 'BlockStatement':
      case 'StaticBlock': {
        const scope = node.type === 'Program' ? ctx.scope : new Scope(ctx.scope)
        const inner: Context = { ...ctx, scope, thisOk: node.type === 'StaticBlock' ? true : ctx.thisOk }
        if (node.type === 'Program' || node.type === 'StaticBlock') hoistVars(node, scope)
        declareLexical(node['body'], scope)
        return visitAll(node['body'], inner, node)
      }

      case 'SwitchStatement': {
        visit(node['discriminant'], ctx, node)
        const scope = new Scope(ctx.scope)
        const inner: Context = { ...ctx, scope }
        declareLexical((node['cases'] as N[]).flatMap((c) => c['consequent'] as N[]), scope)
        for (const c of node['cases'] as N[]) {
          if (c['test']) visit(c['test'], inner, c)
          visitAll(c['consequent'], inner, c)
        }
        return
      }

      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const scope = new Scope(ctx.scope)
        const inner: Context = { ...ctx, scope }
        const head = (node['init'] ?? node['left']) as N | null
        const isLoopOverValues = node.type !== 'ForStatement'
        if (head?.type === 'VariableDeclaration') {
          if (head['kind'] !== 'var') {
            for (const d of head['declarations'] as N[]) {
              declarePattern(d['id'], scope, !isLoopOverValues && d['id'].type === 'Identifier')
            }
          } else if (isLoopOverValues) {
            // `var` was hoisted to the function scope as traceable; a loop over
            // values or keys assigns something this check cannot trace.
            for (const d of head['declarations'] as N[]) {
              for (const n of patternNames(d['id'])) {
                const found = ctx.scope.lookup(n)
                if (found) found.opaque = true
              }
            }
          }
          visit(head, inner, node)
        } else if (head) {
          if (isLoopOverValues) visitPattern(head, inner, 'assign')
          else visit(head, inner, node)
        }
        if (node['right']) visit(node['right'], inner, node)
        if (node['test']) visit(node['test'], inner, node)
        if (node['update']) visit(node['update'], inner, node)
        return visit(node['body'], inner, node)
      }

      case 'CatchClause': {
        const scope = new Scope(ctx.scope)
        const inner: Context = { ...ctx, scope }
        declarePattern(node['param'], scope, false)
        if (node['param']) visitPattern(node['param'], inner, 'binding')
        return visit(node['body'], inner, node)
      }

      case 'ClassDeclaration':
      case 'ClassExpression': {
        const scope = new Scope(ctx.scope)
        if (node['id'] && node.type === 'ClassExpression') scope.declare(node['id'].name, true)
        const inner: Context = { ...ctx, scope }
        if (node['superClass']) visit(node['superClass'], inner, node)
        return visitAll(node['body'].body, inner, node)
      }

      case 'MethodDefinition':
      case 'PropertyDefinition': {
        if (node['computed'] === true) {
          visit(node['key'], ctx, node)
          const key = literalText(node['key'])
          if (key === null) dynamicKeys.push({ key: node['key'], scope: ctx.scope })
          else definedMembers.add(key)
        } else if (node['key'].type === 'Identifier') {
          checkName(node['key'].name, node['key'], false)
          definedMembers.add(node['key'].name)
        }
        if (node['value']) {
          // A field initialiser runs with `this` set to the instance.
          const inner: Context = { ...ctx, thisOk: true }
          return visit(node['value'], inner, node)
        }
        return
      }

      case 'Property':
        if (node['computed'] === true) {
          visit(node['key'], ctx, node)
          const key = literalText(node['key'])
          if (key === null) dynamicKeys.push({ key: node['key'], scope: ctx.scope })
          else definedMembers.add(key)
        } else {
          const key = node['key'] as N
          definedMembers.add(key.type === 'Identifier' ? key['name'] : String(key['value']))
        }
        return visit(node['value'], ctx, node)

      case 'VariableDeclaration':
        for (const d of node['declarations'] as N[]) {
          if (d['id'].type === 'Identifier') {
            const binding = ctx.scope.lookup(d['id'].name)
            if (binding && d['init']) binding.sources.push({ value: d['init'], op: '=', scope: ctx.scope })
          } else {
            visitPattern(d['id'], ctx, 'binding')
          }
          if (d['init']) visit(d['init'], ctx, d)
        }
        return

      case 'AssignmentExpression': {
        const left = node['left'] as N
        if (left.type === 'Identifier') {
          const binding = ctx.scope.lookup(left['name'])
          if (binding) binding.sources.push({ value: node['right'], op: node['operator'], scope: ctx.scope })
          else visit(left, ctx, node)
        } else if (left.type === 'MemberExpression') {
          visit(left, ctx, node)
          const name = staticName(left)
          if (name !== null) definedMembers.add(name)
          else dynamicKeys.push({ key: left['property'], scope: ctx.scope })
          if (name !== null) {
            const op = node['operator'] as string
            // The logical operators assign the right-hand side as it is, so it
            // is checked like a plain `=`; `+=` appends; the arithmetic
            // operators produce a number and have no value to check.
            const assigns = op === '=' || op === '||=' || op === '&&=' || op === '??='
            checkWrite(left, name, assigns || op === '+=' ? node['right'] : null, ctx.scope, {
              append: op === '+=',
              object: left['object'],
            })
          }
        } else {
          visitPattern(left, ctx, 'assign')
        }
        return visit(node['right'], ctx, node)
      }

      case 'UpdateExpression': {
        const arg = node['argument'] as N
        if (arg.type === 'Identifier') {
          const binding = ctx.scope.lookup(arg['name'])
          if (binding) binding.sources.push({ value: null, op: node['operator'], scope: ctx.scope })
          else visit(arg, ctx, node)
        } else {
          visit(arg, ctx, node)
          if (arg.type === 'MemberExpression') {
            const name = staticName(arg)
            if (name !== null) checkWrite(arg, name, null, ctx.scope, { object: arg['object'] })
          }
        }
        return
      }

      case 'LabeledStatement':
        return visit(node['body'], ctx, node)
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
        return
    }

    // Statements and expressions with no rule of their own.
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'type' || key === 'start' || key === 'end') continue
      const value = node[key]
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && typeof item.type === 'string') visit(item, ctx, node)
        }
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        visit(value, ctx, node)
      }
    }
  }

  const root = ast as unknown as N
  const programScope = new Scope(null)
  // `this` at the top of the program is the page global object. The harness
  // wraps code in an arrow function inside a strict-mode IIFE, which keeps
  // that meaning, so it is refused rather than assumed to be undefined.
  visit(root, { scope: programScope, thisOk: false }, null)
  for (const { key, scope } of dynamicKeys) {
    if (!isNumeric(key, scope)) dynamicDefinitions = true
  }
  for (const check of deferred) check()

  const usedCapabilities = [
    ...new Set(
      findings
        .map((f) => f.capability)
        .filter((c): c is Capability => c !== null),
    ),
  ]

  return { findings, usedCapabilities }
}

/**
 * Raises capability findings from warn to block when the transform did not
 * declare that capability. A declared capability the user approved is an
 * expected use; an undeclared one is a rejection, not a judgement call.
 */
export function applyCapabilityPolicy(
  outcome: AnalysisOutcome,
  declared: Capability[],
): { findings: StaticFinding[]; undeclared: Capability[] } {
  const declaredSet = new Set(declared)
  const undeclared = outcome.usedCapabilities.filter((c) => !declaredSet.has(c))
  const undeclaredSet = new Set(undeclared)

  const findings = outcome.findings.map((finding) =>
    finding.capability !== null && undeclaredSet.has(finding.capability)
      ? { ...finding, severity: 'block' as const }
      : finding,
  )

  return { findings, undeclared }
}
