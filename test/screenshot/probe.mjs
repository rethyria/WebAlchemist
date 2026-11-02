/**
 * #37 -- the screenshot path, driven through the real sidebar and picker, up to
 * and including what would be sent to a provider (a local stub that records it).
 *
 * No provider and no credential of the user's is used. The active provider is
 * replaced for the run by a stub on loopback, and the settings, the first-run
 * acknowledgement, the permission prompt preference and the all-sites grant are
 * put back at the end.
 *
 * What is checked, each with a control:
 *   - the image matches the region that was drawn, at three device pixel
 *     ratios, after scrolling, and for a region drawn with a click and a drag;
 *   - the image holds no pixel of the extension's overlay (the control is a
 *     capture taken while the picker is showing, which must contain some);
 *   - a capture is refused when the run's tab is not the active one (the control
 *     is the same request with the tab active);
 *   - nothing reaches the provider before Generate, and the request after it
 *     carries the image that the panel showed;
 *   - a second request after a failed one carries no image;
 *   - the all-sites grant is not held before the run, is held while the image
 *     is taken, and is handed back when the run ends.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { open, uniqueUrl, verdict, sleep } from '../crypto/rdp.mjs'
import { startServers, PAGE_PORT, PROVIDER_PORT, CELL } from './server.mjs'
import { inWindow, trustedClick, trustedDrag, trustedPageClick, ANALYSE, fitOnPage } from './drive.mjs'

const STUB_ID = 'wa-shot-stub'
const ALL_SITES = "{ origins: ['<all_urls>'] }"
const SIDEBAR = 'src/sidebar/index.html'

const servers = await startServers()
const rdp = open()
const ctx = await rdp.contexts({ waitMs: 8000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  servers.close()
  process.exit(1)
}

const rows = []
const note = (name, ok, detail = '') => {
  rows.push([name + (detail ? `  [${detail}]` : ''), Boolean(ok)])
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
}
const optionsUrl = `${ctx.baseUrl()}src/options/index.html`
const pageUrl = (label, path = '/') => uniqueUrl(`http://localhost:${PAGE_PORT}${path}`, label)
const parent = ctx.parent

/* ---- state to restore ------------------------------------------------- */
const saved = {
  settings: await B.long(`browser.storage.local.get('settings').then(s => JSON.stringify(s.settings ?? null))`),
  ack: await B.long(`browser.storage.local.get('wa-disclosure-ack').then(s => JSON.stringify(s['wa-disclosure-ack'] ?? null))`),
  pref: await parent.run(`(() => { const p = 'extensions.webextOptionalPermissionPrompts'; return Services.prefs.prefHasUserValue(p) ? 'user:' + Services.prefs.getBoolPref(p) : 'default' })()`),
  grant: await B.run(`browser.permissions.contains(${ALL_SITES})`),
}
console.log('state before the run (restored at the end): settings saved, acknowledgement', saved.ack === 'null' ? 'absent' : 'present', ', prompt pref', saved.pref, ', all-sites grant held:', saved.grant)

