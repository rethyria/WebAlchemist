/**
 * #139 -- do requests made by stylesheet text and by iframe src reach the server
 * from a transform that declared nothing, and does wrapping the world's view of
 * the style text paths close them without changing the page?
 *
 * styles-code.mjs puts CSS that loads an address into the document by 60 paths:
 * the text of a style element, markup that holds a style element, the text of a
 * sheet (insertRule, replace, replaceSync, adoptedStyleSheets), and the
 * declarations of a rule. The server records which addresses were requested.
 *
 * Configurations, on /page-style, all with nothing declared:
 *
 *   baseline           no guard. Every path must request its address, except the
 *                      two inline-style paths, which the world's CSP refuses.
 *   guard, no text check   the guard without the style wrappers.
 *   guard with text check  the guard with them.
 *   guard with text check, network declared   the same with `network` declared.
 *
 * After each run the page itself runs the same 60 paths from its own context,
 * under other addresses, and each of them must still request its address.
 */
import { verdict } from '../crypto/rdp.mjs'
import { startServer } from './server.mjs'
import { connectWorld } from './world.mjs'
import { styleMeasure } from './styles-code.mjs'
import { runtimeGuardSource } from '../../src/background/runtime-guard.ts'

const PAGE_ATTRIBUTE = 'data-wa-rg-page'
const server = await startServer()
const world = await connectWorld()
const runs = {}

const CONFIGS = [
  { key: 'baseline', guard: false, capabilities: [] },
  { key: 'guard, no text check', guard: true, capabilities: [], options: { blockStyleText: false } },
  { key: 'guard with text check', guard: true, capabilities: [], options: { blockStyleText: true } },
  { key: 'guard with text check, network declared', guard: true, capabilities: ['network'], options: { blockStyleText: true }, network: true },
]
const csp = (network) => ["default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", network ? 'connect-src https:' : "connect-src 'none'", network ? 'img-src *' : "img-src 'none'"].join('; ')
const arrivedFor = (arrived, tag) => [...arrived].some((v) => v === tag || v.startsWith(tag))

try {
  for (const config of CONFIGS) {
    server.reset()
    const guard = config.guard ? `globalThis.__t0 = performance.now();\n${runtimeGuardSource(config.capabilities, 'data-wa-err-probe', config.options)}\nglobalThis.__guardMs = performance.now() - globalThis.__t0;\n` : ''
    const after = `async () => { await (${styleMeasure('', 'p', PAGE_ATTRIBUTE)}); return JSON.parse(document.documentElement.getAttribute(${JSON.stringify(PAGE_ATTRIBUTE)})) }`
    const { report, page } = await world.run({ code: guard + styleMeasure('', 's'), csp: csp(config.network), pagePath: '/page-style', after, settleMs: 2500 })
    runs[config.key] = { report, page, arrived: new Set(server.arrived) }
    console.log(`\n=== ${config.key} ===`)
    const row = (group, name, result, prefix) => console.log(`  ${(group + ': ' + name).padEnd(52)} ${result.slice(0, 60).padEnd(60)} ${arrivedFor(server.arrived, `${prefix}_${group === 'forms' ? 'f_' : ''}${name}`) ? 'REQUEST ARRIVED' : 'no request'}`)
    for (const [name, result] of Object.entries(report?.routes ?? {})) row('routes', name, result, 's')
    for (const [name, result] of Object.entries(report?.forms ?? {})) row('forms', name, result, 's')
    console.log(`  time to run the guard in this world: ${report?.guardMs === null ? 'none' : report?.guardMs.toFixed(2) + ' ms'}`)
    console.log('  the page, from its own context:')
    for (const [name, result] of Object.entries(page?.routes ?? {})) console.log(`    ${name.padEnd(44)} ${result.slice(0, 40).padEnd(40)} ${arrivedFor(server.arrived, `p_${name}`) ? 'request arrived' : 'no request'}`)
    for (const [name, result] of Object.entries(page?.forms ?? {})) console.log(`    forms: ${name.padEnd(36)} ${result.slice(0, 40).padEnd(40)} ${arrivedFor(server.arrived, `p_f_${name}`) ? 'request arrived' : 'no request'}`)
  }
  verdict(buildRows(runs))
} finally {
  world.close()
  server.close()
}

