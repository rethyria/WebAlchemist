/**
 * W9 — editing a description re-enters the flow where the description was set.
 *
 * What this run can check is the part that needed new plumbing: the describing
 * step draws the element tree, and until now `context-for-anchor` did not
 * return one, so re-entering that step from a stored anchor would have shown an
 * empty list.
 *
 * What it cannot check is the flow state itself. Driving `editIntent` means
 * clicking a button in the sidebar, and `sidebarAction.open()` needs a live user
 * gesture that a script does not have. The step it lands on and the pre-filled
 * sentence are therefore UNEXERCISED here.
 */
import { open, verdict } from '../crypto/rdp.mjs'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rdp = open(); const ctx = await rdp.contexts({ waitMs: 3000 }); const B = ctx.background
const ID = 'wa-intent-probe'
const INTENT = 'Make the main heading bright green and very widely spaced.'

console.log('seed:', await B.run(`(async () => {
  const s = await browser.storage.local.get('transforms')
  const keep = (s.transforms || []).filter(t => t.id !== ${JSON.stringify(ID)})
  keep.push({ id: ${JSON.stringify(ID)}, name: 'Intent probe', enabled: true, order: 5,
    match: 'example.com/*', kind: 'css', origin: 'ai', capabilities: [],
    intent: ${JSON.stringify(INTENT)},
    rationale: { targets: 'the h1', approach: 'colours it', assumptions: ['there is an h1'] },
    anchor: { tag: 'h1', classes: [], path: 'body > div > h1', landmarks: ['body'], selector: 'h1' },
    code: 'h1 { color: green }', createdAt: 111, updatedAt: 222 })
  await browser.storage.local.set({ transforms: keep })
  return 'seeded'
})()`))

const tab = Number(await B.run(`browser.tabs.create({ url: 'https://example.com/', active: true }).then(t => t.id)`))
await sleep(5000)

const answer = await B.long(`browser.tabs.sendMessage(${tab}, { type: 'context-for-anchor', anchor: {
  tag: 'h1', classes: [], path: 'body > div > h1', landmarks: ['body'], selector: 'h1' }
}).then(r => JSON.stringify({ hasTree: Array.isArray(r?.tree), rows: r?.tree?.length ?? 0,
  selector: r?.context?.target?.selector,
  labels: (r?.tree ?? []).slice(0, 6).map(x => x.label ?? x.selector ?? '?') }), e => 'ERR ' + e.message)`)
console.log('context-for-anchor:', answer)

await ctx.refresh()
const S = ctx.find('src/sidebar')
let flowState = '(sidebar not open)'
if (S) {
  flowState = await S.long(`(async () => {
    // Drive the real component the way the row's button does.
    const app = document.querySelector('main, .panel')
    return 'sidebar present'
  })()`)
}
console.log('sidebar:', flowState)

console.log('cleanup:', await B.run(`(async () => {
  const s = await browser.storage.local.get('transforms')
  await browser.storage.local.set({ transforms: (s.transforms||[]).filter(t => t.id !== ${JSON.stringify(ID)}) })
  await browser.tabs.remove(${tab}).catch(()=>{})
  return 'removed' })()`))

const d = answer.startsWith('{') ? JSON.parse(answer) : null
verdict([
  /*
   * Not `=== 'h1'`. context-for-anchor recaptures the anchor deliberately, so
   * it answers with a freshly derived selector rather than the one it was
   * given. Resolving to the right element is what matters, and the tree
   * containing that element is how it shows.
   */
  [`control  the anchor resolved to the heading (${d?.selector})`,
    (d?.selector ?? '').endsWith('h1')],
  [`control  the tree names the element it resolved (${d?.labels})`,
    (d?.labels ?? []).includes('h1')],
  ['test     context-for-anchor now returns a tree', d?.hasTree === true],
  [`test     the tree has rows to draw (${d?.rows})`, (d?.rows ?? 0) > 1],
  ['UNEXERCISED  the step it lands on and the pre-filled sentence — the sidebar\n              cannot be opened without a user gesture', true],
])
rdp.close()
