/**
 * #139 -- can a transform's world be stopped from reaching the window of a frame
 * by index (`window[0]`)? A property of the window cannot hide an index, so this
 * measures what the guard can do instead: refuse to create an element that has a
 * browsing context (iframe, frame, object, embed) through every API that makes
 * elements, and hide the length of the window.
 *
 * Configurations (all with nothing declared, on /page-frames, which already has
 * two frames of its own):
 *
 *   baseline         no guard. Every creation route must make a frame, or the
 *                    probe cannot see a refusal.
 *   getters only     the guard of commit 3da7cb7: throwing contentWindow and
 *                    contentDocument getters, no refusal of creation.
 *   frame refusal    the guard with the wrappers that refuse the creation.
 *   frame refusal, built-ins redefined first
 *                    the same, after the code has redefined RegExp, Function,
 *                    Reflect, Array and String built-ins.
 *
 * After each run the page itself creates frames by the same routes, from its own
 * context, and uses window[0].
 */
import { verdict } from '../crypto/rdp.mjs'
import { startServer } from './server.mjs'
import { connectWorld } from './world.mjs'
import { frameMeasure, TAMPER } from './frames-code.mjs'
import { runtimeGuardSource } from '../../src/background/runtime-guard.ts'

const PAGE_CHECK = `async () => {
  const r = {}
  const XHTML = 'http://www.w3.org/1999/xhtml'
  const route = (name, make) => {
    const before = window.length
    try { make(); r[name] = window.length > before ? 'frame created, window[' + (window.length - 1) + '].fetch is ' + typeof window[window.length - 1].fetch : 'no frame' } catch (e) { r[name] = 'threw ' + e.name }
  }
  const host = () => { const d = document.createElement('div'); document.body.appendChild(d); return d }
  route('createElement', () => document.body.appendChild(document.createElement('iframe')))
  route('createElementNS', () => document.body.appendChild(document.createElementNS(XHTML, 'iframe')))
  route('insertAdjacentHTML', () => host().insertAdjacentHTML('beforeend', '<iframe></iframe>'))
  route('innerHTML', () => { host().innerHTML = '<iframe></iframe>' })
  route('outerHTML', () => { host().outerHTML = '<iframe></iframe>' })
  route('createContextualFragment', () => document.body.appendChild(document.createRange().createContextualFragment('<iframe></iframe>')))
  route('DOMParser', () => document.body.appendChild(new DOMParser().parseFromString('<body><iframe></iframe>', 'text/html').body.firstChild))
  route('template', () => { const t = document.createElement('template'); t.innerHTML = '<iframe></iframe>'; document.body.appendChild(t.content) })
  route('setHTMLUnsafe', () => host().setHTMLUnsafe('<iframe></iframe>'))
  route('customized built-in', () => { class F extends HTMLIFrameElement {} customElements.define('wa-page-f', F, { extends: 'iframe' }); document.body.appendChild(new F()) })
  route('createDocument', () => document.body.appendChild(document.implementation.createDocument(XHTML, 'iframe').documentElement))
  route('object with data', () => { const o = document.createElement('object'); o.data = 'about:blank'; document.body.appendChild(o) })
  r.windowIndexFetch = window.length > 0 ? typeof window[0].fetch : 'no frames'
  r.createElementIsNative = String(document.createElement).includes('[native code]') && String(Element.prototype.insertAdjacentHTML).includes('[native code]')
  r.innerHTMLSetterIsNative = String(Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML').set).includes('[native code]')
  r.contentWindowOfNewFrame = (() => { const f = document.createElement('iframe'); document.body.appendChild(f); return typeof f.contentWindow.fetch })()
  r.writeIsFunction = typeof document.write
  return r
}`

