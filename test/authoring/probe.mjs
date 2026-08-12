/**
 * W8 / #27 — can a transform be written by hand, with no model involved?
 *
 * Drives the real path: a draft is put in session storage the way the sidebar
 * puts one there, the editor page is opened in create mode, code is typed into
 * the real textarea, and Create is clicked. Then the page is read to see
 * whether the CSS actually applied.
 *
 * The control is the JS case: `eval()` must be refused and must not be stored.
 * Without it, "the transform saved" only proves that saving works, not that the
 * gate #27 requires is on the hand-written path at all.
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

const NAME = 'Hand-written probe'
/*
 * Unique, so the tab this run creates is the tab it measures. A bare hostname
 * finds whichever example.com tab the profile already had open — this run
 * passed that way once, by accident, because saving from the editor reapplies
 * to every matching tab including somebody else's.
 */
const PAGE = uniqueUrl('https://example.com/', 'authoring')
const results = {}
let editorTab = -1
let pageTab = -1

/** Opens the editor page and waits until it has rendered. */
async function openEditor(query) {
  const url = `${ctx.baseUrl()}src/editor/index.html?${query}`
  const tab = Number(
    await B.run(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: false }).then(t => t.id)`),
  )
  for (let i = 0; i < 20; i += 1) {
    await sleep(900)
    await ctx.refresh()
    const page = ctx.find('src/editor/index.html')
    if (!page) continue
    const ready = await page.raw(`document.querySelector('textarea') ? 'yes' : 'no'`)
    if (ready === 'yes') return { tab, page }
  }
  return { tab, page: null }
}

try {
  pageTab = Number(
    await B.run(`browser.tabs.create({ url: ${JSON.stringify(PAGE)}, active: false }).then(t => t.id)`),
  )
  await sleep(4000)

  /* The draft the sidebar would have written after a pick. */
  const draftKey = 'probe-draft-1'
  console.log('seed draft:', await B.run(`browser.storage.session.set({ ${JSON.stringify(`wa-draft-${draftKey}`)}: {
    anchor: { tag: 'h1', classes: [], path: 'body > div > h1', landmarks: ['body'], selector: 'h1' },
    match: 'example.com/*',
    target: { label: 'h1' },
    url: 'https://example.com/'
  } }).then(() => 'written')`))

  const created = await openEditor(`draft=${draftKey}`)
  editorTab = created.tab
  if (!created.page) throw new Error('editor page never appeared in create mode')
  const E = created.page

  results.createMode = JSON.parse(
    await E.raw(`JSON.stringify({
      hasNameField: !!document.querySelector('.name-field'),
      kinds: [...document.querySelectorAll('.kind')].map(b => b.textContent.trim()),
      match: document.querySelector('.where input')?.value,
      body: document.querySelector('textarea')?.value,
      saveLabel: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).find(t => /create|save/i.test(t)),
      saveDisabled: [...document.querySelectorAll('button')].find(b => /create|save/i.test(b.textContent.trim()))?.disabled,
    })`),
  )
  console.log('\ncreate mode:', JSON.stringify(results.createMode))

  /* Type a name and some CSS, the way a person would. */
  results.saved = await E.run(`(async () => {
    const setValue = (el, value) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setValue(document.querySelector('.name-field'), ${JSON.stringify(NAME)})
    setValue(document.querySelector('textarea'), 'h1 { letter-spacing: 11px }')
    await new Promise(r => setTimeout(r, 200))
    const create = [...document.querySelectorAll('button')].find(b => /^create$/i.test(b.textContent.trim()))
    if (!create) return 'no Create button'
    if (create.disabled) return 'Create disabled after typing a name and code'
    create.click()
    await new Promise(r => setTimeout(r, 2500))
    return 'clicked'
  })()`)
  // Expect TIMEOUT here: saving a new transform reloads the editor onto the
  // saved id, which destroys the evaluation context mid-call. The checks below
  // are what establish the save landed.
  console.log('create:', results.saved, '(TIMEOUT is expected — the page reloads on create)')
  await sleep(2500)

  results.stored = await B.long(`browser.storage.local.get('transforms').then(s => {
    const t = (s.transforms || []).find(x => x.name === ${JSON.stringify(NAME)})
    return t ? JSON.stringify({ origin: t.origin, kind: t.kind, match: t.match, code: t.code, anchor: t.anchor.selector }) : '(not stored)'
  })`)
  console.log('stored:', results.stored)

  results.draftGone = await B.run(
    `browser.storage.session.get(${JSON.stringify(`wa-draft-${draftKey}`)}).then(s => Object.keys(s).length === 0 ? 'cleared' : 'still there')`,
  )
  console.log('draft after save:', results.draftGone)

  /* Did it reach the page? */
  await B.run(`browser.tabs.reload(${pageTab}).then(() => 'reloaded')`)
  await sleep(4000)
  const W = await ctx.tab('wa-probe=authoring')
  results.applied = W
    ? await W.raw(`getComputedStyle(document.querySelector('h1')).letterSpacing`)
    : '(no page tab)'
  console.log('letter-spacing on the page:', results.applied)

  /* The control: a hand-written JS transform containing eval() must be refused. */
  await B.run(`browser.tabs.remove(${editorTab}).catch(() => {}).then(() => 'closed')`)
  const jsKey = 'probe-draft-2'
  await B.run(`browser.storage.session.set({ ${JSON.stringify(`wa-draft-${jsKey}`)}: {
    anchor: { tag: 'h1', classes: [], path: 'body > div > h1', landmarks: ['body'], selector: 'h1' },
    match: 'example.com/*', target: { label: 'h1' }, url: 'https://example.com/'
  } }).then(() => 'written')`)

  const refusedRun = await openEditor(`draft=${jsKey}`)
  editorTab = refusedRun.tab
  if (!refusedRun.page) throw new Error('editor page never appeared for the JS case')
  const J = refusedRun.page

  results.refused = await J.run(`(async () => {
    const setValue = (el, value) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const js = [...document.querySelectorAll('.kind')].find(b => b.textContent.trim() === 'JS')
    if (!js) return 'no JS option'
    js.click()
    await new Promise(r => setTimeout(r, 100))
    setValue(document.querySelector('.name-field'), 'Refused probe')
    setValue(document.querySelector('textarea'), 'eval("2 + 2")')
    await new Promise(r => setTimeout(r, 200))
    const create = [...document.querySelectorAll('button')].find(b => /^create$/i.test(b.textContent.trim()))
    create.click()
    await new Promise(r => setTimeout(r, 2000))
    return (document.querySelector('.findings')?.textContent ?? '(no findings shown)').replace(/\\s+/g, ' ').slice(0, 160)
  })()`)
  console.log('\neval() refused with:', results.refused)

  results.refusedStored = await B.run(
    `browser.storage.local.get('transforms').then(s => (s.transforms || []).some(t => t.name === 'Refused probe') ? 'STORED' : 'not stored')`,
  )
  console.log('refused transform:', results.refusedStored)
} finally {
  console.log(
    '\ncleanup:',
    await B.run(`(async () => {
      const s = await browser.storage.local.get('transforms')
      await browser.storage.local.set({ transforms: (s.transforms || []).filter(t => t.name !== ${JSON.stringify(NAME)} && t.name !== 'Refused probe') })
      await browser.storage.session.remove(['wa-draft-probe-draft-1', 'wa-draft-probe-draft-2'])
      await Promise.all([${editorTab}, ${pageTab}].filter(id => id > 0).map(id => browser.tabs.remove(id).catch(() => {})))
      return 'removed'
    })()`),
  )
}

const stored = results.stored && results.stored.startsWith('{') ? JSON.parse(results.stored) : null

verdict([
  [`control  the editor opened in create mode, with a kind chooser (${results.createMode?.kinds})`,
    JSON.stringify(results.createMode?.kinds) === '["CSS","JS"]'],
  [`control  Create is refused while the body is empty (${results.createMode?.saveDisabled})`,
    results.createMode?.saveDisabled === true],
  [`control  it starts empty rather than pre-filled (${JSON.stringify(results.createMode?.body)})`,
    results.createMode?.body === ''],
  [`test     the match pattern came from the pick (${results.createMode?.match})`,
    results.createMode?.match === 'example.com/*'],
  [`test     it is stored, and marked as hand-written (${stored?.origin})`, stored?.origin === 'manual'],
  [`test     the code is what was typed (${stored?.code})`, stored?.code === 'h1 { letter-spacing: 11px }'],
  [`test     the anchor from the pick was kept (${stored?.anchor})`, stored?.anchor === 'h1'],
  [`test     the draft was cleared after saving (${results.draftGone})`, results.draftGone === 'cleared'],
  [`test     it actually applies to the page (${results.applied})`, results.applied === '11px'],
  [`test     hand-written eval() is refused, with a reason and a line`,
    /not saved/i.test(results.refused ?? '') && /line \d+/i.test(results.refused ?? '')],
  [`control  the refused code was not stored (${results.refusedStored})`,
    results.refusedStored === 'not stored'],
])

rdp.close()
