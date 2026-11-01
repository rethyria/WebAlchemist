/**
 * #139 -- does removing features from a transform's world at run time make them
 * unreachable from that world, and does it leave the page alone?
 *
 * The same measuring code (measure-code.mjs) runs in five configurations, as a
 * user script in a USER_SCRIPT world on a test tab:
 *
 *   baseline              no guard. Every route and every feature must work, or
 *                         the probe cannot see a feature that is reachable.
 *   guarded, nothing      the guard of src/background/runtime-guard.ts with no
 *                         capability declared.
 *   guarded, network      the same with `network` declared.
 *   guarded, storage and cookies   the same with those two declared.
 *   baseline, unsafe-eval the baseline with 'unsafe-eval' in the world CSP, which
 *                         shows that `eval` is refused by the CSP and not by
 *                         anything else.
 *
 * The page itself is checked after each run from the page's own context.
 *
 * Needs Firefox with the extension, remote debugging (WA_RDP_PORT, default
 * 41365), the `userScripts` permission and the host permission for
 * http://localhost/*. The test page is served by server.mjs at
 * http://localhost:8791/page with a unique query string.
 */
import { open, uniqueUrl, verdict, sleep } from '../crypto/rdp.mjs'
import { startServer } from './server.mjs'
import { MEASURE, REPORT_ATTRIBUTE } from './measure-code.mjs'
import { runtimeGuardSource } from '../../src/background/runtime-guard.ts'

const WORLD = 'wa-rg-probe'
const SCRIPT = 'wa-rg-probe'
const ROUTE_FEATURES = ['fetch', 'xhr', 'websocket', 'beacon', 'eventsource']

// The same directives as cspForCapabilities in src/background/registry.ts.
const csp = (capabilities, extra = '') =>
  [
    "default-src 'none'",
    `script-src 'unsafe-inline'${extra}`,
    "style-src 'unsafe-inline'",
    capabilities.includes('network') ? 'connect-src https:' : "connect-src 'none'",
    capabilities.includes('network') ? 'img-src *' : "img-src 'none'",
  ].join('; ')

const CONFIGS = [
  { key: 'baseline', capabilities: [], guard: false, csp: csp([]) },
  { key: 'guarded-nothing', capabilities: [], guard: true, csp: csp([]) },
  { key: 'guarded-network', capabilities: ['network'], guard: true, csp: csp(['network']) },
  { key: 'guarded-storage-cookies', capabilities: ['storage', 'cookies'], guard: true, csp: csp(['storage', 'cookies']) },
  { key: 'baseline-unsafe-eval', capabilities: [], guard: false, csp: csp([], " 'unsafe-eval'") },
  { key: 'baseline-open-csp', capabilities: [], guard: false, csp: "default-src * 'unsafe-inline'" },
  // The world allows everything and the page's own policy refuses most loads.
  { key: 'open-world-csp-on-page', capabilities: [], guard: false, csp: "default-src * 'unsafe-inline'", pagePath: '/page-csp' },
]

