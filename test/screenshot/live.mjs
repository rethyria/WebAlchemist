/**
 * #37 end to end with a real model. Drives the real sidebar and picker, uses
 * the provider configured in the development profile, and records the request
 * as the background sent it. See README.md in this directory for the method.
 *
 *   WA_RDP_PORT=<port> RUN=with|without|with-again [DRY=1] node test/screenshot/live.mjs
 */
import { writeFileSync } from 'node:fs'
import { start, sleep, inWindow, trustedClick, trustedDrag, trustedPageClick, assertBudget, record, generateRequestsOf, totals } from '../injection/live-lib.mjs'

const RUN = process.env.RUN ?? 'with'
const DRY = process.env.DRY === '1'
const MODEL = process.env.MODEL ?? 'claude-sonnet-5-5'
const URL_BASE = process.env.URL_BASE ?? 'http://localhost:8795/'
const PICK = process.env.PICK ?? 'badge'
const REGION = process.env.REGION ?? 'art'
const INSTRUCTION = process.env.INSTRUCTION ??
  'Give this badge a 6px solid border and a background colour that match the colour of the largest shape drawn in the picture, and add a caption under the picture, using the badge\'s ::after content, that says the word written in the picture.'

const s = await start()
const { rdp, B } = s
const label = process.env.LABEL ?? `shot-${RUN}`
const needle = `wa-live=${label}-${Date.now()}`
let exit = 0
try {
  await s.B.run(`browser.storage.local.set({ 'wa-disclosure-ack': { version: 999, at: 1 } }).then(() => 'ack set')`)
  await s.parent.run(`(() => { Services.prefs.setBoolPref('extensions.webextOptionalPermissionPrompts', false); return 'prompts off' })()`)
  await s.grant('add', ['http://localhost/*'])
  await B.run(`browser.tabs.query({}).then(ts => Promise.all(ts.filter(t => /localhost:879/.test(t.url)).map(t => browser.tabs.remove(t.id))))`)
  const tab = await s.newTab(`${URL_BASE}?${needle}`)
  await sleep(1500)
  await s.hideSidebar()
  await sleep(500)
  const sb = await s.showSidebar()
  if (!sb) throw new Error('sidebar did not appear')
  await s.setModels(MODEL, MODEL)
  if (!(await s.waitFor(sb, s.hasButton('Choose part of the page to change')))) throw new Error('no Choose part of the page to change: ' + (await s.text()).slice(0, 300))
  await s.hookSidebar()
  await s.hookRequests()

  const rect = JSON.parse(await inWindow(rdp, needle, `const r = w.document.getElementById(${JSON.stringify(REGION)}).getBoundingClientRect(); const b = w.document.getElementById(${JSON.stringify(PICK)}).getBoundingClientRect(); return JSON.stringify({ art: [r.x, r.y, r.right, r.bottom], badge: [b.x, b.y, b.right, b.bottom], dpr: w.devicePixelRatio, iw: w.innerWidth, ih: w.innerHeight })`))
  console.log('geometry', JSON.stringify(rect))
  await s.click('Choose part of the page to change')
  await sleep(1200)
  // A click on the badge's own padding picks the badge.
  await trustedPageClick(rdp, needle, rect.badge[0] + 6, rect.badge[1] + 6)
  if (!(await s.waitFor(sb, `!!document.querySelector('textarea')`))) throw new Error('no describing step: ' + (await s.text()).slice(0, 300))
  console.log('panel after the pick:', (await s.text()).replace(/\s+/g, ' ').slice(0, 300))

  if (RUN !== 'without') {
    await s.click('Add a screenshot')
    await sleep(1200)
    const [x0, y0, x1, y1] = rect.art
    await trustedDrag(rdp, needle, [x0, y0, x1, y1])
    const shown = await s.waitFor(sb, `!!document.querySelector('img.shot')`, 20000)
    if (!shown) throw new Error('no screenshot preview: ' + (await s.text()).slice(0, 300))
    const src = await sb.long(`document.querySelector('img.shot').src`)
    writeFileSync(`/tmp/wa/shots/${label}-preview.png`, Buffer.from(src.replace(/^data:image\/png;base64,/, ''), 'base64'))
    const dims = JSON.parse(await sb.run(`(async () => { const b = await createImageBitmap(await (await fetch(document.querySelector('img.shot').src)).blob()); return JSON.stringify({ w: b.width, h: b.height, len: document.querySelector('img.shot').src.length }) })()`))
    console.log('preview image', JSON.stringify(dims))
    await B.run(`globalThis.__previewLen = ${dims.len}; 1`)
  } else {
    console.log('no screenshot for this run (control)')
  }
  // The instruction goes in through the textarea's own input event.
  await sb.run(`(() => { const t = document.querySelector('textarea'); t.value = ${JSON.stringify(INSTRUCTION)}; t.dispatchEvent(new Event('input', { bubbles: true })); return 'typed' })()`)
  await sleep(500)
  console.log('panel before Brew:', (await s.text()).replace(/\s+/g, ' ').slice(0, 500))
  if (DRY) { console.log('DRY run: stopping before Brew'); }
  else {
    assertBudget()
    const before = await s.logLength()
    await s.click('Brew')
    let done = false
    for (let i = 0; i < 100 && !done; i += 1) {
      await sleep(2000)
      const log = await s.log(before)
      done = log.some((e) => e.msg && (e.msg.type === 'done' || e.msg.type === 'error'))
    }
    await sleep(3000)
    const log = await s.log(before)
    writeFileSync(`/tmp/wa/${label}-log.json`, JSON.stringify(log, null, 1))
    const doneMsg = log.find((e) => e.msg && e.msg.type === 'done')?.msg
    const errMsg = log.find((e) => e.msg && e.msg.type === 'error')?.msg
    console.log('error:', JSON.stringify(errMsg))
    if (doneMsg) {
      const u = doneMsg.usage
      console.log('usage', JSON.stringify(u))
      if (u?.usage) console.log('ledger', JSON.stringify(record(label, 'generate', u.model, u.usage.inputTokens, u.usage.outputTokens)))
      console.log('result', JSON.stringify(doneMsg.result, null, 1))
    }
    const requests = await s.requests()
    writeFileSync(`/tmp/wa/${label}-requests.json`, JSON.stringify(requests, null, 1))
    const gen = generateRequestsOf(requests)
    console.log('provider requests:', gen.length)
    for (const r of gen) {
      console.log(' ', r.model, 'max_tokens', r.maxTokens, 'stream', r.stream, 'blocks', JSON.stringify(r.blockTypes), 'images', JSON.stringify(r.images.map((i) => ({ type: i.media_type, b64: i.base64Length, sha: i.sha256.slice(0, 12) }))))
      if (r.images[0]) writeFileSync(`/tmp/wa/shots/${label}-sent.png`, Buffer.from(r.images[0].data, 'base64'))
    }
    console.log('panel after:', (await s.text()).replace(/\s+/g, ' ').slice(0, 600))
    console.log('totals', JSON.stringify(totals()))
  }
  if (process.env.REVIEW === '1' && !DRY) {
    const since = 0
    const l0 = await s.log(since)
    const generated = [...l0].reverse().find((e) => e.msg && e.msg.type === 'done')?.msg?.result
    const analysed = [...l0].reverse().find((e) => e.reply === 'analyse' || e.reply === 'analyse-css')?.value
    const analysis = analysed && 'data' in analysed ? analysed.data : analysed
    console.log('analysis', JSON.stringify(analysis))
    writeFileSync(`/tmp/wa/${label}-analysis.json`, JSON.stringify(analysis))
    if (generated?.kind === 'js' && analysis?.passed) {
      assertBudget()
      const n = await s.logLength()
      await s.click('Read the code first')
      for (let i = 0; i < 90; i += 1) {
        await sleep(2000)
        if ((await s.log(n)).some((e) => e.reply === 'review' || e.replyError === 'review')) break
      }
      const rev = (await s.log(n)).find((e) => e.reply === 'review')
      const v = rev?.value && 'data' in rev.value ? rev.value.data : rev?.value
      console.log('review', JSON.stringify(v))
      if (v?.usage?.usage) console.log('ledger', JSON.stringify(record(label + '-review', 'review', v.usage.model, v.usage.usage.inputTokens, v.usage.usage.outputTokens)))
      writeFileSync(`/tmp/wa/${label}-review.json`, JSON.stringify(v ?? null))
    }
  }
  // Discard the draft; nothing is saved.
  const hasDiscard = (await sb.run(s.hasButton('Discard'))) === 'true'
  if (hasDiscard) await s.click('Discard')
  else if ((await sb.run(s.hasButton('Cancel'))) === 'true') await s.click('Cancel')
  await sleep(1500)
} catch (e) {
  console.log('ERROR', e.message)
  exit = 1
}
console.log('settings left as is for the next run; restore with restore.mjs')
rdp.close()
process.exit(exit)