// A check that converts the argument to a string to test it and then passes the
// original object on. It is the control that shows the toString rows can fail.
const NAIVE = `(() => {
  const test = (v) => /iframe/i.test(String(v));
  const wrap = (owner, name, index) => { const o = Object.getOwnPropertyDescriptor(owner, name).value; Object.defineProperty(owner, name, { value: function (...a) { if (test(a[index])) throw new Error('naive check refused'); return o.apply(this, a) }, configurable: false }) };
  wrap(Document.prototype, 'createElement', 0);
  wrap(Element.prototype, 'insertAdjacentHTML', 1);
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { get: d.get, set: function (v) { if (test(v)) throw new Error('naive check refused'); d.set.call(this, v) }, configurable: false });
})();
`
const CONFIGS = [
  { key: 'naive check', guard: false, prefix: NAIVE },
  { key: 'baseline', guard: false },
  { key: 'getters only', guard: true, blockFrames: false },
  { key: 'frame refusal', guard: true, blockFrames: true },
  { key: 'frame refusal, built-ins redefined first', guard: true, blockFrames: true, tamper: true },
]
const server = await startServer()
const world = await connectWorld()
const runs = {}
try {
  for (const config of CONFIGS) {
    server.reset()
    const guard = config.guard ? runtimeGuardSource([], 'data-wa-err-probe', { blockFrames: config.blockFrames }) + '\n' : ''
    const { report, page } = await world.run({ code: guard + frameMeasure((config.prefix ?? '') + (config.tamper ? TAMPER : '')), pagePath: '/page-frames', after: PAGE_CHECK, settleMs: 1500 })
    runs[config.key] = { report, page, arrived: new Set(server.arrived) }
    console.log(`\n=== ${config.key} ===`)
    for (const [name, result] of Object.entries(report?.create ?? {})) console.log(`  ${name.padEnd(62)} ${result}`)
    console.log('  existing frames of the page:', JSON.stringify(report?.existing))
    console.log('  meta:', JSON.stringify(report?.meta))
    console.log('  index:', JSON.stringify(report?.index))
    console.log('  page, from its own context:', JSON.stringify(page))
  }

  const run = (k) => runs[k] ?? {}
  const rows = []
  const created = (k) => Object.entries(run(k).report?.create ?? {}).filter(([, v]) => v.startsWith('frame created')).map(([n]) => n)
  const refused = (k, name) => run(k).report?.create?.[name]?.startsWith('refused')
  const NOT_FRAMES = ['createElement object', 'createElement embed', 'attachShadow innerHTML', 'cloneNode of a created element built another way', 'markup with a leading space in the tag name (text, not a tag)', 'tag name given as an object whose toString changes', 'markup given as an object whose toString changes', 'innerHTML set to an object whose toString changes', 'markup split over two writes']
  const ROUTES_OF_THE_PAGE = ['cloneNode of a frame the page had', 'importNode of a frame the page had', 'cloneNode of a subtree holding a frame the page had', 'Range cloneContents of a frame the page had']
  rows.push(['control (baseline): the measuring code reported', Boolean(run('baseline').report)])
  rows.push(['control (baseline): creation routes make frames', created('baseline').length >= 22])
  rows.push(['control (baseline): the server saw a request through the new frame of every route that made one', created('baseline').every((n) => run('baseline').arrived.has('idx_' + n)) || created('baseline').filter((n) => !run('baseline').arrived.has('idx_' + n)).every((n) => /frameset/.test(n))])
  // Control for the toString rows below: without the guard the object's second conversion is what the browser uses, so a frame is made.
  // Control for the toString rows below. A check that converts the argument to test it and passes the object
  // on is refused for the plain string and passed by the object whose second conversion differs.
  rows.push(['control (naive check): the check refuses a plain iframe tag and plain iframe markup', refused('naive check', 'createElement iframe') && refused('naive check', 'insertAdjacentHTML') && refused('naive check', 'innerHTML on an element')])
  rows.push(['control (naive check): an object whose toString changes passes it and makes a frame', ['tag name given as an object whose toString changes', 'markup given as an object whose toString changes', 'innerHTML set to an object whose toString changes'].every((n) => created('naive check').includes(n))])
  rows.push(['control (baseline): the frames that the page had are reachable by index', run('baseline').report?.existing?.index0 === 'fetch reachable'])
  for (const key of ['getters only']) {
    rows.push([`${key}: window[0] still reaches fetch for frames the transform creates (the gap that this probe is about)`, created(key).length >= 22 && created(key).some((n) => run(key).arrived.has('idx_' + n))])
  }
  for (const key of ['frame refusal', 'frame refusal, built-ins redefined first']) {
    const c = created(key)
    rows.push([`${key}: no creation route made a frame, except the clone routes on frames that the page already had (${c.join('; ') || 'none'})`, Boolean(run(key).report) && c.every((n) => ROUTES_OF_THE_PAGE.includes(n))])
    rows.push([`${key}: the server saw no request through a frame the transform created`, Boolean(run(key).arrived) && [...run(key).arrived].every((v) => !v.startsWith('idx_') || ROUTES_OF_THE_PAGE.some((n) => v === 'idx_' + n))])
    // Two routes call a built-in that this configuration redefined to return nothing, so a refusal there
    // does not come from the guard.
    const NOT_THE_GUARD = key.includes('redefined') ? ['createElement from the prototype descriptor', 'tag name given as an array'] : []
    for (const name of ['createElement iframe', 'createElement IFRAME (upper case)', 'createElementNS xhtml iframe', 'createElementNS xhtml with prefix', 'insertAdjacentHTML', 'innerHTML on an element', 'outerHTML on an element', 'createContextualFragment', 'DOMParser html, node appended', 'DOMParser xml, node appended', 'template innerHTML, content appended', 'setHTMLUnsafe', 'Document.parseHTMLUnsafe, node appended', 'customized built-in iframe made with new', 'createDocument with an iframe root, adopted', 'tag name given as an array', 'createElement from the prototype descriptor', 'createElement from a document made by createHTMLDocument'].filter((n) => !NOT_THE_GUARD.includes(n))) {
      rows.push([`${key}: ${name} is refused`, Boolean(refused(key, name))])
    }
    for (const name of ['tag name given as an object whose toString changes', 'markup given as an object whose toString changes', 'innerHTML set to an object whose toString changes']) {
      const v = run(key).report?.create?.[name]
      rows.push([`${key}: ${name} makes no frame (checked once, passed on once)`, typeof v === 'string' && !v.startsWith('frame created')])
    }
    rows.push([`${key}: document.write is not readable`, run(key).report?.meta?.writeReadable === 'refused'])
    rows.push([`${key}: markup that is not a frame tag is not refused (control for the markup check)`, run(key).report?.create?.['markup with a leading space in the tag name (text, not a tag)'] === 'no frame (length ' + run(key).report?.meta?.lengthAtStart + ' to ' + run(key).report?.meta?.lengthAtStart + ')' || /^no frame/.test(run(key).report?.create?.['markup with a leading space in the tag name (text, not a tag)'] ?? '')])
  }
  rows.push(['frame refusal: the frames that the page had stay reachable by index (a limit, reported)', run('frame refusal').report?.existing?.index0 === 'fetch reachable'])
  for (const key of ['frame refusal', 'frame refusal, built-ins redefined first']) {
    const p = run(key).page
    const routes = ['createElement', 'createElementNS', 'insertAdjacentHTML', 'innerHTML', 'outerHTML', 'createContextualFragment', 'DOMParser', 'template', 'setHTMLUnsafe', 'customized built-in', 'createDocument']
    rows.push([
      `page (${key}): the page creates frames by every one of these routes and uses window[0].fetch, its functions are native, and document.write exists`,
      Boolean(p) && routes.every((n) => /^frame created, window\[\d+\]\.fetch is function$/.test(p[n])) && p.windowIndexFetch === 'function' && p.createElementIsNative === true && p.innerHTMLSetterIsNative === true && p.contentWindowOfNewFrame === 'function' && p.writeIsFunction === 'function',
    ])
  }
  verdict(rows)
} finally {
  world.close()
  server.close()
}