const server = await startServer()
const rdp = open()
const ctx = await rdp.contexts({ waitMs: 8000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  server.close()
  process.exit(1)
}

const runs = {}

async function runConfig(config) {
  server.reset()
  const code = (config.guard ? runtimeGuardSource(config.capabilities, 'data-wa-err-probe') + '\n' : '') + MEASURE
  await B.run(`(async () => {
    try { await browser.userScripts.unregister({ ids: [${JSON.stringify(SCRIPT)}] }) } catch {}
    await browser.userScripts.configureWorld({ worldId: ${JSON.stringify(WORLD)}, csp: ${JSON.stringify(config.csp)}, messaging: false })
    await browser.userScripts.register([{ id: ${JSON.stringify(SCRIPT)}, matches: ['http://localhost/*'],
      js: [{ code: ${JSON.stringify(code)} }], world: 'USER_SCRIPT', worldId: ${JSON.stringify(WORLD)}, runAt: 'document_idle' }])
    return 'registered'
  })()`)
  const label = `rg-${config.key}`
  const tabId = Number(
    await B.run(`browser.tabs.create({ url: ${JSON.stringify(uniqueUrl(`http://localhost:8791${config.pagePath ?? '/page'}`, label))}, active: true }).then(t => t.id)`),
  )
  let report = null
  let tab = null
  try {
    for (let i = 0; i < 40 && !report; i += 1) {
      await sleep(500)
      tab ??= await ctx.tab(`wa-probe=${label}`)
      if (!tab) continue
      const raw = await tab.long(`document.documentElement.getAttribute(${JSON.stringify(REPORT_ATTRIBUTE)}) || ''`)
      if (raw.startsWith('{')) report = JSON.parse(raw)
    }
    // The page's own use of each feature, from the page's context and after the guard ran.
    let page = null
    if (tab) {
      const raw = await tab.long(`(async () => {
        const r = {}
        const t = (name, fn) => { try { r[name] = fn() } catch (e) { r[name] = 'threw ' + e.name } }
        t('fetchIsNative', () => String(window.fetch).includes('[native code]'))
        t('fetchRequest', () => { fetch('http://localhost:8791/egress?via=page.fetch', { mode: 'no-cors' }); return 'sent' })
        t('xhr', () => { const x = new XMLHttpRequest(); x.open('GET', 'http://localhost:8791/egress?via=page.xhr'); x.send(); return 'sent' })
        t('beacon', () => navigator.sendBeacon('http://localhost:8791/egress?via=page.beacon'))
        t('websocket', () => { const s = new WebSocket('ws://localhost:8791/egress?via=page.websocket'); s.onerror = () => {}; return 'sent' })
        t('eventsource', () => { const s = new EventSource('http://localhost:8791/egress?via=page.eventsource'); s.onerror = () => s.close(); return 'sent' })
        t('localStorage', () => { localStorage.setItem('wa_page', '1'); return localStorage.getItem('wa_page') })
        t('sessionStorage', () => { sessionStorage.setItem('wa_page', '1'); return sessionStorage.getItem('wa_page') })
        t('cookie', () => { document.cookie = 'wa_page=1'; return /wa_page=1/.test(document.cookie) })
        t('indexedDB', () => typeof indexedDB.open)
        t('eval', () => eval('1 + 1'))
        t('Function', () => new Function('return 2')())
        t('open', () => typeof window.open)
        t('frames', () => typeof window.frames + ' ' + window.length)
        t('serviceWorker', () => typeof navigator.serviceWorker)
        t('functionConstructorOfFunction', () => (function () {}).constructor === Function)
        t('functionConstructorRuns', () => (function () {}).constructor('return 3')())
        t('asyncFunctionConstructorName', () => Object.getPrototypeOf(async function () {}).constructor.name)
        t('elementConstructorChainRuns', () => document.body.constructor.constructor('return 4')())
        t('eventTargetConstructor', () => typeof Object.getPrototypeOf(EventTarget).constructor)
        t('worker', () => typeof Worker)
        t('stringTimer', () => { setTimeout('document.documentElement.setAttribute("data-wa-page-str", "ran")', 0); return 'scheduled' })
        t('contentWindowOfNewFrame', () => { const f = document.createElement('iframe'); document.body.appendChild(f); const ok = typeof f.contentWindow.fetch; f.remove(); return ok })
        await new Promise((resolve) => setTimeout(resolve, 600))
        r.stringTimerRan = document.documentElement.getAttribute('data-wa-page-str')
        return JSON.stringify(r)
      })()`)
      try {
        page = JSON.parse(raw)
      } catch {
        page = { raw }
      }
    }
    await sleep(4000)
    return { report, page, arrived: new Set(server.arrived) }
  } finally {
    await B.run(`browser.tabs.remove(${tabId}).catch(() => {})`)
    await B.run(`browser.userScripts.unregister({ ids: [${JSON.stringify(SCRIPT)}] }).then(() => 'x', () => 'x')`)
  }
}

const FEATURES = ['fetch', 'xhr', 'websocket', 'beacon', 'eventsource', 'open', 'worker', 'sharedworker', 'eval', 'function', 'indexeddb', 'localstorage', 'sessionstorage', 'caches', 'cookiestore', 'cookie', 'serviceworker', 'rtc']
const NETWORK = ['fetch', 'xhr', 'websocket', 'beacon', 'eventsource', 'rtc']
const STORAGE = ['indexeddb', 'localstorage', 'sessionstorage', 'caches']
const COOKIES = ['cookiestore', 'cookie']
const NEVER = ['open', 'worker', 'sharedworker', 'eval', 'function', 'serviceworker']
// Routes to a window that the guard does not close. They are measured and
// reported as reachable, so that the README and this list cannot drift apart.
const RESIDUAL_ROUTES = ['window0', 'window1']

/** Routes that produced a window, as [name, features] pairs. */
const windows = (report) => Object.entries(report.routes).filter(([, r]) => typeof r === 'object')
const reached = (report, route, feature) => report.routes[route]?.[feature] === 'W'

try {
  for (const config of CONFIGS) {
    console.log(`\n=== ${config.key}  (capabilities: ${JSON.stringify(config.capabilities)}) ===`)
    runs[config.key] = await runConfig(config)
    const { report, page, arrived } = runs[config.key]
    if (!report) {
      console.log('NO REPORT: the measuring code did not run or did not finish')
      continue
    }
    console.log('route'.padEnd(28) + FEATURES.map((f) => f.slice(0, 4).padEnd(5)).join(''))
    for (const [route, result] of Object.entries(report.routes)) {
      console.log(
        route.padEnd(28) +
          (typeof result === 'string' ? result.slice(0, 60) : FEATURES.map((f) => (result[f] ?? '?').padEnd(5)).join('')),
      )
    }
    for (const [k, v] of Object.entries(report.other)) console.log(`  ${k.padEnd(28)} ${v}`)
    console.log('  elements the code inserted, and whether the request reached the server:')
    for (const name of Object.keys(report.dom)) {
      const hit = [...arrived].some((v) => v.toLowerCase().startsWith(`dom.${name.toLowerCase()}`))
      console.log(`    ${name.padEnd(22)} ${hit ? 'ARRIVED' : 'not seen'}`)
    }
    console.log('  other requests that arrived:', [...arrived].filter((v) => !v.includes('.') || /^(import|chain)/.test(v)).sort().join(' '))
    console.log('  requests from the page itself that arrived:', [...arrived].filter((v) => v.startsWith('page.')).sort().join(' '))
    console.log('  page, from its own context:', JSON.stringify(page))
  }

  const run = (key) => runs[key] ?? {}
  const rows = []
  const has = (key) => run(key).report && run(key).page
  const arrivedFrom = (key, route, feature) => run(key).arrived?.has(`${route}.${feature}`)
  const strictFor = (key) => run(key).arrived
  const GUARDED = ['guarded-nothing', 'guarded-network', 'guarded-storage-cookies']

  // Controls first: without them a quiet server or an empty report reads as a pass.
  // The configuration with a policy on the page is left out of the first control:
  // that policy refuses the page's own requests too, so they cannot show that the
  // server is reachable.
  for (const config of CONFIGS.filter((c) => !c.pagePath)) {
    const p = run(config.key).page
    const a = run(config.key).arrived
    rows.push([
      `control (${config.key}): the page's own fetch, XHR, beacon, WebSocket and EventSource reach the server`,
      Boolean(a) && ['fetch', 'xhr', 'beacon', 'websocket', 'eventsource'].every((f) => a.has(`page.${f}`)),
    ])
    rows.push([`control (${config.key}): the measuring code reported`, Boolean(run(config.key).report)])
    void p
  }
  if (has('baseline')) {
    const b = run('baseline').report
    const ws = windows(b)
    const missing = ws.flatMap(([route]) => ['fetch', 'xhr', 'websocket', 'beacon', 'eventsource'].filter((f) => !(reached(b, route, f) && arrivedFrom('baseline', route, f))).map((f) => `${route}.${f}`))
    if (missing.length) console.log('\nbaseline pairs that did not arrive:', missing.join(' '))
    rows.push([
      'control (baseline): every route to a window reaches every network feature, and the server sees each request',
      ws.length >= 17 && ws.every(([route]) => ['fetch', 'xhr', 'websocket', 'beacon', 'eventsource'].every((f) => reached(b, route, f) && arrivedFrom('baseline', route, f))),
    ])
    rows.push([
      'control (baseline): every route to a window reaches the storage, cookie, worker and window features',
      ws.every(([route]) => [...STORAGE, ...COOKIES, 'open', 'worker', 'sharedworker', 'serviceworker', 'rtc'].every((f) => reached(b, route, f))),
    ])
    rows.push([
      "control (baseline): eval and Function work through the window routes, and are refused by the world CSP on the sandbox's own",
      ws.filter(([route]) => route !== 'direct').every(([route]) => reached(b, route, 'eval') && reached(b, route, 'function')) &&
        b.other.sandboxEval?.startsWith('blocked') && b.other.sandboxFunction?.startsWith('blocked'),
    ])
    rows.push([
      'control (baseline): the page-realm Function chain runs code and reaches the network',
      b.other.elementConstructorChain?.startsWith('works') && b.other.windowConstructorChain?.startsWith('works'),
    ])
    rows.push(['control (baseline): string timers run', b.other['data-wa-str-window'] === 'ran' && b.other['data-wa-str-interval'] === 'ran'])
  }
  {
    const a = run('baseline-open-csp').arrived
    const b = run('open-world-csp-on-page').arrived
    const names = ['styleElementUrl', 'styleElementImport', 'fontFace', 'iframeSrc']
    rows.push(['control (open world CSP, page without a policy): the four loads that a strict world CSP does not stop all arrive', Boolean(a) && names.every((n) => a.has(`dom.${n}`))])
    const pageGoverned = ['styleElementUrl', 'styleElementImport', 'fontFace']
    rows.push(["with an open world CSP and a page policy that refuses them, the stylesheet url(), the stylesheet import and the font do not arrive, so the page's policy governs those", Boolean(b) && pageGoverned.every((n) => !b.has(`dom.${n}`))])
    rows.push(['the iframe src request arrives under a strict world CSP and under a refusing page policy, so neither governs it (reported; the control is the open run)', Boolean(strictFor('guarded-nothing')) && strictFor('guarded-nothing').has('dom.iframeSrc') && Boolean(b) && b.has('dom.iframeSrc') && Boolean(a) && a.has('dom.iframeSrc')])
    const strict = strictFor('guarded-nothing')
    rows.push(["with the strict world CSP, images, links, audio, scripts and an inline style property do not arrive (the world's policy governs them)", Boolean(strict) && ['newImageDetached', 'imgInDocument', 'linkStylesheet', 'inlineStyleUrl', 'audioSrc', 'scriptSrc'].every((n) => !strict.has(`dom.${n}`)) && Boolean(a) && ['newImageDetached', 'imgInDocument', 'linkStylesheet', 'inlineStyleUrl', 'audioSrc', 'scriptSrc'].every((n) => a.has(`dom.${n}`))])
    rows.push(["with the strict world CSP, the four loads in the page's remit do arrive (not stopped by the world)", Boolean(strict) && names.every((n) => strict.has(`dom.${n}`))])
  }
  if (has('baseline-unsafe-eval')) {
    const u = run('baseline-unsafe-eval').report
    rows.push(['control: with unsafe-eval in the world CSP the sandbox eval works, so the baseline refusal is the CSP', u.other.sandboxEval === 'works: 2' && u.other.sandboxFunction === 'works: 3'])
  }

  if (has('guarded-nothing')) {
    const g = run('guarded-nothing').report
    const ws = windows(g).filter(([route]) => !RESIDUAL_ROUTES.includes(route))
    rows.push(['guarded, nothing declared: at least 12 routes to a window were measured', ws.length >= 12])
    rows.push([
      'guarded, nothing declared: no feature is reachable from any route that is not listed as residual',
      ws.every(([route]) => FEATURES.filter((f) => !['eval', 'function'].includes(f) || route !== 'direct').every((f) => !reached(g, route, f))),
    ])
    rows.push([
      'guarded, nothing declared: the server saw no request from those routes',
      ![...run('guarded-nothing').arrived].some((v) => ws.some(([route]) => v.startsWith(`${route}.`))),
    ])
    rows.push([
      'guarded, nothing declared: wrappedJSObject, iframe windows reached by property, and frames are refused',
      ['wrappedJSObject', 'iframeContentWindow', 'iframeContentDocumentView', 'iframeGetterFromPrototype', 'frames0', 'framesByName'].every((r) => typeof g.routes[r] === 'string' && g.routes[r].startsWith('unreachable')),
    ])
    rows.push([
      'guarded, nothing declared: constructor chains, string timers, Reflect, and prototype routes to beacon and cookie are refused',
      ['sandboxEval', 'sandboxFunction', 'constructorChain', 'asyncConstructorChain', 'arrayConstructorChain', 'elementConstructorChain', 'windowConstructorChain', 'createdDocumentCookie', 'cookieFromPrototype', 'beaconFromPrototype', 'beaconDescriptor', 'reflectGet', 'stringTimerOnWindow', 'stringIntervalDirect'].every((k) => g.other[k]?.startsWith('blocked')) &&
        g.other['data-wa-str-window'] === 'null' && g.other['data-wa-str-interval'] === 'null',
    ])
    rows.push(['guarded, nothing declared: timers given functions still work, with their arguments', g.other['data-wa-fn-timer'] === 'ran' && g.other['data-wa-timer-args'] === 'xy'])
    rows.push([
      'guarded, nothing declared: the numbered window routes stay reachable (documented as residual)',
      RESIDUAL_ROUTES.every((r) => reached(g, r, 'fetch') && arrivedFrom('guarded-nothing', r, 'fetch')),
    ])
  }
  if (has('guarded-network')) {
    const g = run('guarded-network').report
    const ws = windows(g).filter(([route]) => !RESIDUAL_ROUTES.includes(route))
    rows.push([
      'network declared: network features work from the window routes and the server sees them',
      ['direct', 'window', 'timerThis', 'eventTargetOnWindow', 'defaultView'].every((route) => ['fetch', 'xhr', 'websocket', 'beacon', 'eventsource'].every((f) => reached(g, route, f) && arrivedFrom('guarded-network', route, f))),
    ])
    rows.push([
      'network declared: storage, cookie, worker and window features stay hidden',
      ws.every(([route]) => [...STORAGE, ...COOKIES, 'open', 'worker', 'sharedworker', 'serviceworker', ...(route === 'direct' ? [] : ['eval', 'function'])].every((f) => !reached(g, route, f))),
    ])
  }
  if (has('guarded-storage-cookies')) {
    const g = run('guarded-storage-cookies').report
    const ws = windows(g).filter(([route]) => !RESIDUAL_ROUTES.includes(route))
    rows.push([
      'storage and cookies declared: those features work from the window routes',
      ['direct', 'window', 'timerThis', 'eventTargetOnWindow', 'defaultView'].every((route) => [...STORAGE, ...COOKIES].every((f) => reached(g, route, f))),
    ])
    rows.push([
      'storage and cookies declared: network features stay hidden and the server sees none of them',
      ws.every(([route]) => NETWORK.every((f) => !reached(g, route, f))) &&
        ![...run('guarded-storage-cookies').arrived].some((v) => ws.some(([route]) => v.startsWith(`${route}.`))),
    ])
  }
  for (const key of GUARDED) {
    const p = run(key).page
    rows.push([
      `page (${key}): its own fetch is native, and storage, cookie, eval, Function, string timers, frames and new iframes all work`,
      Boolean(p) && p.fetchIsNative === true && p.localStorage === '1' && p.sessionStorage === '1' && p.cookie === true && p.eval === 2 && p.Function === 2 &&
        p.functionConstructorOfFunction === true && p.functionConstructorRuns === 3 && p.asyncFunctionConstructorName === 'AsyncFunction' &&
        p.elementConstructorChainRuns === 4 && p.eventTargetConstructor === 'function' &&
        p.stringTimerRan === 'ran' && p.contentWindowOfNewFrame === 'function' && p.open === 'function' && p.worker === 'function' && p.serviceWorker === 'object',
    ])
  }

  verdict(rows)
} finally {
  server.close()
  rdp.close()
}