function buildRows(runs) {
  const rows = []
  const run = (k) => runs[k] ?? {}
  const arrived = (k, tag) => Boolean(run(k).arrived) && arrivedFor(run(k).arrived, tag)
  const pagePaths = Object.keys(run('baseline').page?.routes ?? {})
  const routes = Object.keys(run('baseline').report?.routes ?? {})
  const forms = Object.keys(run('baseline').report?.forms ?? {})
  // Paths that send no request even with no guard, so they cannot show a refusal: the inline style paths are
  // refused by the world's CSP, two forms hold no address, and three routes did not make a request in this
  // browser (the descriptor of @font-face is read-only, a nested rule had nothing to load, and an editing
  // command did not insert the text).
  const NO_REQUEST = new Set(['i_inline_style_cssText', 'i_inline_style_setAttribute', 'd_fontface_descriptor_src', 'd_fontface_setProperty_src', 'd_page_rule_or_nested', 'x_execCommand_insertText'])
  const NO_ADDRESS = new Set(['data_url_only', 'plain_rule'])
  const loads = [...routes.filter((n) => !NO_REQUEST.has(n)).map((n) => ['routes', n, `s_${n}`]), ...forms.filter((n) => !NO_ADDRESS.has(n)).map((n) => ['forms', n, `s_f_${n}`])]
  const refusedIn = (k, group, name) => run(k).report?.[group]?.[name]?.startsWith('refused (Error: Web Alchemist')

  rows.push(['control (baseline): the measuring code reported, for the world and for the page', Boolean(run('baseline').report) && Boolean(run('baseline').page)])
  const missing = loads.filter(([, , tag]) => !arrived('baseline', tag)).map(([g, n]) => `${g}:${n}`)
  if (missing.length) console.log('\nwithout a request in the baseline:', missing.join(' '))
  rows.push([`control (baseline): every one of the ${loads.length} paths that loads an address requests it`, missing.length === 0])
  rows.push(['control (baseline): the inline style paths are refused by the world CSP, so no request arrives', [...NO_REQUEST].filter((n) => n.startsWith('i_')).every((n) => !arrived('baseline', `s_${n}`))])
  rows.push(['control (baseline): the forms with a data address or no address send no request', [...NO_ADDRESS].every((n) => !arrived('baseline', `s_f_${n}`))])
  const pageLoads = (k) => pagePaths.filter((n) => !NO_REQUEST.has(n)).every((n) => arrivedFor(run(k).arrived ?? new Set(), `p_${n}`))
  rows.push(['control (baseline): the page itself, from its own context, makes the same requests by the same paths', pageLoads('baseline')])
  rows.push(['control (baseline): the code that puts an address in a sheet raised no error on any path that loads one', loads.every(([g, n]) => run('baseline').report?.[g]?.[n] === 'no error')])

  const open = loads.filter(([, , tag]) => arrived('guard, no text check', tag))
  rows.push([`guard without the text check: the same ${loads.length} paths request their addresses (${open.length} did)`, open.length === loads.length])
  rows.push(['guard without the text check: the page makes its requests', pageLoads('guard, no text check')])

  const g = 'guard with text check'
  const stillOpen = loads.filter(([, , tag]) => arrived(g, tag)).map(([grp, n]) => `${grp}:${n}`)
  if (stillOpen.length) console.log('\nstill requesting with the text check:', stillOpen.join(' '))
  rows.push([`${g}: none of the ${loads.length} paths requests its address`, stillOpen.length === 0])
  const notRefused = loads.filter(([grp, n]) => !refusedIn(g, grp, n)).map(([grp, n]) => `${grp}:${n}`)
  if (notRefused.length) console.log('\nnot refused with an error:', notRefused.join(' '))
  rows.push([`${g}: each of them was refused with the guard's error`, notRefused.length === 0])
  rows.push([`${g}: a rule that holds no address is accepted (control for the check)`, run(g).report?.forms?.plain_rule === 'no error'])
  rows.push([`${g}: the inline style set with setAttribute is not touched and is still stopped only by the world's CSP`, run(g).report?.routes?.i_inline_style_setAttribute === 'no error' && !arrived(g, 's_i_inline_style_setAttribute')])
  rows.push([`${g}: the page makes its requests by every path`, pageLoads(g)])

  const n = 'guard with text check, network declared'
  rows.push([`${n}: the paths request their addresses again, so the check is a refusal of undeclared addresses and not a general block`, loads.every(([, , tag]) => arrived(n, tag))])
  rows.push([`${n}: the page makes its requests`, pageLoads(n)])
  return rows
}
