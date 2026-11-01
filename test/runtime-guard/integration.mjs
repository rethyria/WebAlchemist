/**
 * #139 -- the guard in the registration the extension itself makes.
 *
 * probe.mjs runs the guard's source directly. This runs the real path: a
 * transform that passes the static analysis is stored, switched on with the
 * `set-enabled` message from an extension page, registered by the extension,
 * and read back from the browser. Three things are checked, each with a control:
 *
 *   - the registered script holds the guard, and the one declared capability is
 *     left out of it (control: a second transform that declares nothing);
 *   - each transform still runs under the guard, which the page shows by the
 *     attribute or the text that the transform wrote (both would be absent if the
 *     guard had stopped the wrapper);
 *   - the transform that declared `network` reaches the oracle server with fetch.
 *     A transform that declared nothing and passes the analysis has no way to
 *     call fetch, so the refusal of undeclared use is shown by probe.mjs and not here.
 *
 * Needs the host permission for http://localhost/* and the userScripts permission.
 */
import { open, uniqueUrl, verdict, sleep } from '../crypto/rdp.mjs'
import { startServer } from './server.mjs'

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

const IDS = ['wa-rg-e2e-plain', 'wa-rg-e2e-net']
const seed = (id, capabilities, code) => `{
  id: ${JSON.stringify(id)}, name: ${JSON.stringify(id)}, enabled: false, order: 1,
  match: 'localhost/*', kind: 'js', origin: 'manual', world: 'USER_SCRIPT', capabilities: ${JSON.stringify(capabilities)},
  intent: 'runtime guard integration probe',
  rationale: { targets: '#subject', approach: 'none', assumptions: [] },
  anchor: { tag: 'p', classes: [], path: 'body > main > p', landmarks: ['main'], selector: '#subject' },
  code: ${JSON.stringify(code)}, createdAt: 1, updatedAt: 1 }`

// Passes the static analysis. The one with network declared fetches the oracle.
const PLAIN = "document.querySelector('#subject').setAttribute('data-ran-plain', 'yes')"
const NET = "fetch('http://localhost:8791/egress?via=e2e.declared'); document.querySelector('#subject').textContent = 'changed by the network transform'"

const rows = []
let optionsTab = -1
let pageTab = -1
try {
  await B.run(`(async () => {
    const store = await browser.storage.local.get('transforms')
    const keep = (store.transforms || []).filter(t => !${JSON.stringify(IDS)}.includes(t.id))
    keep.push(${seed(IDS[0], [], PLAIN)}); keep.push(${seed(IDS[1], ['network'], NET)})
    await browser.storage.local.set({ transforms: keep })
    return 'seeded'
  })()`)

  const optionsUrl = `${ctx.baseUrl()}src/options/index.html`
  optionsTab = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(optionsUrl)}, active: false }).then(t => t.id)`))
  let O = null
  for (let i = 0; i < 15 && !O; i += 1) {
    await sleep(800)
    await ctx.refresh()
    O = ctx.find('src/options/index.html')
  }
  if (!O) throw new Error('options page did not appear')
  for (const id of IDS) {
    console.log('enable', id, await O.run(`browser.runtime.sendMessage({ type: 'set-enabled', id: ${JSON.stringify(id)}, enabled: true }).then(r => JSON.stringify(r))`))
  }

  const held = JSON.parse(
    await B.long(`browser.userScripts.getScripts({ ids: ${JSON.stringify(IDS)} }).then(list => JSON.stringify(list.map(s => ({ id: s.id, world: s.world, sources: s.js.length, code: s.js[0].code }))))`),
  )
  const byId = Object.fromEntries(held.map((s) => [s.id, s]))
  const hasGuard = (id) => Boolean(byId[id]?.code.includes('could not restrict'))
  const hides = (id, name) => Boolean(byId[id]?.code.includes(`"${name}"`))
  console.log('registered:', held.map((s) => `${s.id} (world ${s.world}, ${s.sources} source, ${s.code.length} characters)`).join('; '))
  rows.push(['control: both transforms are registered', held.length === 2])
  rows.push(['the plain transform is registered with the guard, hiding fetch and localStorage', hasGuard(IDS[0]) && hides(IDS[0], 'fetch') && hides(IDS[0], 'localStorage')])
  rows.push(['the network transform is registered with the guard, which leaves fetch out and still hides localStorage', hasGuard(IDS[1]) && !hides(IDS[1], 'fetch') && hides(IDS[1], 'localStorage')])

  server.reset()
  pageTab = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(uniqueUrl('http://localhost:8791/page', 'rg-e2e'))}, active: true }).then(t => t.id)`))
  let text = ''
  let tab = null
  for (let i = 0; i < 30 && !text.startsWith('changed'); i += 1) {
    await sleep(600)
    tab ??= await ctx.tab('wa-probe=rg-e2e')
    if (tab) text = await tab.run(`document.querySelector('#subject').textContent`)
  }
  await sleep(1500)
  console.log('page text:', text)
  console.log('arrived at the server:', [...server.arrived].join(' ') || '(none)')
  const plainRan = tab ? await tab.run(`document.querySelector('#subject').getAttribute('data-ran-plain')`) : null
  rows.push(['the transform that declared nothing ran under the guard (it set an attribute on the page)', plainRan === 'yes'])
  rows.push(['the transform that declared network ran under the guard (it changed the page text)', text === 'changed by the network transform'])
  rows.push(['the transform that declared network reached the server with fetch', server.arrived.has('e2e.declared')])
  // The error marker would be set on the document element by a guard that failed.
  const marker = tab ? await tab.run(`[...document.documentElement.attributes].filter(a => a.name.startsWith('data-wa-error')).map(a => a.value).join('|') || '(none)'`) : '(no tab)'
  console.log('error marker values:', marker)
  rows.push(['no guard failure was recorded in an error marker', marker === '(none)'])
} finally {
  await B.run(`(async () => {
    const store = await browser.storage.local.get('transforms')
    await browser.storage.local.set({ transforms: (store.transforms || []).filter(t => !${JSON.stringify(IDS)}.includes(t.id)) })
    try { await browser.userScripts.unregister({ ids: ${JSON.stringify(IDS)} }) } catch {}
    ${pageTab > 0 ? `await browser.tabs.remove(${pageTab}).catch(() => {})` : ''}
    ${optionsTab > 0 ? `await browser.tabs.remove(${optionsTab}).catch(() => {})` : ''}
    return 'cleaned'
  })()`)
  const ok = verdict(rows)
  server.close()
  rdp.close()
  process.exit(ok ? 0 : 1)
}
