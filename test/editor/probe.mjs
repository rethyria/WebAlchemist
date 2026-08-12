/**
 * The editor page, end to end.
 *
 * Moved into the repo from /tmp and repaired on the way. It read the match
 * pattern from `.facts code`, which stopped existing when the pattern became
 * editable in `8a5e820` — so the assertion had been failing against a page that
 * was working. A stale harness reporting a regression that is not there is
 * worse than no harness, because the next person spends an hour on it.
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

/*
 * A transform of our own, so the run cannot disturb a real one. CSS, so the
 * saved code can be checked by looking at what the page ends up styled with.
 */
const ID = 'wa-editor-probe'
console.log('seed:', await B.run(`(async () => {
  const store = await browser.storage.local.get('transforms')
  const all = (store.transforms || []).filter(t => t.id !== ${JSON.stringify(ID)})
  all.push({ id: ${JSON.stringify(ID)}, name: 'Editor probe', enabled: true, order: Date.now(),
    match: 'example.com/*', kind: 'css', origin: 'manual', capabilities: [],
    intent: 'A probe for the editor page.',
    rationale: { targets: 'body', approach: 'sets a border', assumptions: [] },
    anchor: { tag: 'body', classes: [], path: 'body', landmarks: ['body'], selector: 'body' },
    code: 'body { border-top: 3px solid red }', createdAt: Date.now(), updatedAt: Date.now() })
  await browser.storage.local.set({ transforms: all })
  return 'seeded'
})()`))

async function openEditor(query) {
  const url = `${ctx.baseUrl()}src/editor/index.html?${query}`
  const tab = Number(
    await B.run(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: false }).then(t => t.id)`),
  )
  for (let i = 0; i < 20; i += 1) {
    await sleep(900)
    await ctx.refresh()
    const page = ctx.find('src/editor/index.html')
    if (page && (await page.raw(`document.querySelector('textarea') ? 'yes' : 'no'`)) === 'yes') {
      return { tab, page }
    }
  }
  return { tab, page: null }
}

const opened = await openEditor(`id=${ID}`)
let editorTab = opened.tab
if (!opened.page) {
  console.log('EDITOR PAGE NEVER APPEARED')
  rdp.close()
  process.exit(1)
}
const E = opened.page

const rendered = JSON.parse(await E.long(`JSON.stringify({
  title: document.querySelector('h1')?.textContent,
  intent: document.querySelector('.intent')?.textContent,
  kind: document.querySelector('.badge')?.textContent,
  // The pattern is an editable field now, not a static line.
  match: document.querySelector('.where input')?.value,
  lines: document.querySelectorAll('.gutter span').length,
  coloured: [...document.querySelectorAll('.painted span')].map(s => s.className.split(' ')[0] + ':' + s.textContent).slice(0, 8),
  textareaValue: document.querySelector('textarea')?.value,
  // The two layers must agree character for character or they slide apart.
  paintedText: [...document.querySelectorAll('.painted span')].map(s => s.textContent).join(''),
})`))
console.log('\nheading   :', rendered.title, '|', rendered.kind, '|', rendered.match)
console.log('intent    :', rendered.intent)
console.log('lines     :', rendered.lines)
console.log('colouring :', rendered.coloured.join('  '))

const typed = 'body { border-top: 8px solid green; /* edited */ }'
console.log('\nedit + save:', await E.run(`(async () => {
  const area = document.querySelector('textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(area, ${JSON.stringify(typed)})
  area.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 150))
  const save = [...document.querySelectorAll('button')].find(b => /^save$/i.test(b.textContent.trim()))
  if (!save) return 'no save button'
  if (save.disabled) return 'save button disabled after typing'
  save.click()
  await new Promise(r => setTimeout(r, 1200))
  const note = document.querySelector('.note')?.textContent?.trim() ?? '(no note)'
  const problem = document.querySelector('.findings')?.textContent?.replace(/\\s+/g, ' ').trim()
  return problem ? note + ' | ' + problem : note
})()`))

const stored = await B.long(`browser.storage.local.get('transforms').then(s =>
  (s.transforms || []).find(t => t.id === ${JSON.stringify(ID)})?.code ?? '(gone)')`)
console.log('stored code:', stored)

const afterSave = JSON.parse(await E.raw(`JSON.stringify({
  saveDisabled: [...document.querySelectorAll('button')].find(b => /^save$/i.test(b.textContent.trim()))?.disabled,
})`))

/* A JS transform with a blocking API must be refused, with the finding shown. */
console.log('\nswitch the probe to js:', await B.run(`(async () => {
  const store = await browser.storage.local.get('transforms')
  const all = (store.transforms || []).map(t => t.id === ${JSON.stringify(ID)}
    ? { ...t, kind: 'js', code: 'document.title = "x"' } : t)
  await browser.storage.local.set({ transforms: all })
  return 'switched'
})()`))

await B.run(`browser.tabs.remove(${editorTab}).catch(() => {}).then(() => 'closed')`)
const reopened = await openEditor(`id=${ID}`)
editorTab = reopened.tab
const refused = reopened.page
  ? await reopened.page.run(`(async () => {
      const area = document.querySelector('textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(area, 'eval("2+2")')
      area.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 150))
      const save = [...document.querySelectorAll('button')].find(b => /^save/i.test(b.textContent.trim()))
      save.click()
      await new Promise(r => setTimeout(r, 1500))
      return (document.querySelector('.findings')?.textContent ?? '(no findings shown)').replace(/\\s+/g, ' ').slice(0, 160)
    })()`)
  : '(editor did not reopen)'
console.log('eval() refused with:', refused)

const stillJs = await B.long(`browser.storage.local.get('transforms').then(s =>
  (s.transforms || []).find(t => t.id === ${JSON.stringify(ID)})?.code ?? '(gone)')`)

console.log('\ncleanup:', await B.run(`(async () => {
  const store = await browser.storage.local.get('transforms')
  await browser.storage.local.set({ transforms: (store.transforms || []).filter(t => t.id !== ${JSON.stringify(ID)}) })
  await browser.tabs.remove(${editorTab}).catch(() => {})
  return 'removed'
})()`))

verdict([
  [`test     the page loads the transform by id (${rendered.title})`, rendered.title === 'Editor probe'],
  [`test     it shows what is being edited (${rendered.kind}, ${rendered.match})`,
    rendered.kind === 'CSS' && rendered.match === 'example.com/*'],
  [`test     the code is coloured, not plain (${rendered.coloured.length} runs)`,
    rendered.coloured.some((c) => c.startsWith('property:')) &&
      rendered.coloured.some((c) => c.startsWith('selector:'))],
  [`control  the coloured layer matches the editable one character for character`,
    rendered.paintedText === rendered.textareaValue],
  [`test     line numbers are drawn (${rendered.lines})`, rendered.lines >= 1],
  [`test     typing then Save writes it (${stored})`, stored === typed],
  [`control  Save goes quiet once there is nothing to save (${afterSave.saveDisabled})`,
    afterSave.saveDisabled === true],
  // The copy explains the behaviour rather than naming the API, which is the
  // point of it — so this checks for a blocking finding, not for the word.
  [`test     eval() is refused, with a reason and a line`,
    /not saved/i.test(refused) && /line \d+/i.test(refused)],
  [`control  the refused code was not stored (${stillJs})`, stillJs === 'document.title = "x"'],
])

rdp.close()
