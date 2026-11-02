/**
 * #37 -- is the cropped image the region that was drawn, to a device pixel, at
 * every page zoom and after scrolling, and what does an image that is larger than
 * the size limit become?
 *
 * Each case sends the `capture-region` message that the panel sends, from an
 * extension page, for a region of the grid page, and analyses the image that
 * comes back. The scale of the image is fitted from the cell edges in it and not
 * taken from the page's pixel ratio, because the two differ at some zooms (see
 * the README). A case passes when the image starts and ends at the region's
 * edges to within one device pixel, its sides are the region's times that scale to
 * within one device pixel, and no edge in it is blurred (an image copied pixel
 * for pixel has at most one blended pixel at an edge, and a resampled one has more).
 *
 * The cases for the size limit enlarge the dev Firefox window, so that a full
 * capture is larger than 1568 pixels, and put the window back afterwards.
 *
 * Needs the development Firefox (WA_RDP_PORT) and the host permission for
 * http://localhost/*. The all-sites grant that captureVisibleTab needs is added
 * from the parent process for the run and removed at the end.
 */
import { startServers, PAGE_PORT } from './server.mjs'
import { inWindow, ANALYSE, fitOnPage } from './drive.mjs'
import { open, uniqueUrl, verdict, sleep } from '../crypto/rdp.mjs'

const servers = await startServers()
const rdp = open()
const ctx = await rdp.contexts({ waitMs: 8000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  process.exit(1)
}
const parent = ctx.parent
const ALL_SITES = "{ origins: ['<all_urls>'] }"
const grant = (op) => parent.run(`(async () => {
  const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
  const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
  const id = ${JSON.stringify(ctx.addon.id)}; const ext = ExtensionParent.GlobalManager.extensionMap.get(id);
  await ExtensionPermissions.${op}(id, { permissions: [], origins: ['<all_urls>'] }, ext);
  return 'done' })()`)
const rows = []
const note = (name, ok, detail = '') => {
  rows.push([name + (detail ? `  [${detail}]` : ''), Boolean(ok)])
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
}

const heldBefore = (await B.run(`browser.permissions.contains(${ALL_SITES})`)) === 'true'
const windowBefore = JSON.parse(await B.run(`browser.windows.getAll().then(ws => JSON.stringify({ id: ws[0].id, width: ws[0].width, height: ws[0].height, left: ws[0].left, top: ws[0].top }))`))
const optionsTab = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(ctx.baseUrl() + 'src/options/index.html')}, active: false }).then(t => t.id)`))
let O = null
for (let i = 0; i < 15 && !O; i += 1) {
  await sleep(700)
  await ctx.refresh()
  O = ctx.find('src/options/index.html')
}

/** One capture the way the panel asks for it. */
async function runCase({ label, zoom, rect, scrollBy = 0, expectClipped = false }) {
  const url = uniqueUrl(`http://localhost:${PAGE_PORT}/`, label)
  const id = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: true }).then(t => t.id)`))
  try {
    await sleep(1800)
    await B.run(`browser.tabs.setZoom(${id}, ${zoom})`)
    await sleep(1500)
    const needle = `wa-probe=${label}`
    // The region is drawn at scroll 0, as the picker stores it, and the page scrolls afterwards.
    const drawnAt = JSON.parse(await B.run(`browser.tabs.sendMessage(${id}, { type: 'get-viewport' }).then(v => JSON.stringify(v))`))
    if (scrollBy) {
      await inWindow(rdp, needle, `w.scrollTo(0, ${scrollBy}); return 'scrolled'`)
      await sleep(600)
    }
    const dpr = Number(await inWindow(rdp, needle, `return String(w.devicePixelRatio)`))
    await grant('add')
    const message = {
      type: 'capture-region', tabId: id, rect, viewportWidth: drawnAt.width, url,
      devicePixelRatio: drawnAt.devicePixelRatio, ...(scrollBy ? { scrolledTo: { x: drawnAt.x, y: drawnAt.y } } : {}),
    }
    const raw = await O.long(`(async () => {
      const r = await browser.runtime.sendMessage(${JSON.stringify(message)});
      if (!r.ok) return JSON.stringify({ ok: false, error: r.error });
      const a = JSON.parse(await (${ANALYSE})(r.data.dataUrl));
      return JSON.stringify({ ok: true, rect: r.data.rect, clipped: r.data.clipped, moved: r.data.moved, reduced: r.data.reduced ?? null, bytes: Math.round(r.data.dataUrl.length * 3 / 4), analysis: a });
    })()`)
    const result = JSON.parse(raw)
    // The scale of the capture itself, fitted over the whole viewport, which holds many more edges than a
    // small region does and so gives the scale much more exactly.
    await grant('add')
    const windowId = await B.run(`browser.tabs.get(${id}).then(t => t.windowId)`)
    const whole = JSON.parse(await O.long(`(async () => (${ANALYSE})(await browser.tabs.captureVisibleTab(${windowId}, { format: 'png' })))()`))
    const scrollNow = scrollBy ? Number(await inWindow(rdp, needle, `return String(w.scrollY)`)) : 0
    const fitWhole = fitOnPage(whole, { x: 0, y: scrollNow })
    return { label, dpr, drawnAt, message, truth: { x: fitWhole.x.slope, y: fitWhole.y.slope, size: `${whole.width}x${whole.height}`, edges: fitWhole.x.edges }, ...result }
  } finally {
    await B.run(`browser.tabs.remove(${id}).catch(() => {})`)
  }
}

function report(c, { region, scrollBy = 0, expectClipped = false }) {
  if (!c.ok) {
    note(`${c.label}: the capture returned an image`, false, JSON.stringify(c.error).slice(0, 150))
    return
  }
  const a = c.analysis
  // The page position of the region when it was drawn, in page CSS pixels.
  const near = { x: region.x, y: region.y + (scrollBy ? 0 : 0) }
  const fitted = fitOnPage(a, near)
  // The scale of the capture, from the whole viewport, and not from the few edges of a small region.
  const sx = c.truth.x
  const sy = c.truth.y
  const row = {
    label: c.label, dpr: c.dpr.toFixed(4), viewportCapture: c.truth.size, capture: `${a.width}x${a.height}`,
    scaleOfCapture: `${sx.toFixed(4)} px/css (${c.truth.edges} edges)`, scaleOfImage: `${fitted.x?.slope.toFixed(4)}`, start: `${fitted.x?.start.toFixed(2)}, ${fitted.y?.start.toFixed(2)}`,
    end: `${fitted.x?.end.toFixed(2)}, ${fitted.y?.end.toFixed(2)}`, blend: `${fitted.x?.blend} ${fitted.y?.blend}`,
  }
  console.log(JSON.stringify(row))
  const expect = { x0: region.x, y0: region.y, x1: region.x + region.width, y1: region.y + region.height }
  const dev = (css, s) => Math.abs(css) * s
  const startErr = Math.max(dev(fitted.x.start - expect.x0, sx), dev(fitted.y.start - expect.y0, sy))
  const endErr = Math.max(dev(fitted.x.end - expect.x1, sx), dev(fitted.y.end - expect.y1, sy))
  note(`${c.label}: the image starts at the region's left and top edges, within one device pixel`, startErr <= 1, `error ${startErr.toFixed(2)} px; image starts at ${fitted.x.start.toFixed(2)}, ${fitted.y.start.toFixed(2)} CSS px; region ${expect.x0}, ${expect.y0}`)
  if (!expectClipped) {
    note(`${c.label}: the image ends at the region's right and bottom edges, within one device pixel`, endErr <= 1, `error ${endErr.toFixed(2)} px; image ends at ${fitted.x.end.toFixed(2)}, ${fitted.y.end.toFixed(2)} CSS px; region ${expect.x1}, ${expect.y1}`)
    const w = Math.abs(a.width - region.width * sx)
    const h = Math.abs(a.height - region.height * sy)
    note(`${c.label}: the image's sides are the region's sides times the capture's scale, within one device pixel`, w <= 1 && h <= 1, `${a.width}x${a.height} for ${(region.width * sx).toFixed(1)}x${(region.height * sy).toFixed(1)}`)
  }
  note(`${c.label}: no edge in the image is blurred (at most one pixel between two cells)`, fitted.x.blend <= 1 && fitted.y.blend <= 1, `most pixels at an edge: ${fitted.x.blend} across, ${fitted.y.blend} down`)
  note(`${c.label}: no pixel of the image is outside the grid colours`, expectClipped || a.anomalies === 0, `${a.anomalies}`)
}

