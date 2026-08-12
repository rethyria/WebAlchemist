/**
 * Suspend and resume, and the anchor that resolves to nothing.
 *
 * Editing a transform with the AI takes the saved copy off the page for the
 * duration, because a preview and the saved copy are injected the same way — so
 * leaving it on would let a rule the new version removed keep applying
 * underneath. That is a preview that lies in exactly the direction that
 * matters, which is why this is checked rather than assumed.
 *
 * Moved into the repo from /tmp, and changed in one way: it used to require an
 * open sidebar and printed SIDEBAR NOT OPEN otherwise, which made it
 * unrunnable in a scripted sweep. `runtime.connect`/`sendMessage` from the
 * background does not reach the background's own listener, so the message has
 * to come from another extension context — and the options page is one.
 */
import { open, uniqueUrl, verdict } from '../crypto/rdp.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rdp = open()
const ctx = await rdp.contexts({ waitMs: 3000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  process.exit(1)
}

const ID = 'wa-suspend-probe'
const PAGE = uniqueUrl('https://example.com/', 'suspend')
let pageTab = -1
let optionsTab = -1
const results = {}

try {
  /*
   * A unique URL, not a bare hostname. This profile already had two
   * example.com tabs open, so looking one up by hostname found the user's
   * rather than the one this run created — the probe styled its own tab and
   * measured a different one, and reported the transform as never applying.
   */
  pageTab = Number(
    await B.run(`browser.tabs.create({ url: ${JSON.stringify(PAGE)}, active: false }).then(t => t.id)`),
  )

  console.log('seed:', await B.run(`(async () => {
    const store = await browser.storage.local.get('transforms')
    const all = (store.transforms || []).filter(t => t.id !== ${JSON.stringify(ID)})
    all.push({ id: ${JSON.stringify(ID)}, name: 'Suspend probe', enabled: true, order: Date.now(),
      match: 'example.com/*', kind: 'css', origin: 'manual', capabilities: [],
      intent: 'A probe.', rationale: { targets: 'h1', approach: 'letter-spacing', assumptions: [] },
      anchor: { tag: 'h1', classes: [], path: 'body > div > h1', landmarks: ['body'], selector: 'h1' },
      code: 'h1 { letter-spacing: 7px }', createdAt: Date.now(), updatedAt: Date.now() })
    await browser.storage.local.set({ transforms: all })
    return 'seeded'
  })()`))

  const optionsUrl = `${ctx.baseUrl()}src/options/index.html`
  optionsTab = Number(
    await B.run(`browser.tabs.create({ url: ${JSON.stringify(optionsUrl)}, active: false }).then(t => t.id)`),
  )
  let O = null
  for (let i = 0; i < 15; i += 1) {
    await sleep(800)
    await ctx.refresh()
    O = ctx.find('src/options/index.html')
    if (O && (await O.raw('typeof browser')) === 'object') break
    O = null
  }
  if (!O) throw new Error('options page never appeared')

  await B.run(`browser.tabs.reload(${pageTab}).then(() => 'reloaded')`)
  await sleep(4000)

  const W = await ctx.tab('wa-probe=suspend')
  const spacing = () =>
    W ? W.raw(`getComputedStyle(document.querySelector('h1')).letterSpacing`) : '(no page)'

  results.applied = await spacing()

  const suspend = (id) =>
    O.run(`browser.runtime.sendMessage({ type: 'suspend-transform', tabId: ${pageTab},
      id: ${id === null ? 'null' : JSON.stringify(id)} }).then(r => JSON.stringify(r), e => 'ERR ' + e.message)`)

  console.log('\nsuspend :', await suspend(ID))
  await sleep(900)
  results.whileSuspended = await spacing()

  console.log('resume  :', await suspend(null))
  await sleep(900)
  results.afterResume = await spacing()

  console.log('\nletter-spacing on h1')
  console.log('  applied        :', results.applied)
  console.log('  while suspended:', results.whileSuspended)
  console.log('  after resume   :', results.afterResume)

  /* The other half: an anchor that resolves to nothing must say so. */
  results.missing = await B.long(`browser.tabs.sendMessage(${pageTab}, { type: 'context-for-anchor', anchor: {
    tag: 'nosuchtag', classes: ['nope'], path: 'body > nosuchtag', landmarks: [], selector: 'nosuchtag.nope'
  } }).then(r => JSON.stringify(r), e => 'ERR ' + e.message)`)
  console.log('\nanchor that resolves to nothing:', results.missing)
} finally {
  console.log('\ncleanup:', await B.run(`(async () => {
    const store = await browser.storage.local.get('transforms')
    await browser.storage.local.set({ transforms: (store.transforms || []).filter(t => t.id !== ${JSON.stringify(ID)}) })
    await Promise.all([${pageTab}, ${optionsTab}].filter(id => id > 0)
      .map(id => browser.tabs.remove(id).catch(() => {})))
    return 'removed'
  })()`))
}

verdict([
  [`control  the transform is applied to begin with (${results.applied})`, results.applied === '7px'],
  [`test     suspending takes it off the page (${results.whileSuspended})`, results.whileSuspended !== '7px'],
  [`test     resuming puts it back (${results.afterResume})`, results.afterResume === '7px'],
  [`control  an anchor that resolves to nothing returns null (${results.missing})`,
    results.missing === 'null'],
])

rdp.close()
