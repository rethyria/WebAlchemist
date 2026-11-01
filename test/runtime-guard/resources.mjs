/**
 * #139 -- routes that reach a page object through the Xray waiver, and routes
 * that load a resource, other than the features of the window that probe.mjs
 * measures. Each is run in four configurations: no guard (the control, which
 * shows that every route works and that the server sees its request), the guard
 * with nothing declared, the guard with network and storage declared, and the
 * page's own use of the same APIs.
 *
 * Needs the same setup as probe.mjs. The test page is /page-frames, which has a
 * named frame that the form routes submit into.
 */
import { verdict } from '../crypto/rdp.mjs'
import { startServer } from './server.mjs'
import { connectWorld } from './world.mjs'
import { RESOURCE_MEASURE } from './resources-code.mjs'
import { runtimeGuardSource } from '../../src/background/runtime-guard.ts'

// The page's own use of the same APIs, read from the page's context after the guard ran.
const PAGE_CHECK = `async () => {
  const r = {}
  const t = (n, f) => { try { r[n] = f() } catch (e) { r[n] = 'threw ' + e.name } }
  t('waiverIsUndefined', () => document.wrappedJSObject === undefined && navigator.wrappedJSObject === undefined && location.wrappedJSObject === undefined)
  t('FontFaceConstructs', () => typeof new FontFace('wapage', 'local(Arial)'))
  t('audioWorkletExists', () => typeof new AudioContext().audioWorklet.addModule)
  t('formSubmitIsFunction', () => typeof HTMLFormElement.prototype.submit + ' ' + typeof HTMLFormElement.prototype.requestSubmit)
  t('storageExists', () => typeof navigator.storage.getDirectory)
  t('opfsWorks', () => 'async')
  r.opfs = await navigator.storage.getDirectory().then((d) => d.getFileHandle('wa-page', { create: true }).then(async (f) => { await d.removeEntry('wa-page'); return 'ok' })).catch((e) => 'threw ' + e.name)
  const f = document.createElement('form'); f.action = 'http://localhost:8791/form?via=page_form'; f.method = 'POST'; f.target = 'wa_existing'; document.body.appendChild(f)
  t('pageFormSubmit', () => { f.submit(); return 'submitted' })
  t('exportFunctionExists', () => typeof exportFunction)
  await new Promise((resolve) => setTimeout(resolve, 800))
  return r
}`
const server = await startServer()
const world = await connectWorld()
const runs = {}
const csp = (extra) => ["default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", extra ? 'connect-src https:' : "connect-src 'none'", extra ? 'img-src *' : "img-src 'none'"].join('; ')
const CONFIGS = [
  { key: 'baseline', capabilities: [], guard: false, csp: csp(false) },
  { key: 'guard, nothing declared', capabilities: [], guard: true, csp: csp(false) },
  { key: 'guard, network and storage declared', capabilities: ['network', 'storage'], guard: true, csp: csp(true) },
]
try {
  for (const config of CONFIGS) {
    server.reset()
    const code = (config.guard ? runtimeGuardSource(config.capabilities, 'data-wa-err-probe') + '\n' : '') + RESOURCE_MEASURE
    const { report, page } = await world.run({ code, csp: config.csp, pagePath: '/page-frames', settleMs: 2500, after: PAGE_CHECK })
    runs[config.key] = { report, page, arrived: new Set(server.arrived) }
    console.log(`\n=== ${config.key} ===`)
    for (const [name, result] of Object.entries(report ?? {})) console.log(`  ${name.padEnd(64)} ${result}`)
    console.log('  arrived at the server:', [...server.arrived].sort().join(' '))
    console.log('  the page, from its own context:', JSON.stringify(page))
  }
  const r = (k) => runs[k] ?? {}
  const base = r('baseline')
  const nothing = r('guard, nothing declared')
  const declared = r('guard, network and storage declared')
  const SEEN = {
    'waiver: document': 'waiver_document', 'waiver: navigator': 'waiver_navigator',
    'waiver: body element, reaching its window': 'waiver_body', 'waiver: new element': 'waiver_newelement',
    'waiver: target of an event': 'waiver_event', 'waiver: XPCNativeWrapper.unwrap(document)': 'waiver_xpc',
    'FontFace loaded': 'fontface', 'audioWorklet.addModule': 'audioworklet', 'form.submit()': 'form_submit',
    'form.requestSubmit()': 'form_requestsubmit', 'click on a submit button': 'form_click', 'video poster': 'poster',
    'link rel=modulepreload': 'modulepreload',
  }
  const rows = []
  rows.push(['control (baseline): the measuring code reported', Boolean(base.report)])
  rows.push([
    'control (baseline): every route that makes a request reaches the server, except prefetch (not asserted, Firefox sends it lazily)',
    Boolean(base.arrived) && Object.values(SEEN).every((v) => base.arrived.has(v)),
  ])
  rows.push(['control (baseline): every waiver route and every sandbox helper works', Boolean(base.report) && Object.entries(base.report).filter(([k]) => /^(waiver|helper)/.test(k)).every(([, v]) => v.startsWith('works'))])
  rows.push(['control (baseline): the origin private file system works', base.report?.['navigator.storage.getDirectory (origin private file system)']?.startsWith('works') === true])
  const CLOSED = [
    'waiver: document', 'waiver: navigator', 'waiver: location', 'waiver: history', 'waiver: prototype of Node',
    'helper: exportFunction', 'helper: cloneInto', 'helper: createObjectIn', 'helper: importFunction', 'helper: Components',
    'FontFace loaded', 'audioWorklet.addModule', 'navigator.storage.getDirectory (origin private file system)',
    'form.submit()', 'form.requestSubmit()',
  ]
  const OPEN = [
    'waiver: body element, reaching its window', 'waiver: body element, reaching the page Function', 'waiver: new element',
    'waiver: target of an event', 'waiver: XPCNativeWrapper.unwrap(document)', 'helper: XPCNativeWrapper',
    'click on a submit button', 'video poster', 'link rel=modulepreload',
  ]
  rows.push(['guard, nothing declared: the closed routes are refused', Boolean(nothing.report) && CLOSED.every((k) => nothing.report[k]?.startsWith('blocked'))])
  rows.push(['guard, nothing declared: the server saw no request from the closed routes', Boolean(nothing.arrived) && ['waiver_document', 'waiver_navigator', 'fontface', 'audioworklet', 'form_submit', 'form_requestsubmit'].every((v) => !nothing.arrived.has(v))])
  rows.push(['guard, nothing declared: the open routes still work (reported, not a success of the guard)', Boolean(nothing.report) && OPEN.every((k) => nothing.report[k]?.startsWith('works'))])
  rows.push(['guard, nothing declared: the open routes still reach the server', Boolean(nothing.arrived) && ['waiver_body', 'waiver_newelement', 'waiver_event', 'waiver_xpc', 'form_click', 'poster', 'modulepreload'].every((v) => nothing.arrived.has(v))])
  rows.push(['guard, network and storage declared: FontFace, the form submit methods and the origin private file system work again', Boolean(declared.report) && ['FontFace loaded', 'form.submit()', 'form.requestSubmit()', 'navigator.storage.getDirectory (origin private file system)'].every((k) => declared.report[k]?.startsWith('works'))])
  rows.push(['guard, network and storage declared: the waiver, the helpers and the audio worklet stay refused', Boolean(declared.report) && ['waiver: document', 'waiver: navigator', 'helper: exportFunction', 'audioWorklet.addModule'].every((k) => declared.report[k]?.startsWith('blocked'))])
  for (const key of ['guard, nothing declared', 'guard, network and storage declared']) {
    const p = r(key).page
    rows.push([
      `page (${key}): the waiver is undefined as before, FontFace constructs, the audio worklet, form submit methods, navigator.storage and the origin private file system exist and work`,
      Boolean(p) && p.waiverIsUndefined === true && p.FontFaceConstructs === 'object' && p.audioWorkletExists === 'function' && p.formSubmitIsFunction === 'function function' && p.storageExists === 'function' && p.opfs === 'ok' && p.pageFormSubmit === 'submitted',
    ])
    rows.push([`page (${key}): its own form submission reached the server`, Boolean(r(key).arrived) && r(key).arrived.has('page_form')])
  }
  verdict(rows)
} finally {
  world.close()
  server.close()
}