try {
  await grant('add')
  const big = { x: 20, y: 20, width: 640, height: 680 }
  // The ratio is the page's pixel ratio at that zoom: 1.0 at 2/3, 1.5 at 1, 2.0 at 4/3.
  const GEOMETRY = [
    { label: 'crop-ratio-1.0', zoom: 2 / 3, rect: big },
    { label: 'crop-ratio-1.5', zoom: 1, rect: big },
    { label: 'crop-ratio-2.0', zoom: 4 / 3, rect: big },
    { label: 'crop-ratio-1.8', zoom: 1.2, rect: big },
    { label: 'crop-small-ratio-1.5', zoom: 1, rect: { x: 120, y: 80, width: 200, height: 150 } },
    { label: 'crop-small-ratio-2.0', zoom: 4 / 3, rect: { x: 120, y: 80, width: 200, height: 150 } },
    { label: 'crop-scrolled-ratio-1.5', zoom: 1, rect: { x: 20, y: 100, width: 640, height: 600 }, scrollBy: 80 },
    { label: 'crop-scrolled-ratio-2.0', zoom: 4 / 3, rect: { x: 20, y: 100, width: 640, height: 600 }, scrollBy: 80 },
  ]
  const wanted = process.env.CASES ? process.env.CASES.split(',') : null
  for (const c of GEOMETRY.filter((c) => wanted === null || wanted.includes(c.label))) {
    console.log(`\n--- ${c.label} ---`)
    try {
      const result = await runCase(c)
      report(result, { region: c.rect, scrollBy: c.scrollBy, expectClipped: c.expectClipped })
      if (c.scrollBy && result.ok) note(`${c.label}: the request reports that the area moved because of the scroll`, result.moved === true)
    } catch (error) {
      note(`${c.label}: the case ran to the end`, false, String(error.message ?? error).slice(0, 200))
    }
  }

  /* ---- the size limit ---------------------------------------------------- */
  if (wanted === null || wanted.includes('size-limit')) {
    console.log('\n--- size limit ---')
    await B.run(`browser.windows.update(${windowBefore.id}, { left: 0, top: 0, width: 2540, height: 1400 }).then(w => 'resized')`)
    await sleep(2500)
    try {
      const label = 'crop-size-limit'
      const url = uniqueUrl(`http://localhost:${PAGE_PORT}/`, label)
      const id = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: true }).then(t => t.id)`))
      await sleep(1800)
      await B.run(`browser.tabs.setZoom(${id}, 1)`)
      await sleep(1200)
      const vp = JSON.parse(await B.run(`browser.tabs.sendMessage(${id}, { type: 'get-viewport' }).then(v => JSON.stringify(v))`))
      console.log('viewport after the window was enlarged:', JSON.stringify(vp))
      await grant('add')
      const ask = async (rect) => {
        const message = { type: 'capture-region', tabId: id, rect, viewportWidth: vp.width, url, devicePixelRatio: vp.devicePixelRatio }
        const raw = await O.long(`(async () => {
          const r = await browser.runtime.sendMessage(${JSON.stringify(message)});
          if (!r.ok) return JSON.stringify({ ok: false, error: r.error });
          const a = JSON.parse(await (${ANALYSE})(r.data.dataUrl));
          return JSON.stringify({ ok: true, clipped: r.data.clipped, reduced: r.data.reduced ?? null, bytes: Math.round(r.data.dataUrl.length * 3 / 4), width: a.width, height: a.height, anomalies: a.anomalies, row: a.row, column: a.column });
        })()`)
        return JSON.parse(raw)
      }
      const large = await ask({ x: 0, y: 0, width: Math.floor(vp.width), height: Math.floor(vp.height) })
      console.log('full viewport:', JSON.stringify({ ...large, row: undefined, column: undefined }))
      const longerSide = large.ok ? Math.max(large.width, large.height) : 0
      const fullSize = large.reduced ? Math.max(large.reduced.from.width, large.reduced.from.height) : longerSide
      note('control: the region before the limit is larger than 1568 pixels on its longer side', fullSize > 1568, `${large.reduced ? `${large.reduced.from.width}x${large.reduced.from.height}` : `${large.width}x${large.height}`}`)
      note('an image over the limit comes back with a longer side of 1568 pixels', large.ok && longerSide === 1568, `${large.width}x${large.height}`)
      note('the reduced image keeps its shape', large.ok && large.reduced && Math.abs(large.width / large.height - large.reduced.from.width / large.reduced.from.height) < 0.002, large.reduced ? `${(large.width / large.height).toFixed(4)} against ${(large.reduced.from.width / large.reduced.from.height).toFixed(4)}` : 'not reduced')
      note('the reply says it was reduced, with both sizes', large.ok && large.reduced && large.reduced.to.width === large.width && large.reduced.to.height === large.height, JSON.stringify(large.reduced))
      note('the reduced image has no pixel outside the grid colours except those the reduction blends at edges (counted, not asserted)', true, `anomalies ${large.anomalies} of ${large.width * large.height}`)
      console.log(`INFORMATION size limit: the image is ${Math.round(large.bytes / 1024)} KB`)
      // Control: a small region of the same page is not touched.
      const small = await ask({ x: 100, y: 100, width: 300, height: 200 })
      note('control: a region whose image is under the limit is not reduced', small.ok && small.reduced === null, `${small.width}x${small.height}`)
      await B.run(`browser.tabs.remove(${id}).catch(() => {})`)
    } catch (error) {
      note('the size limit case ran to the end', false, String(error.message ?? error).slice(0, 300))
    } finally {
      await B.run(`browser.windows.update(${windowBefore.id}, { left: ${windowBefore.left}, top: ${windowBefore.top}, width: ${windowBefore.width}, height: ${windowBefore.height} }).then(() => 'restored')`)
      await sleep(1500)
    }
  }
} catch (error) {
  note('the probe ran to the end', false, String(error.message ?? error).slice(0, 300))
} finally {
  await B.run(`browser.tabs.remove(${optionsTab}).catch(() => {})`)
  if (!heldBefore) await grant('remove')
  note('control: the all-sites grant is back to what it was', (await B.run(`browser.permissions.contains(${ALL_SITES})`)) === String(heldBefore))
  const windowAfter = JSON.parse(await B.run(`browser.windows.getAll().then(ws => JSON.stringify({ width: ws[0].width, height: ws[0].height }))`))
  note('control: the window is back to its size', windowAfter.width === windowBefore.width && windowAfter.height === windowBefore.height, JSON.stringify(windowAfter))
  const ok = verdict(rows)
  servers.close()
  rdp.close()
  process.exit(ok ? 0 : 1)
}
