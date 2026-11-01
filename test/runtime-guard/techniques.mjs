/**
 * #139 -- which way of removing a feature from a USER_SCRIPT world works?
 *
 * Five ways are tried on `fetch` and `localStorage` (a function and an accessor
 * that returns an object), and each is read back by typeof through every route
 * to a window that the issue lists. `none` is the control: with nothing removed
 * every route has both, so a route that reports `-` under another technique is
 * hidden by that technique and not unreachable for some other reason.
 *
 *   none            no change
 *   delete          delete globalThis[name]
 *   assignGlobal    globalThis[name] = undefined
 *   defineGlobal    Object.defineProperty(globalThis, name, throwing getter)
 *   defineWindow    Object.defineProperty(window, name, throwing getter)
 *
 * The first four act on the sandbox's own global. The last acts on the window,
 * which is a separate object (window !== globalThis in this world), and is the
 * technique the guard uses.
 */
import { open, uniqueUrl, verdict, sleep } from '../crypto/rdp.mjs'
import { startServer } from './server.mjs'

const TECHNIQUES = {
  none: '',
  delete: 'delete globalThis[name]',
  assignGlobal: 'globalThis[name] = undefined',
  defineGlobal: "Object.defineProperty(globalThis, name, { get() { throw new Error('removed') }, configurable: false })",
  defineWindow: "Object.defineProperty(window, name, { get() { throw new Error('removed') }, configurable: false })",
}
const NAMES = ['fetch', 'localStorage']

const code = (technique) => `(() => {
  const out = { meta: { windowIsGlobal: window === globalThis }, routes: {} };
  for (const name of ${JSON.stringify(NAMES)}) { try { ${technique} } catch (e) { out.meta['error ' + name] = String(e) } }
  const read = (W) => Object.fromEntries(${JSON.stringify(NAMES)}.map((n) => { try { return [n, typeof W[n] === 'undefined' ? '-' : 'W'] } catch (e) { return [n, '-'] } }));
  const add = (name, thunk) => { try { const W = thunk(); out.routes[name] = W ? read(W) : 'none' } catch (e) { out.routes[name] = 'unreachable' } };
  add('direct', () => globalThis); add('window', () => window); add('self', () => self);
  add('defaultView', () => document.defaultView);
  add('rootNode', () => document.documentElement.getRootNode().defaultView);
  add('top', () => window.top); add('parent', () => window.parent);
  add('wrappedJSObject', () => window.wrappedJSObject);
  const frame = document.createElement('iframe'); document.body.appendChild(frame);
  add('iframeContentWindow', () => frame.contentWindow); add('frames0', () => window.frames[0]);
  let pending = 3;
  const finish = () => { if (--pending === 0) document.documentElement.setAttribute('data-wa-rg', JSON.stringify(out)) };
  setTimeout(function () { const self_ = this; add('timerThis', () => self_); finish() }, 0);
  window.addEventListener('wa-t', (e) => { add('eventTargetOnWindow', () => e.target); finish() });
  window.dispatchEvent(new Event('wa-t'));
  document.addEventListener('wa-u', (e) => { add('eventTargetOnDocument', () => e.target.defaultView); finish() });
  document.dispatchEvent(new Event('wa-u'));
})()`

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

const results = {}
try {
  for (const [key, technique] of Object.entries(TECHNIQUES)) {
    await B.run(`(async () => {
      try { await browser.userScripts.unregister({ ids: ['wa-rg-tech'] }) } catch {}
      await browser.userScripts.configureWorld({ worldId: 'wa-rg-tech', messaging: false,
        csp: "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'" })
      await browser.userScripts.register([{ id: 'wa-rg-tech', matches: ['http://localhost/*'], js: [{ code: ${JSON.stringify(code(technique))} }],
        world: 'USER_SCRIPT', worldId: 'wa-rg-tech', runAt: 'document_idle' }])
      return 'registered'
    })()`)
    const label = `rg-tech-${key}`
    const tabId = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(uniqueUrl('http://localhost:8791/page', label))}, active: false }).then(t => t.id)`))
    let tab = null
    let raw = ''
    for (let i = 0; i < 30 && !raw.startsWith('{'); i += 1) {
      await sleep(500)
      tab ??= await ctx.tab(`wa-probe=${label}`)
      if (tab) raw = await tab.long(`document.documentElement.getAttribute('data-wa-rg') || ''`)
    }
    await B.run(`browser.tabs.remove(${tabId}).catch(() => {})`)
    results[key] = raw.startsWith('{') ? JSON.parse(raw) : null
    console.log(`\n=== ${key} ===`)
    if (!results[key]) {
      console.log('NO REPORT')
      continue
    }
    console.log('window is the global object:', results[key].meta.windowIsGlobal, ' errors:', JSON.stringify(Object.fromEntries(Object.entries(results[key].meta).filter(([k]) => k.startsWith('error')))))
    for (const [route, r] of Object.entries(results[key].routes)) {
      console.log(route.padEnd(24), typeof r === 'string' ? r : NAMES.map((n) => `${n}:${r[n]}`).join('  '))
    }
  }
} finally {
  await B.run(`browser.userScripts.unregister({ ids: ['wa-rg-tech'] }).then(() => 'x', () => 'x')`)
  server.close()
}

const reachable = (key, route, name) => results[key]?.routes?.[route]?.[name] === 'W'
const windowRoutes = ['window', 'self', 'defaultView', 'rootNode', 'top', 'parent', 'timerThis', 'eventTargetOnWindow', 'eventTargetOnDocument']
const otherWindows = ['wrappedJSObject', 'iframeContentWindow', 'frames0']
const rows = [
  ['control (none): every route reaches fetch and localStorage', Object.values(results.none?.routes ?? {}).length >= 12 && Object.values(results.none.routes).every((r) => typeof r === 'object' && r.fetch === 'W' && r.localStorage === 'W')],
  ['control: the world global is not the window', results.none?.meta.windowIsGlobal === false],
  ['delete: nothing is removed from any route', Object.keys(results.delete?.routes ?? {}).length > 0 && Object.entries(results.delete.routes).every(([, r]) => r.fetch === 'W' && r.localStorage === 'W')],
  ['assignGlobal: hides the bare name only; every window route still reaches fetch', !reachable('assignGlobal', 'direct', 'fetch') && windowRoutes.every((r) => reachable('assignGlobal', r, 'fetch'))],
  ['defineGlobal: hides the bare name only; every window route still reaches fetch', !reachable('defineGlobal', 'direct', 'fetch') && windowRoutes.every((r) => reachable('defineGlobal', r, 'fetch'))],
  ['defineWindow: hides every window route and the bare name', ['direct', ...windowRoutes].every((r) => !reachable('defineWindow', r, 'fetch') && !reachable('defineWindow', r, 'localStorage'))],
  ['defineWindow: the page window, a created iframe and frames[0] still reach fetch', otherWindows.every((r) => reachable('defineWindow', r, 'fetch'))],
]
const ok = verdict(rows)
rdp.close()
process.exit(ok ? 0 : 1)
