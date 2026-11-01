/**
 * The code that runs in the world for frames.mjs (#139, windows reached by
 * index). It tries every way to create an element that makes a browsing context
 * that was measured, and for each one records whether the number of frames of
 * the window (`window.length`) grew and whether the new frame's window, reached
 * by index, has `fetch`. A request is also made through that window, so that
 * the server and not this code says whether it left.
 */
export const REPORT_ATTRIBUTE = 'data-wa-rg'

/** Redefinitions of built-ins that a guard could rely on, made before the routes run. */
export const TAMPER = `
try { RegExp.prototype.exec = () => null; RegExp.prototype.test = () => false } catch (e) {}
try { Function.prototype.apply = function () { return undefined }; Function.prototype.call = function () { return undefined } } catch (e) {}
try { Reflect.apply = () => undefined } catch (e) {}
try { Array.prototype.join = () => ''; Array.prototype[Symbol.iterator] = function* () {} } catch (e) {}
try { String.prototype.toString = () => 'x'; window.String = () => 'x' } catch (e) {}
`

export const frameMeasure = (prefix = '') => `(() => {
${prefix}
const out = { create: {}, index: {}, existing: {}, meta: {} };
const BASE = 'http://localhost:8791/egress?via=';
const XHTML = 'http://www.w3.org/1999/xhtml';
const len = () => { try { return window.length } catch (e) { return 'threw ' + e.name } };
const describe = (e) => (e && e.name) + ': ' + String(e && e.message).slice(0, 50);
out.meta.lengthAtStart = len();
out.meta.writeReadable = (() => { try { return typeof document.write } catch (e) { return 'refused' } })();
const reachIndex = (i, tag) => {
  try {
    const W = window[i];
    if (!W) return 'no window';
    if (typeof W.fetch !== 'function') return 'window without fetch';
    W.fetch(BASE + tag).catch(() => {});
    return 'fetch reachable';
  } catch (e) { return 'threw ' + e.name }
};
const route = (name, thunk) => {
  const before = len();
  try { thunk() } catch (e) { out.create[name] = 'refused (' + describe(e) + ')'; return }
  const after = len();
  if (typeof after === 'number' && typeof before === 'number' && after > before) {
    out.create[name] = 'frame created; ' + reachIndex(after - 1, 'idx_' + name);
  } else out.create[name] = 'no frame (length ' + before + ' to ' + after + ')';
};
const host = () => { const d = document.createElement('div'); document.body.appendChild(d); return d };

route('createElement iframe', () => { const f = document.createElement('iframe'); document.body.appendChild(f) });
route('createElement IFRAME (upper case)', () => { const f = document.createElement('IFRAME'); document.body.appendChild(f) });
route('createElementNS xhtml iframe', () => { const f = document.createElementNS(XHTML, 'iframe'); document.body.appendChild(f) });
route('createElementNS xhtml with prefix', () => { const f = document.createElementNS(XHTML, 'x:iframe'); document.body.appendChild(f) });
route('createElement object', () => { const f = document.createElement('object'); f.data = 'about:blank'; f.type = 'text/html'; document.body.appendChild(f) });
route('createElement embed', () => { const f = document.createElement('embed'); f.src = 'about:blank'; f.type = 'text/html'; document.body.appendChild(f) });
route('createElement frame in frameset', () => { const s = document.createElement('frameset'); const f = document.createElement('frame'); f.src = 'about:blank'; s.appendChild(f); document.documentElement.appendChild(s) });
route('insertAdjacentHTML', () => { host().insertAdjacentHTML('beforeend', '<iframe></iframe>') });
route('insertAdjacentHTML upper case and attributes', () => { host().insertAdjacentHTML('afterbegin', '<IFRAME src="about:blank" name=a></IFRAME>') });
route('innerHTML on an element', () => { host().innerHTML = '<p>x</p><iframe></iframe>' });
route('outerHTML on an element', () => { host().outerHTML = '<iframe></iframe>' });
route('innerHTML on a detached element, then appended', () => { const d = document.createElement('div'); d.innerHTML = '<iframe></iframe>'; document.body.appendChild(d) });
route('createContextualFragment', () => { document.body.appendChild(document.createRange().createContextualFragment('<iframe></iframe>')) });
route('DOMParser html, node appended', () => { const doc = new DOMParser().parseFromString('<body><iframe></iframe>', 'text/html'); document.body.appendChild(doc.body.firstChild) });
route('DOMParser html, importNode', () => { const doc = new DOMParser().parseFromString('<body><iframe></iframe>', 'text/html'); document.body.appendChild(document.importNode(doc.body.firstChild, true)) });
route('DOMParser xml, node appended', () => { const doc = new DOMParser().parseFromString('<iframe xmlns="' + XHTML + '"/>', 'application/xml'); document.body.appendChild(doc.documentElement) });
route('template innerHTML, content appended', () => { const t = document.createElement('template'); t.innerHTML = '<iframe></iframe>'; document.body.appendChild(t.content) });
route('createHTMLDocument element, appended', () => { const d = document.implementation.createHTMLDocument('x'); document.body.appendChild(d.createElement('iframe')) });
route('setHTMLUnsafe', () => { host().setHTMLUnsafe('<iframe></iframe>') });
route('Document.parseHTMLUnsafe, node appended', () => { const d = Document.parseHTMLUnsafe('<body><iframe></iframe>'); document.body.appendChild(d.body.firstChild) });
route('attachShadow innerHTML', () => { const s = host().attachShadow({ mode: 'open' }); s.innerHTML = '<iframe></iframe>' });
route('cloneNode of a created element built another way', () => { const d = document.createElement('div'); d.append(document.createElement('p')); document.body.appendChild(d.cloneNode(true)) });
route('cloneNode of a frame the page had', () => { const f = document.querySelector('iframe'); if (!f) throw new Error('no page frame'); document.body.appendChild(f.cloneNode(true)) });
route('importNode of a frame the page had', () => { const f = document.querySelector('iframe'); if (!f) throw new Error('no page frame'); document.body.appendChild(document.importNode(f, true)) });
route('cloneNode of a subtree holding a frame the page had', () => { document.body.appendChild(document.querySelector('main').cloneNode(true)) });
route('Range cloneContents of a frame the page had', () => { const r = document.createRange(); r.selectNodeContents(document.querySelector('main')); document.body.appendChild(r.cloneContents()) });
route('customized built-in iframe made with new', () => { class F extends HTMLIFrameElement {} customElements.define('wa-f', F, { extends: 'iframe' }); document.body.appendChild(new F()) });
route('createDocument with an iframe root, adopted', () => { const d = document.implementation.createDocument(XHTML, 'iframe'); document.body.appendChild(d.documentElement) });
route('tag name given as an object whose toString changes', () => { let n = 0; const tag = { toString() { n += 1; return n === 1 ? 'div' : 'iframe' } }; document.body.appendChild(document.createElement(tag)) });
route('tag name given as an array', () => { document.body.appendChild(document.createElement(['iframe'])) });
route('markup given as an object whose toString changes', () => { let n = 0; const html = { toString() { n += 1; return n === 1 ? '<p>x</p>' : '<iframe></iframe>' } }; host().insertAdjacentHTML('beforeend', html) });
route('innerHTML set to an object whose toString changes', () => { let n = 0; const html = { toString() { n += 1; return n === 1 ? '<p>x</p>' : '<iframe></iframe>' } }; host().innerHTML = html });
route('markup split over two writes', () => { const d = host(); d.innerHTML = '<ifr'; d.innerHTML += 'ame></iframe>' });
route('markup with a leading space in the tag name (text, not a tag)', () => { host().innerHTML = '< iframe></iframe>' });
route('createElement from the prototype descriptor', () => { const f = Object.getOwnPropertyDescriptor(Document.prototype, 'createElement').value; document.body.appendChild(f.call(document, 'iframe')) });
route('createElement from a document made by createHTMLDocument', () => { const d = document.implementation.createHTMLDocument('x'); document.body.appendChild(d.createElement('iframe')) });
route('document.write in a new document, adopted', () => { const d = document.implementation.createHTMLDocument('x'); d.write('<iframe></iframe>'); document.body.appendChild(d.querySelector('iframe')) });

// Windows of frames that the page had, with nothing created.
out.existing.length = len();
out.existing.index0 = reachIndex(0, 'existing_index0');
out.existing.named = (() => { try { const W = window.wa_existing; if (!W) return 'no window'; W.fetch(BASE + 'existing_named').catch(() => {}); return typeof W.fetch === 'function' ? 'fetch reachable' : 'window without fetch' } catch (e) { return 'threw ' + e.name } })();

// Hiding the index and the length on the window.
for (const k of ['0', '1', 'length']) {
  try { Object.defineProperty(window, k, { get() { throw new Error('hidden') }, configurable: false }); out.index['define ' + k] = 'call succeeded' } catch (e) { out.index['define ' + k] = 'call threw ' + describe(e) }
}
out.index.readLengthAfter = (() => { try { return 'value ' + window.length } catch (e) { return 'read threw ' + e.name } })();
out.index.read0After = (() => { try { return typeof window[0] + ' ' + (window[0] && typeof window[0].fetch) } catch (e) { return 'read threw ' + e.name } })();
out.index.readNamedAfter = (() => { try { return typeof window.wa_existing } catch (e) { return 'read threw ' + e.name } })();
out.index.deleteZero = (() => { try { return 'delete returned ' + delete window[0] } catch (e) { return 'delete threw ' + e.name } })();
out.index.read0AfterDelete = (() => { try { return typeof window[0] } catch (e) { return 'read threw ' + e.name } })();
out.index.setLengthZero = (() => { try { window.length = 0; return 'assigned; read ' + window.length } catch (e) { return 'assign threw ' + e.name } })();
out.index.protoRoute = (() => { try { const p = Object.getPrototypeOf(window); return 'prototype ' + Object.prototype.toString.call(p) } catch (e) { return 'threw ' + e.name } })();
out.index.proxyOfWindow = (() => { try { const px = new Proxy(window, { get() { return 'trapped' } }); return 'proxy made; read ' + px[0] } catch (e) { return 'threw ' + e.name } })();
document.documentElement.setAttribute(${JSON.stringify(REPORT_ATTRIBUTE)}, JSON.stringify(out));
})()`
