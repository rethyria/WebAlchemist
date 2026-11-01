/**
 * The code that runs inside the world after the guard. It is a string, because
 * it is registered as a user script, and it is the same for every configuration
 * so that the baseline (no guard) and the guarded runs differ only in the guard.
 *
 * It records, for every route that can reach a window, which features that
 * window still has, and it fires one real request per route and network feature
 * so that the local server, and not this code, decides whether a request left.
 *
 * Results go to the document as one attribute, the only channel from the world
 * to the page; the harness reads it from the page.
 */
export const REPORT_ATTRIBUTE = 'data-wa-rg'
export const SERVER = 'http://localhost:8791'

export const MEASURE = `(() => {
const out = { routes: {}, other: {}, dom: {} };
const sockets = [];
const BASE = ${JSON.stringify(SERVER)} + '/egress?via=';
const FEATURES = ['fetch', 'xhr', 'websocket', 'beacon', 'eventsource', 'open', 'worker', 'sharedworker', 'eval', 'function', 'indexeddb', 'localstorage', 'sessionstorage', 'caches', 'cookiestore', 'cookie', 'serviceworker', 'rtc'];
const probe = (W, tag) => {
  const r = {};
  const t = (name, fn) => { try { r[name] = fn() ? 'W' : '-' } catch (e) { r[name] = '-' } };
  t('fetch', () => { W.fetch(BASE + tag + '.fetch').catch(() => {}); return true });
  t('xhr', () => { const x = new W.XMLHttpRequest(); x.open('GET', BASE + tag + '.xhr'); x.send(); return true });
  // Firefox delays a WebSocket handshake to a host while earlier ones to it are
  // still connecting, so a burst of them makes the later ones arrive late, which
  // reads as a block. Whether the feature is reachable is read from its type,
  // and the attempts are made one at a time after the other measurements.
  t('websocket', () => { const url = 'ws://localhost:8791/egress?via=' + tag + '.websocket'; if (typeof W.WebSocket !== 'function') return false; sockets.push([W, url]); return true });
  t('beacon', () => W.navigator.sendBeacon(BASE + tag + '.beacon'));
  t('eventsource', () => { const s = new W.EventSource(BASE + tag + '.eventsource'); s.onerror = () => { s.close() }; return true });
  t('open', () => typeof W.open === 'function');
  t('worker', () => typeof W.Worker === 'function');
  t('sharedworker', () => typeof W.SharedWorker === 'function');
  t('eval', () => W.eval('1 + 1') === 2);
  t('function', () => new W.Function('return 1')() === 1);
  t('indexeddb', () => typeof W.indexedDB.open === 'function');
  t('localstorage', () => { W.localStorage.setItem('wa_rg', '1'); return W.localStorage.getItem('wa_rg') === '1' });
  t('sessionstorage', () => { W.sessionStorage.setItem('wa_rg', '1'); return true });
  t('caches', () => typeof W.caches.open === 'function');
  t('cookiestore', () => typeof W.cookieStore.get === 'function');
  t('cookie', () => { W.document.cookie = 'wa_rg=1'; return /wa_rg=1/.test(W.document.cookie) });
  t('serviceworker', () => typeof W.navigator.serviceWorker.register === 'function');
  t('rtc', () => typeof W.RTCPeerConnection === 'function');
  return r;
};
const add = (name, thunk) => {
  try {
    const W = typeof thunk === 'function' ? thunk() : thunk;
    out.routes[name] = W ? probe(W, name) : 'no window: ' + String(W);
  } catch (e) { out.routes[name] = 'unreachable: ' + (e && e.message) }
};
const guarded = (name, fn) => { try { out.other[name] = 'works: ' + String(fn()) } catch (e) { out.other[name] = 'blocked: ' + (e && e.name) } };

add('direct', () => globalThis);
add('window', () => window);
add('self', () => self);
add('defaultView', () => document.defaultView);
add('rootNode', () => document.documentElement.getRootNode().defaultView);
add('parentNode', () => document.documentElement.parentNode.defaultView);
add('top', () => window.top);
add('parent', () => window.parent);
add('protoOfGlobal', () => Object.getPrototypeOf(globalThis));
add('wrappedJSObject', () => window.wrappedJSObject);

let frame = null;
let named = null;
try {
  frame = document.createElement('iframe');
  document.body.appendChild(frame);
  named = document.createElement('iframe');
  named.name = 'wa_named_frame';
  document.body.appendChild(named);
} catch (e) { out.other.iframeCreate = 'blocked: ' + e.name }
add('iframeContentWindow', () => frame.contentWindow);
add('iframeContentDocumentView', () => frame.contentDocument.defaultView);
add('iframeGetterFromPrototype', () => Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get.call(frame));
add('frames0', () => window.frames[0]);
add('window0', () => window[0]);
add('window1', () => window[1]);
add('namedFrameOnWindow', () => window.wa_named_frame);
add('framesByName', () => window.frames['wa_named_frame']);

guarded('sandboxEval', () => eval('1 + 1'));
guarded('sandboxFunction', () => new Function('return 3')());
guarded('constructorChain', () => (() => {}).constructor('return 4')());
guarded('asyncConstructorChain', () => Object.getPrototypeOf(async function () {}).constructor('return 5').name);
guarded('arrayConstructorChain', () => [].constructor.constructor('return 6')());
guarded('elementConstructorChain', () => document.body.constructor.constructor('return 7')());
guarded('windowConstructorChain', () => window.constructor.constructor('return 8')());
guarded('createdDocumentCookie', () => { const d = document.implementation.createHTMLDocument('x'); d.cookie = 'wa_rg_doc=1'; return d.cookie });
guarded('cookieFromPrototype', () => Object.getOwnPropertyDescriptor(Document.prototype, 'cookie').get.call(document));
guarded('beaconFromPrototype', () => Navigator.prototype.sendBeacon.call(navigator, BASE + 'beaconFromPrototype'));
guarded('beaconDescriptor', () => Object.getOwnPropertyDescriptor(Navigator.prototype, 'sendBeacon').value.call(navigator, BASE + 'beaconDescriptor'));
guarded('importModule', () => { import(${JSON.stringify(SERVER)} + '/mod.js?via=import').catch(() => {}); return 'requested' });
guarded('reflectGet', () => Reflect.get(window, 'fetch') !== undefined);
guarded('windowOpenString', () => typeof window.open);
guarded('stringTimerOnWindow', () => { window.setTimeout('document.documentElement.setAttribute("data-wa-str-window", "ran")', 0); return 'scheduled' });
guarded('stringIntervalDirect', () => { const id = setInterval('document.documentElement.setAttribute("data-wa-str-interval", "ran")', 5); setTimeout(() => clearInterval(id), 50); return 'scheduled' });
guarded('functionTimerStillWorks', () => { setTimeout(() => document.documentElement.setAttribute('data-wa-fn-timer', 'ran'), 0); return 'scheduled' });
guarded('timerArgumentsPassed', () => { setTimeout((a, b) => document.documentElement.setAttribute('data-wa-timer-args', a + b), 0, 'x', 'y'); return 'scheduled' });
guarded('typeofFetchBareName', () => typeof fetch);
guarded('hasBrowserNamespace', () => typeof browser + '/' + typeof chrome);

/* Elements the code inserts. They are not features of the window, so none of the
   definitions above can reach them. Which policy governs their requests is what
   the server's log shows. */
const dom = (name, fn) => { try { fn(); out.dom[name] = 'created' } catch (e) { out.dom[name] = 'threw: ' + e.name } };
dom('newImageDetached', () => { new Image().src = BASE + 'dom.newImageDetached' });
dom('imgInDocument', () => { const i = document.createElement('img'); i.src = BASE + 'dom.imgInDocument'; document.body.appendChild(i) });
dom('styleElementUrl', () => { const s = document.createElement('style'); s.textContent = 'body { background-image: url(' + BASE + 'dom.styleElementUrl) }'; document.head.appendChild(s) });
dom('styleElementImport', () => { const s = document.createElement('style'); s.textContent = '@import url(' + BASE + 'dom.styleElementImport);'; document.head.appendChild(s) });
dom('linkStylesheet', () => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = BASE + 'dom.linkStylesheet'; document.head.appendChild(l) });
dom('inlineStyleUrl', () => { const d = document.createElement('div'); d.style.setProperty('background-image', 'url(' + BASE + 'dom.inlineStyleUrl)'); document.body.appendChild(d) });
dom('fontFace', () => { const s = document.createElement('style'); s.textContent = '@font-face { font-family: wa; src: url(' + BASE + 'dom.fontFace) } body::after { content: "x"; font-family: wa }'; document.head.appendChild(s) });
dom('iframeSrc', () => { const f = document.createElement('iframe'); f.src = BASE + 'dom.iframeSrc'; document.body.appendChild(f) });
dom('audioSrc', () => { const a = document.createElement('audio'); a.src = BASE + 'dom.audioSrc'; a.preload = 'auto'; document.body.appendChild(a) });
dom('scriptSrc', () => { const s = document.createElement('script'); s.src = BASE + 'dom.scriptSrc'; document.head.appendChild(s) });

const drain = () => new Promise((resolve) => {
  const next = () => {
    const item = sockets.shift();
    if (!item) { resolve(); return }
    let finished = false;
    const finish = () => { if (!finished) { finished = true; next() } };
    try {
      const s = new item[0].WebSocket(item[1]);
      s.onclose = finish; s.onerror = finish;
      setTimeout(finish, 1500);
    } catch (e) { finish() }
  };
  next();
});

setTimeout(async () => {
  await drain();
  for (const name of ['data-wa-str-window', 'data-wa-str-interval', 'data-wa-fn-timer', 'data-wa-timer-args']) {
    out.other[name] = String(document.documentElement.getAttribute(name));
  }
  document.documentElement.setAttribute(${JSON.stringify(REPORT_ATTRIBUTE)}, JSON.stringify(out));
}, 1500);

/* Two more routes that arrive asynchronously. They are measured before the report is written. */
setTimeout(function () { const self_ = this; add('timerThis', () => self_) }, 0);
window.addEventListener('wa-rg-event', (e) => { add('eventTargetOnWindow', () => e.target) });
document.addEventListener('wa-rg-event', (e) => { add('eventTargetOnDocument', () => e.target.defaultView) });
try { window.dispatchEvent(new Event('wa-rg-event')); document.dispatchEvent(new Event('wa-rg-event')) } catch (e) { out.other.dispatch = 'blocked: ' + e.name }
})();`
