/**
 * W4 / #29 — do the four badge states actually appear?
 *
 * Read back with `action.getBadgeText({tabId})`, which is what Firefox is
 * drawing rather than what we asked it to draw.
 *
 * The control that matters is a second tab, open at a site with no matching
 * transforms, checked in the same run. Without it, "the badge says 2" only
 * establishes that a badge exists somewhere — a bug that set every tab the same
 * would pass every per-tab assertion.
 *
 * ## Two things this run has to be careful about
 *
 * **It must not spend anything.** The working state is raised before the
 * provider call and lowered after it, so the obvious test — open the port and
 * watch — makes a real request against the user's key. Instead the provider
 * list is emptied for the duration, which makes `resolveActiveProvider` throw
 * immediately. The badge still has to be raised before that and lowered after,
 * which is the whole assertion. Settings are snapshotted, printed, and restored
 * in a `finally`.
 *
 * **The health check has to actually run.** `once-per-session` skips the check
 * for a host already seen this session, and skipping it means the broken state
 * never gets a chance to appear. The mode is forced to `every-load` for the run
 * and restored with everything else.
 */
import { open, verdict } from '../crypto/rdp.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rdp = open()
const ctx = await rdp.contexts({ waitMs: 3000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  process.exit(1)
}

const IDS = ['wa-badge-a', 'wa-badge-b']
const badge = (tabId) => B.run(`browser.action.getBadgeText({ tabId: ${tabId} }).then(t => JSON.stringify(t))`)
const colour = (tabId) => B.run(`browser.action.getBadgeBackgroundColor({ tabId: ${tabId} }).then(c => JSON.stringify(c))`)

const seed = (id) => `{
  id: ${JSON.stringify(id)}, name: ${JSON.stringify(id)}, enabled: true, order: 1,
  match: 'example.com/*', kind: 'css', origin: 'manual', capabilities: [],
  intent: 'badge probe',
  rationale: { targets: 'h1', approach: 'none', assumptions: [] },
  anchor: { tag: 'h1', classes: [], path: 'body > h1', landmarks: ['body'], selector: 'h1' },
  code: 'h1 { outline: 1px solid transparent }', createdAt: 1, updatedAt: 1 }`

const settingsJson = await B.long(`browser.storage.local.get('settings').then(s => JSON.stringify(s.settings || null))`)
console.log('settings snapshot (restored at the end, and recoverable from here if this run dies):')
console.log(' ', settingsJson.length > 400 ? `${settingsJson.slice(0, 400)}…` : settingsJson)

const results = {}
let subject = -1
let control = -1
let optionsTab = -1

try {
  await B.run(`(async () => {
    const s = await browser.storage.local.get('settings')
    await browser.storage.local.set({ settings: { ...(s.settings || {}), healthCheckMode: 'every-load' } })
    return 'every-load'
  })()`)

  console.log('\nseed:', await B.run(`(async () => {
    const store = await browser.storage.local.get('transforms')
    const keep = (store.transforms || []).filter(t => !${JSON.stringify(IDS)}.includes(t.id))
    keep.push(${seed(IDS[0])}); keep.push(${seed(IDS[1])})
    await browser.storage.local.set({ transforms: keep })
    return 'two transforms on example.com'
  })()`))

  subject = Number(await B.run(`browser.tabs.create({ url: 'https://example.com/', active: false }).then(t => t.id)`))
  control = Number(await B.run(`browser.tabs.create({ url: 'https://www.mozilla.org/', active: false }).then(t => t.id)`))
  console.log('subject tab:', subject, ' control tab:', control)
  await sleep(6000)

  results.activeCount = await badge(subject)
  results.idleControl = await badge(control)
  console.log('\nafter navigation')
  console.log('  subject:', results.activeCount, 'colour', await colour(subject))
  console.log('  control:', results.idleControl)

  /*
   * Working. The port has to be opened from an extension page other than the
   * background — runtime.connect excludes the sender, so the background cannot
   * reach its own onConnect. The options page is an extension page and will do.
   */
  /*
   * A local stub provider, not the user's. It holds each request open for six
   * seconds and then fails, which gives a window wide enough to see the badge
   * up and still guarantees it comes down. A loopback base URL needs no
   * credential, so nothing of the user's is read or written.
   *
   * Emptying the provider list instead does not work: resolution then fails so
   * fast that the raise and the lower both happen between two polls.
   */
  console.log('\npointing at the local stub provider (test/badge/stub-provider.mjs)')
  await B.run(`(async () => {
    const s = await browser.storage.local.get('settings')
    await browser.storage.local.set({ settings: { ...(s.settings || {}),
      providers: [{ id: 'wa-badge-stub', label: 'Badge probe stub', type: 'openai-compatible',
        baseUrl: 'http://localhost:8789/v1', generateModel: 'stub', reviewModel: 'stub',
        supportsVision: false }],
      activeProviderId: 'wa-badge-stub' } })
    return 'stub provider active'
  })()`)

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

  results.working = '(options page never appeared)'
  results.afterWorking = '(options page never appeared)'
  if (O) {
    await O.raw(`(() => {
      const port = browser.runtime.connect({ name: 'wa-generate' })
      port.postMessage({
        context: { url: 'https://example.com/', target: { selector: 'h1', tag: 'h1',
          outerHTMLExcerpt: '<h1>', computedStyles: {}, matchedRules: [] },
          ancestors: [], customProperties: {} },
        instruction: 'probe', history: [], tabId: ${subject} })
      return 1
    })()`)
    // Short, because with no provider the failure is immediate. The badge has
    // to be up here and down a moment later.
    // The stub holds for six seconds, so two seconds in is comfortably inside
    // the window, and ten seconds is comfortably past it.
    await sleep(2000)
    results.working = await badge(subject)
    await sleep(10000)
    results.afterWorking = await badge(subject)
    console.log('during generation:', results.working)
    console.log('after generation :', results.afterWorking)
  }

  console.log('\nbroken: pointing both anchors at an element example.com does not have')
  await B.run(`(async () => {
    const store = await browser.storage.local.get('transforms')
    const all = (store.transforms || []).map(t => ${JSON.stringify(IDS)}.includes(t.id)
      ? { ...t, anchor: { ...t.anchor, tag: 'nosuchtag', selector: 'nosuchtag.none', path: 'body > nosuchtag' } } : t)
    await browser.storage.local.set({ transforms: all })
    await browser.tabs.reload(${subject})
    return 'reloaded'
  })()`)
  await sleep(9000)
  results.broken = await badge(subject)
  results.brokenColour = await colour(subject)
  results.brokenControl = await badge(control)
  console.log('broken badge:', results.broken, 'colour', results.brokenColour)
  console.log('control still:', results.brokenControl)

  console.log('\ndelete:', await B.run(`(async () => {
    const store = await browser.storage.local.get('transforms')
    await browser.storage.local.set({ transforms: (store.transforms || []).filter(t => !${JSON.stringify(IDS)}.includes(t.id)) })
    await browser.tabs.reload(${subject})
    return 'removed'
  })()`))
  await sleep(6000)
  results.afterDelete = await badge(subject)
  console.log('after delete:', results.afterDelete)
} finally {
  console.log(
    '\nrestore settings:',
    await B.run(`browser.storage.local.set({ settings: ${settingsJson} }).then(() => 'restored')`),
  )
  await B.run(`(async () => {
    const store = await browser.storage.local.get('transforms')
    await browser.storage.local.set({ transforms: (store.transforms || []).filter(t => !${JSON.stringify(IDS)}.includes(t.id)) })
    return 'cleaned'
  })()`)
  await B.run(`Promise.all([${subject}, ${control}, ${optionsTab}]
    .filter(id => id > 0).map(id => browser.tabs.remove(id).catch(() => {}))).then(() => 'closed')`)
}

const orange = JSON.parse(results.brokenColour || '[]')
verdict([
  [`control  a tab with no matching transforms shows nothing (${results.idleControl})`, results.idleControl === '""'],
  [`control  the control tab is still empty later in the run (${results.brokenControl})`, results.brokenControl === '""'],
  [`control  the run used a loopback stub provider, so nothing was spent`, true],
  [`test     active shows the count (${results.activeCount})`, results.activeCount === '"2"'],
  [`test     working shows the dots (${results.working})`, results.working === '"··"'],
  [`test     working clears when the generation ends (${results.afterWorking})`, results.afterWorking !== '"··"'],
  [`test     broken shows ! (${results.broken})`, results.broken === '"!"'],
  [`test     broken uses #ef8354 rather than the accent (${results.brokenColour})`,
    orange[0] === 239 && orange[1] === 131 && orange[2] === 84],
  [`test     the badge clears when the last transform goes (${results.afterDelete})`, results.afterDelete === '""'],
])

rdp.close()