const openedTabs = []
const closeTabs = () => B.run(`Promise.all(${JSON.stringify(openedTabs)}.map(id => browser.tabs.remove(id).catch(() => {}))).then(() => 'closed')`)
const newTab = async (url, active = true) => {
  const id = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: ${active} }).then(t => t.id)`))
  openedTabs.push(id)
  for (let i = 0; i < 30; i += 1) {
    await sleep(300)
    if ((await B.run(`browser.tabs.get(${id}).then(t => t.status)`)) === 'complete') break
  }
  return id
}
const closeSidebar = () => parent.run(`(() => { const w = Services.wm.getMostRecentWindow('navigator:browser'); w.SidebarController.hide(); return 'hidden' })()`)
const showSidebar = async () => {
  await parent.run(`(async () => { const w = Services.wm.getMostRecentWindow('navigator:browser'); await w.SidebarController.show('_webalchemist-sidebar-action'); return 'shown' })()`)
  let sb = null
  for (let i = 0; i < 20 && !sb; i += 1) {
    await sleep(500)
    await ctx.refresh()
    sb = ctx.find(SIDEBAR)
  }
  return sb
}
const sidebarText = (sb) => sb.long(`document.body.innerText`)
const waitFor = async (sb, expr, ms = 12000) => {
  for (let t = 0; t < ms; t += 400) {
    const v = await sb.run(`(() => { try { return (${expr}) } catch { return false } })()`)
    if (v === 'true') return true
    await sleep(400)
  }
  return false
}
const sidebarButton = (label) => `[...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`
const hasButton = (label) => `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`

try {
  /* ---- setup ----------------------------------------------------------- */
  await B.run(`(async () => {
    const s = await browser.storage.local.get('settings')
    const settings = { ...(s.settings ?? {}) }
    settings.providers = [{ id: ${JSON.stringify(STUB_ID)}, label: 'Screenshot probe stub', type: 'openai-compatible',
      baseUrl: 'http://localhost:${PROVIDER_PORT}/v1', generateModel: 'stub', reviewModel: 'stub', supportsVision: true }]
    settings.activeProviderId = ${JSON.stringify(STUB_ID)}
    settings.keepScreenshotPermission = false
    await browser.storage.local.set({ settings, 'wa-disclosure-ack': { version: 999, at: 1 } })
    return 'stub provider active'
  })()`)
  await parent.run(`(() => { Services.prefs.setBoolPref('extensions.webextOptionalPermissionPrompts', false); return 'prompts off' })()`)
  note('control: the all-sites grant is not held when the run starts', (await B.run(`browser.permissions.contains(${ALL_SITES})`)) === 'false')
  const dpr = Number(await parent.run(`Services.wm.getMostRecentWindow('navigator:browser').devicePixelRatio`))
  console.log('window device pixel ratio at 100% zoom:', dpr)

  /* ---- 1. overlay control, and the wrong tab ---------------------------- */
  // The grant is added from the parent process for this part only, which is
  // what the user's acceptance of the prompt does; the real prompt path is
  // exercised in part 2.
  const grantFromParent = (op) => parent.run(`(async () => {
    const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
    const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
    const id = ${JSON.stringify(ctx.addon.id)}; const ext = ExtensionParent.GlobalManager.extensionMap.get(id);
    const p = { permissions: [], origins: ['<all_urls>'] };
    await ExtensionPermissions.${op}(id, p, ext);
    return 'done'
  })()`)
  await grantFromParent('add')

  const A = await newTab(pageUrl('shot-a'))
  const aUrl = await B.run(`browser.tabs.get(${A}).then(t => t.url)`)
  const aWin = await B.run(`browser.tabs.get(${A}).then(t => t.windowId)`)
  await sleep(1500)
  const viewportA = JSON.parse(await B.run(`browser.tabs.sendMessage(${A}, { type: 'get-viewport' }).then(v => JSON.stringify(v))`))
  console.log('viewport reported by the content script:', JSON.stringify(viewportA))

  // Control for the anomaly detector. A raw capture with nothing of ours in the
  // way has a small, constant number of non-grid pixels (the page's scrollbar),
  // and a capture taken while the picker shows its overlay has many more.
  const analyseInBackground = (dataUrl) => B.long(`(${ANALYSE})(${JSON.stringify(dataUrl)})`)
  const rawCapture = () => B.long(`browser.tabs.captureVisibleTab(${aWin}, { format: 'png' })`)
  const clean = JSON.parse(await analyseInBackground(await rawCapture()))
  const cleanAgain = JSON.parse(await analyseInBackground(await rawCapture()))
  console.log(`raw capture with no overlay: ${clean.width}x${clean.height}, non-grid pixels ${clean.anomalies} and ${cleanAgain.anomalies} (the page's scrollbar)`)
  note('control: two raw captures with no overlay agree on the number of non-grid pixels', clean.anomalies === cleanAgain.anomalies, `${clean.anomalies}`)
  // The picker is started the way the panel starts it, from an extension page.
  const optionsTab = await newTab(optionsUrl, false)
  let O = null
  for (let i = 0; i < 15 && !O; i += 1) {
    await sleep(700)
    await ctx.refresh()
    O = ctx.find('src/options/index.html')
  }
  await B.run(`browser.tabs.update(${A}, { active: true }).then(() => 'active')`)
  await O.run(`browser.runtime.sendMessage({ type: 'start-picking', tabId: ${A} }).then(r => JSON.stringify(r))`)
  await sleep(1500)
  const withOverlay = JSON.parse(await analyseInBackground(await rawCapture()))
  note('control: a capture taken while the picker shows its overlay has far more non-grid pixels', withOverlay.anomalies > clean.anomalies + 1000, `${withOverlay.anomalies} against ${clean.anomalies}`)
  await O.run(`browser.runtime.sendMessage({ type: 'stop-picking', tabId: ${A} }).then(r => JSON.stringify(r))`)
  await sleep(500)

  // Wrong tab: another tab becomes active, and a capture is requested for A.
  const request = (tabId, url) => `browser.runtime.getURL('') && (async () => {
    try { const r = await browser.tabs.sendMessage(${tabId}, { type: 'get-viewport' }); return 'viewport ok' } catch (e) { return 'ERR ' + e.message } })()`
  void request
  const OTHER = await newTab(pageUrl('shot-other', '/other'))
  await sleep(800)
  const activeNow = await B.run(`browser.tabs.query({ active: true, windowId: ${aWin} }).then(t => t[0].id)`)
  note('control: the other tab is the active tab in the window', Number(activeNow) === OTHER)

  const capture = (tabId, url) =>
    O.long(`browser.runtime.sendMessage({ type: 'capture-region', tabId: ${tabId}, rect: { x: 120, y: 80, width: 200, height: 150 },
      viewportWidth: ${viewportA.width}, url: ${JSON.stringify(url)} }).then(r => JSON.stringify(r.ok ? { ok: true, hasImage: typeof r.data.dataUrl === 'string' } : r))`)
  const refused = await capture(A, aUrl)
  note('the capture for a tab that is not the active tab is refused and returns no image', /"ok":false/.test(refused) && !/hasImage/.test(refused), refused.slice(0, 150))
  await B.run(`browser.tabs.update(${A}, { active: true }).then(() => 'active')`)
  await sleep(800)
  const accepted = await capture(A, aUrl)
  note('control: the same request with the tab active returns an image', /"hasImage":true/.test(accepted), accepted.slice(0, 80))
  const refusedUrl = await capture(A, `http://localhost:${PAGE_PORT}/other`)
  note('a capture whose address is not the tab\'s address is refused', /"ok":false/.test(refusedUrl), refusedUrl.slice(0, 150))

  await grantFromParent('remove')
  note('control: the grant added for this part is removed again', (await B.run(`browser.permissions.contains(${ALL_SITES})`)) === 'false')
  await closeTabs()
  openedTabs.length = 0

  /* ---- 2. the sidebar flow ----------------------------------------------- */
  const sendMessageLog = (sb) => sb.run(`(() => { globalThis.__sent = []; globalThis.__times = []; const o = browser.runtime.sendMessage.bind(browser.runtime);
    browser.runtime.sendMessage = (m, ...rest) => { try { globalThis.__sent.push(JSON.parse(JSON.stringify(m, (k, v) => (k === 'dataUrl' ? '[image]' : v)))) } catch {}
      const type = m && m.type; if (type === 'capture-region') __times.push([Date.now(), 'capture-region sent'])
      const result = o(m, ...rest); if (type === 'capture-region') result.then(() => __times.push([Date.now(), 'capture-region answered']), () => {}); return result }; return 'logging' })()`)

  /**
   * One run of the flow. Returns what was measured; the checks are made by the caller.
   */
  async function runFlow(options) {
    const { label, zoom, drag, click, scrollBy = 0, region = false, doubleClick = false } = options
    const result = { label }
    const tab = await newTab(pageUrl(label))
    await B.run(`browser.tabs.setZoom(${tab}, ${zoom})`)
    await sleep(1500)
    const needle = `wa-probe=${label}`
    result.pageDpr = Number(await inWindow(rdp, needle, `return String(w.devicePixelRatio)`))
    result.viewport = JSON.parse(await inWindow(rdp, needle, `return JSON.stringify({ w: w.innerWidth, h: w.innerHeight })`))
    await closeSidebar()
    await sleep(500)
    const sb = await showSidebar()
    if (!sb) throw new Error('sidebar did not appear')
    if (!(await waitFor(sb, hasButton('Select an element')))) throw new Error('no Select an element button: ' + (await sidebarText(sb)).slice(0, 200))
    await sendMessageLog(sb)
    // Records where the page saw the mouse, to catch a position that was converted wrongly.
    const pageTarget = await ctx.tab(needle)
    await pageTarget.run(`(() => { globalThis.__dom = []; const log = (list) => list.forEach((m) => { m.addedNodes.forEach((n) => __dom.push([Date.now(), '+', n.nodeName, n.id || ''])); m.removedNodes.forEach((n) => __dom.push([Date.now(), '-', n.nodeName, n.id || ''])) });
      new MutationObserver(log).observe(document.documentElement, { childList: true }); new MutationObserver(log).observe(document.body, { childList: true }); return 'observing' })()`)
    await pageTarget.run(`(() => { globalThis.__mouse = []; for (const t of ['mousedown', 'mouseup']) document.addEventListener(t, (e) => __mouse.push([t, e.isTrusted, e.clientX, e.clientY]), true); return 'listening' })()`)

    result.grantBefore = await B.run(`browser.permissions.contains(${ALL_SITES})`)
    await trustedClick(rdp, SIDEBAR, sidebarButton('Select an element'))
    await sleep(1200)
    if (click) await trustedPageClick(rdp, needle, click[0], click[1])
    else await trustedDrag(rdp, needle, drag)
    result.mouse = JSON.parse(await pageTarget.run(`JSON.stringify(__mouse)`))
    const described = await waitFor(sb, `!!document.querySelector('textarea')`)
    if (!described) throw new Error('the panel did not reach the description step: ' + (await sidebarText(sb)).slice(0, 300))
    if (scrollBy) {
      await pageTarget.run(`(window.scrollTo(0, ${scrollBy}), 1)`)
      await sleep(500)
      result.scrollY = Number(await pageTarget.run(`window.scrollY`))
    }
    result.providerBefore = servers.received.length
    result.requestsAtStart = servers.received.length

    // Take the screenshot through the panel.
    if (region) {
      await trustedClick(rdp, SIDEBAR, sidebarButton('Add a screenshot'))
      await sleep(1200)
      await trustedDrag(rdp, needle, drag)
    } else {
      await trustedClick(rdp, SIDEBAR, `w.document.querySelector('button[role="switch"][aria-label="Include screenshot of the area you drew"]')`, doubleClick ? 2 : 1)
    }
    result.grantDuring = null
    const shown = await waitFor(sb, `!!document.querySelector('img.shot') || /cannot|could not|Firefox only lets/i.test(document.body.innerText)`, 15000)
    result.providerAfterShot = servers.received.length
    result.grantDuring = await B.run(`browser.permissions.contains(${ALL_SITES})`)
    result.hasImage = (await sb.run(`!!document.querySelector('img.shot')`)) === 'true'
    result.text = (await sidebarText(sb)).replace(/\s+/g, ' ')
    result.sent = JSON.parse(await sb.long(`JSON.stringify(globalThis.__sent)`))
    if (result.hasImage) {
      const src = await sb.long(`document.querySelector('img.shot').src`)
      result.dataUrl = src
      try { mkdirSync('/tmp/wa/shots', { recursive: true }); writeFileSync(`/tmp/wa/shots/${label}.png`, Buffer.from(src.replace(/^data:image\/png;base64,/, ''), 'base64')) } catch {}
      result.analysis = JSON.parse(await sb.long(`(${ANALYSE})(document.querySelector('img.shot').src)`))
    }
    result.shown = shown
    result.times = JSON.parse(await sb.long(`JSON.stringify(globalThis.__times)`))
    result.dom = JSON.parse(await pageTarget.long(`JSON.stringify(__dom)`))
    result.sidebar = sb
    result.tab = tab
    result.needle = needle
    return result
  }

  async function finishFlow(r, how) {
    if (how === 'cancel') {
      await trustedClick(rdp, SIDEBAR, sidebarButton('Cancel'))
      await sleep(1500)
    }
    const after = await B.run(`browser.permissions.contains(${ALL_SITES})`)
    return after
  }

  const drag = [120, 80, 320, 230]
  const cases = [
    { label: 'shot-zoom-low', zoom: 2 / 3, drag },
    { label: 'shot-zoom-100', zoom: 1, drag },
    { label: 'shot-zoom-high', zoom: 4 / 3, drag },
    { label: 'shot-scrolled', zoom: 1, drag, scrollBy: 80 },
    { label: 'shot-scrolled-zoomed', zoom: 4 / 3, drag, scrollBy: 80 },
    // Two clicks on the toggle in one instant, as a double click. Reported, not asserted.
    { label: 'shot-double-click', zoom: 1, drag, doubleClick: true },
    // A region that runs past the bottom of the viewport.
    { label: 'shot-clipped', zoom: 1, drag: [120, 700, 320, 1200], expectClipped: true },
    // The largest region the viewport allows at a device pixel ratio of 2, to see how big an image gets.
    { label: 'shot-large', zoom: 4 / 3, drag: [20, 20, 660, 700] },
    { label: 'shot-region-mode', zoom: 1, click: [60, 60], region: true, drag: [200, 160, 360, 280] },
    // A region whose image is larger than 1568 pixels. The window is made larger for this case and put back after,
    // because the capture cannot be larger than the window and the window of this run is about 1400 pixels tall.
    { label: 'shot-reduced', zoom: 1, drag: [20, 20, 1700, 900], enlarge: true, reducedCase: true },
  ]
  const measured = {}
  // CASES=label,label runs only those, for working on one of them.
  const wanted = process.env.CASES ? process.env.CASES.split(',') : null
  for (const c of cases.filter((c) => wanted === null || wanted.includes(c.label))) {
    console.log(`\n--- ${c.label} ---`)
    const windowSaved = c.enlarge
      ? JSON.parse(await B.run(`browser.windows.getAll().then(ws => JSON.stringify({ id: ws[0].id, width: ws[0].width, height: ws[0].height, left: ws[0].left, top: ws[0].top }))`))
      : null
    try {
      if (windowSaved) {
        await B.run(`browser.windows.update(${windowSaved.id}, { left: 0, top: 0, width: 2540, height: 1400 }).then(() => 'enlarged')`)
        await sleep(2500)
      }
      const r = await runFlow(c)
      measured[c.label] = r
      const intended = c.drag
      const mouseOk = r.mouse.length >= 2 && r.mouse.every(([, trusted]) => trusted === true)
      console.log(`device pixel ratio of the page: ${r.pageDpr}; viewport ${r.viewport.w}x${r.viewport.h}; mouse events seen by the page: ${JSON.stringify(r.mouse)}`)
      note(`${c.label}: the page saw trusted mouse events at the intended positions`, mouseOk && r.mouse.some(([t, , x, y]) => t === 'mousedown' && Math.abs(x - intended[0]) < 1 && Math.abs(y - intended[1]) < 1) || c.click !== undefined, JSON.stringify(r.mouse))
      note(`${c.label}: the all-sites grant was not held before the screenshot`, r.grantBefore === 'false')
      note(`${c.label}: nothing was sent to the provider while the screenshot was taken`, r.providerAfterShot === r.requestsAtStart, `requests ${r.requestsAtStart} before, ${r.providerAfterShot} after`)
      note(`${c.label}: an image was shown in the panel`, r.hasImage, r.text.slice(0, 160))
      const captureRequests = r.sent.filter((m) => m.type === 'capture-region').length
      if (c.doubleClick) console.log(`INFORMATION ${c.label}: two clicks sent ${captureRequests} capture requests; the image shown has ${r.analysis?.anomalies ?? 'no'} pixels that are not from the page`)
      else note(`${c.label}: one action sent one capture request`, captureRequests === 1, `requests ${captureRequests}`)
      note(`${c.label}: the grant was held while the image was taken`, r.grantDuring === 'true')
      if (c.reducedCase && r.analysis) {
        const longer = Math.max(r.analysis.width, r.analysis.height)
        const sentCapture = r.sent.find((m) => m.type === 'capture-region')
        console.log(`reduced case: request ${JSON.stringify(sentCapture?.rect)}, image ${r.analysis.width}x${r.analysis.height}, ${Math.round((r.dataUrl.length * 3) / 4 / 1024)} KB; panel: ${r.text.slice(0, 400)}`)
        note(`${c.label}: the region's image is larger than 1568 pixels before the limit (the panel's note gives the size it had)`, /was reduced from (\d+) × (\d+) to/.test(r.text) && Math.max(...(/was reduced from (\d+) × (\d+) to/.exec(r.text) ?? []).slice(1).map(Number)) > 1568, r.text.match(/The image was reduced[^.]*\./)?.[0] ?? 'no note')
        note(`${c.label}: the image the panel shows has a longer side of 1568 pixels`, longer === 1568, `${r.analysis.width}x${r.analysis.height}`)
        note(`${c.label}: the panel says in the preview that the image was reduced, with both sizes`, new RegExp(`was reduced from \\d+ × \\d+ to ${r.analysis.width} × ${r.analysis.height} pixels`).test(r.text), r.text.match(/The image was reduced[^.]*\./)?.[0] ?? 'no note')
      } else if (r.analysis) {
        // Control for the note: a region under the limit has none.
        note(`control (${c.label}): the preview has no note about a reduced image`, !/was reduced from/.test(r.text))
      }
      if (r.analysis && !c.doubleClick && !c.reducedCase) {
        const sentCapture = r.sent.find((m) => m.type === 'capture-region')
        console.log('capture-region request:', JSON.stringify(sentCapture))
        console.log('first pixels of the middle row:', JSON.stringify(r.analysis.row.slice(0, 3)), 'middle column:', JSON.stringify(r.analysis.column.slice(0, 3)))
        const rect = sentCapture?.rect
        const scroll = sentCapture?.scrolledTo ?? { x: 0, y: 0 }
        // The scale of the image is fitted from the cell edges in it, and is not the page's pixel ratio: at a page
        // zoom of 133 percent Firefox captured 1.9949 pixels for each CSS pixel while the page reported 2.
        const scale = r.pageDpr
        const nearStart = { x: rect.x + scroll.x, y: rect.y + scroll.y }
        const fitted = fitOnPage(r.analysis, nearStart)
        const where = {
          x: fitted.x && { start: fitted.x.start, end: fitted.x.end, edges: fitted.x.edges, measuredScale: fitted.x.slope, spread: 0 },
          y: fitted.y && { start: fitted.y.start, end: fitted.y.end, edges: fitted.y.edges, measuredScale: fitted.y.slope, spread: 0 },
        }
        const fitScale = where.x?.measuredScale ?? scale
        console.log('image', `${r.analysis.width}x${r.analysis.height}`, 'page ratio', scale.toFixed(3), 'scale fitted from the edges', fitScale.toFixed(4), 'placed on page at', JSON.stringify({ x: where.x && [where.x.start.toFixed(2), where.x.end.toFixed(2)], y: where.y && [where.y.start.toFixed(2), where.y.end.toFixed(2)], edgesX: where.x?.edges, edgesY: where.y?.edges, blendX: fitted.x?.blend, blendY: fitted.y?.blend }))
        // The page position the drawn region had when it was drawn (scroll at pick time is scrolledTo, if sent).
        const expected = { x0: rect.x + scroll.x, y0: rect.y + scroll.y, x1: rect.x + rect.width + scroll.x, y1: rect.y + rect.height + scroll.y }
        // One device pixel on each edge: the crop is rounded to whole device pixels, and the capture itself has whole-pixel sides.
        const tol = 1 / fitScale
        note(`${c.label}: the request's rectangle is the region that was dragged (within 1 CSS pixel)`, rect && Math.abs(rect.x - intended[0]) <= 1 && Math.abs(rect.y - intended[1]) <= 1 && Math.abs(rect.width - (intended[2] - intended[0])) <= 1 && Math.abs(rect.height - (intended[3] - intended[1])) <= 1, JSON.stringify(rect))
        note(`${c.label}: the image's left and top edges are the region's, within one device pixel`, where.x && where.y && Math.abs(where.x.start - expected.x0) <= tol && Math.abs(where.y.start - expected.y0) <= tol, `image starts at ${where.x?.start.toFixed(2)},${where.y?.start.toFixed(2)}; region ${expected.x0},${expected.y0}`)
        if (c.expectClipped) {
          note(`${c.label}: the panel says the region was clipped, and the image is shorter than the region`, /Clipped at the viewport/.test(r.text) && r.analysis.height / fitScale < rect.height - 1, `region height ${rect.height}, image height ${(r.analysis.height / fitScale).toFixed(1)} CSS pixels`)
        } else {
          note(`${c.label}: the image's right and bottom edges are the region's, within one device pixel`, where.x && where.y && Math.abs(where.x.end - expected.x1) <= tol && Math.abs(where.y.end - expected.y1) <= tol, `image ends at ${where.x?.end.toFixed(2)},${where.y?.end.toFixed(2)}; region ${expected.x1},${expected.y1}`)
        }
        if (c.label === 'shot-large') console.log(`INFORMATION shot-large: the image is ${r.analysis.width}x${r.analysis.height} pixels and ${Math.round((r.dataUrl.length * 3) / 4 / 1024)} KB`)
        // A region that reaches the bottom of the viewport also contains the page's horizontal scrollbar, which is not grid colours.
        note(`${c.label}: no edge in the image is blurred (an image copied pixel for pixel has at most one pixel between two cells)`, c.expectClipped || (fitted.x?.blend <= 1 && fitted.y?.blend <= 1), `most pixels at an edge: ${fitted.x?.blend} across, ${fitted.y?.blend} down`)
        note(`${c.label}: the scale of the image is within 1 percent of the page's device pixel ratio (information: they differ by up to 0.25 percent at some zooms)`, where.x?.measuredScale && Math.abs(where.x.measuredScale / scale - 1) < 0.01, `fitted ${where.x?.measuredScale?.toFixed(4)}, page ratio ${scale.toFixed(3)}`)
        if (r.analysis.anomalies > 0 && !c.expectClipped) console.log('TINTED. capture timing:', JSON.stringify(r.times), 'changes to the page body and root while the panel ran:', JSON.stringify(r.dom))
        // A region that reaches the bottom of the viewport also contains the page's horizontal
        // scrollbar (the grid is wider than the window), which is not the extension's, so that
        // case reports the count and does not assert it.
        if (c.expectClipped) console.log(`INFORMATION ${c.label}: ${r.analysis.anomalies} pixels are not grid colours; the region reaches the page's horizontal scrollbar (a full raw capture has ${3245} such pixels without any overlay)`)
        else note(`${c.label}: no pixel of the image is outside the grid colours (no overlay, dimming or hint bar)`, r.analysis.anomalies === 0, `anomalies ${r.analysis.anomalies}`)
        if (c.scrollBy) note(`${c.label}: the panel says the area moved because the page scrolled`, /moved because the page scrolled/.test(r.text) && r.scrollY === c.scrollBy, `scrollY ${r.scrollY}`)
        else note(`control (${c.label}): no scroll note when the page did not scroll`, !/moved because the page scrolled/.test(r.text))
        if (!c.expectClipped) note(`${c.label}: the region inside the viewport is not reported as clipped`, !/Clipped at the viewport/.test(r.text))
      }
      // The same request, repeated through the real message path while the panel is still in the
      // state it was in when the image was taken. Counts how many of the images contain pixels that
      // are not from the page. The grid has none, so any such pixel was drawn by the extension.
      if (c.label === 'shot-zoom-100' || c.label === 'shot-zoom-high') {
        const sentCapture = r.sent.find((m) => m.type === 'capture-region')
        await newTab(optionsUrl, false)
        let optionsPage = null
        for (let i = 0; i < 15 && !optionsPage; i += 1) {
          await sleep(700)
          await ctx.refresh()
          optionsPage = ctx.find('src/options/index.html')
        }
        const repeats = 15
        let tinted = 0
        const errors = new Set()
        for (let i = 0; i < repeats; i += 1) {
          const reply = JSON.parse(await optionsPage.long(`browser.runtime.sendMessage(${JSON.stringify({ ...sentCapture })}).then(x => JSON.stringify(x.ok ? { ok: true, dataUrl: x.data.dataUrl } : x))`).catch(() => '{"ok":false}'))
          if (!reply.ok) {
            errors.add(JSON.stringify(reply).slice(0, 120))
            continue
          }
          const a = JSON.parse(await B.long(`(${ANALYSE})(${JSON.stringify(reply.dataUrl)})`))
          if (a.anomalies > 0) tinted += 1
        }
        console.log(`repeated capture-region in the same state: ${tinted} of ${repeats} images contain pixels that are not from the page`, errors.size ? 'errors: ' + [...errors].join(' | ') : '')
        r.repeat = { tinted, repeats }
        // Two requests at nearly the same moment, as a double click sends them (#37). The second is sent a few
        // milliseconds after the first, because a tint needs the first request to show the layer again before
        // the second has captured. Both images of every pair are analysed.
        // The time one request takes, so that the delays reach from before it ends to after.
        const timed = JSON.parse(await optionsPage.long(`(async () => { const t0 = performance.now(); await browser.runtime.sendMessage(${JSON.stringify({ ...sentCapture })}); return JSON.stringify(performance.now() - t0) })()`))
        console.log(`one capture-region request takes ${Number(timed).toFixed(0)} ms`)
        const delays = [0, 5, 20, 40, 60, 80, 100, 200]
        const rounds = 2
        const byDelay = {}
        let pairImages = 0
        let pairTinted = 0
        for (let round = 0; round < rounds; round += 1) {
          for (const delay of delays) {
            const both = JSON.parse(await optionsPage.long(`Promise.all([
              browser.runtime.sendMessage(${JSON.stringify({ ...sentCapture })}),
              new Promise((resolve) => setTimeout(resolve, ${delay})).then(() => browser.runtime.sendMessage(${JSON.stringify({ ...sentCapture })})),
            ]).then(rs => JSON.stringify(rs.map(x => x.ok ? { ok: true, dataUrl: x.data.dataUrl } : { ok: false, error: x.error && x.error.message })))`).catch(() => '[{"ok":false},{"ok":false}]'))
            const entry = (byDelay[delay] ??= { images: 0, tinted: 0, failed: 0 })
            for (const image of both) {
              if (!image.ok) { entry.failed += 1; continue }
              const a = JSON.parse(await B.long(`(${ANALYSE})(${JSON.stringify(image.dataUrl)})`))
              entry.images += 1
              pairImages += 1
              if (a.anomalies > 0) { entry.tinted += 1; pairTinted += 1 }
            }
            await sleep(400)
          }
        }
        console.log(`overlapping capture-region pairs: ${pairTinted} of ${pairImages} images contain pixels that are not from the page; by milliseconds before the second request: ${JSON.stringify(byDelay)}`)
        const afterPairs = JSON.parse(await B.long(`(${ANALYSE})(${JSON.stringify(await B.long(`browser.tabs.captureVisibleTab(${aWin}, { format: 'png' })`))})`))
        console.log(`raw capture after the pairs: ${afterPairs.anomalies} non-grid pixels (the page's scrollbar alone is ${clean.anomalies})`)
        r.pairs = { tinted: pairTinted, images: pairImages, byDelay, layerAfter: afterPairs.anomalies }
        note(`${c.label}: no image from two overlapping capture requests contains pixels of the extension's overlay`, pairImages > 0 && pairTinted === 0, `${pairTinted} of ${pairImages} tinted`)
        note(`${c.label}: the outline of the picked area is shown again after the overlapping requests`, afterPairs.anomalies > clean.anomalies + 1000, `${afterPairs.anomalies} non-grid pixels against ${clean.anomalies} for the page alone`)
      }
      // The first case also goes to Generate, against the stub.
      if (c.label === 'shot-zoom-100') {
        const before = servers.received.length
        await r.sidebar.run(`(() => { const t = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Make the background dark'); t.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
        await sleep(300)
        await trustedClick(rdp, SIDEBAR, sidebarButton('Generate'))
        for (let i = 0; i < 40 && servers.received.length === before; i += 1) await sleep(300)
        await sleep(1500)
        const first = servers.received[before]
        // The shape of what the provider received, with long strings shortened, for the report.
        const shape = (v) => (typeof v === 'string' ? (v.length > 60 ? v.slice(0, 40) + `...(${v.length})` : v) : Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : v)
        try { console.log('what the stub provider received:', JSON.stringify(shape(JSON.parse(first.body))).slice(0, 700)) } catch { console.log('what the stub provider received (not JSON):', String(first?.body).slice(0, 200)) }
        const image = (body) => {
          try {
            const text = JSON.stringify(JSON.parse(body))
            const m = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(text)
            return m ? m[1] : null
          } catch { return null }
        }
        note('shot-zoom-100: a request reached the stub provider only after Generate', servers.received.length > before, `requests ${servers.received.length}`)
        const sentImage = first ? image(first.body) : null
        const shown = r.dataUrl.replace(/^data:image\/png;base64,/, '')
        note('shot-zoom-100: the request carries the image that the panel showed, unchanged', sentImage !== null && sentImage === shown, `sent ${sentImage?.length ?? 0} characters, shown ${shown.length}`)
        console.log('request count after the first Generate:', servers.received.length, '; panel text:', (await sidebarText(r.sidebar)).replace(/\s+/g, ' ').slice(0, 200))
        // A second attempt, if the panel offers one, must carry no image unless a new one was taken.
        // The second attempt is made by pressing Generate again with the same description, after the error is dismissed.
        // Neither button needs a user gesture, so they are pressed with click().
        const press = (label) => r.sidebar.run(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled); if (!b) return 'no button'; b.click(); return 'pressed' })()`)
        console.log('dismiss:', await press('Dismiss'))
        await sleep(800)
        const stillShowing = (await r.sidebar.run(`!!document.querySelector('img.shot')`)) === 'true'
        console.log('image still shown in the panel after the first attempt failed:', stillShowing)
        const mid = servers.received.length
        const retry = await press('Generate')
        console.log('second attempt click:', retry)
        for (let i = 0; i < 30 && servers.received.length === mid; i += 1) {
          await sleep(500)
          if (i % 6 === 5) console.log('  panel while waiting for the second request:', (await sidebarText(r.sidebar)).replace(/\s+/g, ' ').slice(0, 160))
        }
        await sleep(1000)
        if (servers.received.length > mid) {
          const second = servers.received[mid]
          note('shot-zoom-100: the second request after the first one failed carries no image', image(second.body) === null, `requests ${servers.received.length}; panel showed an image before it: ${stillShowing}`)
        } else {
          console.log('NOT EXERCISED: no second request was made after the retry click; panel text:', (await sidebarText(r.sidebar)).replace(/\s+/g, ' ').slice(0, 200))
        }
      }
      const after = await finishFlow(r, 'cancel')
      note(`${c.label}: the all-sites grant was handed back when the run ended`, after === 'false', `held after: ${after}`)
    } catch (error) {
      note(`${c.label}: the case ran to the end`, false, String(error.message ?? error).slice(0, 300))
      await B.run(`browser.permissions.remove(${ALL_SITES}).then(() => 'x', () => 'x')`)
    } finally {
      await closeTabs()
      openedTabs.length = 0
      if (windowSaved) {
        await B.run(`browser.windows.update(${windowSaved.id}, { left: ${windowSaved.left}, top: ${windowSaved.top}, width: ${windowSaved.width}, height: ${windowSaved.height} }).then(() => 'restored')`)
        await sleep(1500)
      }
    }
  }

  /* ---- 3. the gate on models that cannot read images ---------------------- */
  if (process.env.CASES === undefined) {
    const setVision = (value) => B.run(`(async () => {
      const s = (await browser.storage.local.get('settings')).settings
      s.providers = s.providers.map((p) => ({ ...p, supportsVision: ${value} }))
      await browser.storage.local.set({ settings: s })
      return 'supportsVision ${value}'
    })()`)
    const offered = async (value) => {
      await setVision(value)
      const label = `shot-gate-${value}`
      const tab = await newTab(pageUrl(label))
      await closeSidebar()
      await sleep(500)
      const sb = await showSidebar()
      if (!(await waitFor(sb, hasButton('Select an element')))) throw new Error('no Select an element button')
      await trustedClick(rdp, SIDEBAR, sidebarButton('Select an element'))
      await sleep(1200)
      await trustedPageClick(rdp, `wa-probe=${label}`, 60, 60)
      await waitFor(sb, `!!document.querySelector('textarea')`)
      await sleep(1000)
      const controls = await sb.run(`(() => !!document.querySelector('section.screenshot') || [...document.querySelectorAll('button')].some(b => /screenshot/i.test(b.textContent)))()`)
      await trustedClick(rdp, SIDEBAR, sidebarButton('Cancel'))
      await sleep(800)
      await closeTabs()
      openedTabs.length = 0
      void tab
      return controls === 'true'
    }
    note('control: a model that reads images gets the screenshot controls', (await offered(true)) === true)
    note('a model that does not read images gets no screenshot controls', (await offered(false)) === false)
  }
} catch (error) {
  note('the probe ran to the end', false, String(error.message ?? error).slice(0, 300))
} finally {
  await closeSidebar().catch(() => {})
  await B.run(`(async () => {
    const saved = ${JSON.stringify(saved)}
    const settings = JSON.parse(saved.settings)
    if (settings === null) await browser.storage.local.remove('settings'); else await browser.storage.local.set({ settings })
    const ack = JSON.parse(saved.ack)
    if (ack === null) await browser.storage.local.remove('wa-disclosure-ack'); else await browser.storage.local.set({ 'wa-disclosure-ack': ack })
    if (saved.grant !== 'true') { try { await browser.permissions.remove(${ALL_SITES}) } catch {} }
    return 'restored'
  })()`).then((r) => console.log('\nsettings, acknowledgement and grant:', r))
  await parent.run(`(() => { const p = 'extensions.webextOptionalPermissionPrompts'; const saved = ${JSON.stringify(saved.pref)};
    if (saved === 'default') Services.prefs.clearUserPref(p); else Services.prefs.setBoolPref(p, saved === 'user:true'); return 'pref restored' })()`)
  await closeTabs().catch(() => {})
  const restored = await B.long(`browser.storage.local.get('settings').then(s => JSON.stringify(s.settings ?? null))`)
  note('control: the settings are back to what they were before the run', restored === saved.settings)
  const ok = verdict(rows)
  servers.close()
  rdp.close()
  process.exit(ok ? 0 : 1)
}
