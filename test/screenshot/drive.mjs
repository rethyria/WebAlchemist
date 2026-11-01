/**
 * Helpers that drive the real sidebar and the real picker over the remote
 * debugging protocol, and read the images they produce.
 *
 * Input has to be trusted. The picker ignores events that a page script
 * dispatched (isUserEvent in src/content/picker-input.ts), and
 * permissions.request needs a user input handler. Events dispatched from the
 * chrome-privileged global of the process that holds the window, with
 * windowUtils.dispatchDOMEventViaPresShellForTesting, have isTrusted set. That
 * method reads screenX and screenY in device pixels and derives clientX and
 * clientY from them, so both are computed from the intended client position.
 * Each helper that sends a mouse event reads the position back from a listener
 * in the page, so a position that was converted wrongly is reported and not
 * assumed.
 */
import { sleep } from '../crypto/rdp.mjs'
import { CELL, cellColor } from './server.mjs'

/** An evaluator in the content process that holds a window whose address contains `needle`. */
export async function inWindow(rdp, needle, body) {
  const list = await rdp.send({ to: 'root', type: 'listProcesses' })
  for (const process of list.processes.filter((p) => !p.isParent)) {
    const target = await rdp.send({ to: process.actor, type: 'getTarget' })
    const evaluator = rdp.mkEval((target.process ?? target.target).consoleActor)
    const result = await evaluator.run(`(() => {
      try {
        const en = Services.ww.getWindowEnumerator();
        while (en.hasMoreElements()) {
          const w = en.getNext();
          if (!String(w.location && w.location.href).includes(${JSON.stringify(needle)})) continue;
          ${body}
        }
        return 'no window';
      } catch (e) { return 'ERR ' + e.message }
    })()`)
    if (result !== 'no window') return result
  }
  return 'no window'
}

const FIRE = `const fire = (target, type, x, y, buttons) => w.windowUtils.dispatchDOMEventViaPresShellForTesting(target, new w.MouseEvent(type, {
  bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
  screenX: (w.mozInnerScreenX + x) * w.devicePixelRatio, screenY: (w.mozInnerScreenY + y) * w.devicePixelRatio,
  button: 0, buttons, view: w, detail: type === 'mousemove' ? 0 : 1 }));`

/** A trusted click on the first element matching `find` (an expression using `w` and returning an element) in a window. */
export function trustedClick(rdp, needle, find, times = 1) {
  return inWindow(
    rdp,
    needle,
    `${FIRE}
     const el = (${find});
     if (!el) return 'no element';
     const r = el.getBoundingClientRect();
     const x = r.x + r.width / 2, y = r.y + r.height / 2;
     // The pointer moves onto the element first, as a hand would, so the page under
     // the pointer is the one that is clicked and not whatever was there before.
     fire(el, 'mousemove', x, y, 0);
     // No click event is dispatched: the page's event handling makes one from a
     // mouse down and up on the same element, and a second one doubled every action.
     for (let i = 0; i < ${times}; i++) { fire(el, 'mousedown', x, y, 1); fire(el, 'mouseup', x, y, 0); }
     return 'clicked';`,
  )
}

/** A trusted drag in the page, from (x0, y0) to (x1, y1) in client coordinates. */
export function trustedDrag(rdp, needle, [x0, y0, x1, y1]) {
  return inWindow(
    rdp,
    needle,
    `${FIRE}
     const at = (x, y) => w.document.elementFromPoint(Math.min(x, w.innerWidth - 1), Math.min(y, w.innerHeight - 1)) || w.document.body;
     fire(at(${x0}, ${y0}), 'mousemove', ${x0}, ${y0}, 0);
     fire(at(${x0}, ${y0}), 'mousedown', ${x0}, ${y0}, 1);
     for (let i = 1; i <= 6; i++) {
       const x = ${x0} + (${x1} - ${x0}) * i / 6, y = ${y0} + (${y1} - ${y0}) * i / 6;
       fire(at(x, y), 'mousemove', x, y, 1);
     }
     fire(at(${x1}, ${y1}), 'mouseup', ${x1}, ${y1}, 0);
     return 'dragged';`,
  )
}

/** A trusted click in the page at a client position. */
export function trustedPageClick(rdp, needle, x, y) {
  return inWindow(
    rdp,
    needle,
    `${FIRE}
     const el = w.document.elementFromPoint(${x}, ${y}) || w.document.body;
     fire(el, 'mousemove', ${x}, ${y}, 0); fire(el, 'mousedown', ${x}, ${y}, 1); fire(el, 'mouseup', ${x}, ${y}, 0);
     return 'clicked';`,
  )
}

/**
 * Source of a function run in an extension page: decodes an image of the grid
 * page and returns what node needs to check it. A row and a column through the
 * middle of the image are returned in full, with the count of pixels whose blue
 * channel is not the grid's (anything the extension drew over the page).
 */
export const ANALYSE = `async (dataUrl) => {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  let anomalies = 0;
  for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i + 2] - 128) > 1) anomalies += 1;
  const pixel = (u, v) => { const k = (v * bitmap.width + u) * 4; return [data[k], data[k + 1], data[k + 2]] };
  const midV = Math.floor(bitmap.height / 2), midU = Math.floor(bitmap.width / 2);
  return JSON.stringify({
    width: bitmap.width, height: bitmap.height, anomalies,
    row: Array.from({ length: bitmap.width }, (_, u) => pixel(u, midV)),
    column: Array.from({ length: bitmap.height }, (_, v) => pixel(midU, v)),
  });
}`

const LOW = 20
const HIGH = 230

/**
 * Edge positions along a line of pixels, in device pixels, to a fraction of a
 * pixel. An edge is a step between the two plateau values of `channel`. The
 * pixels between the last pixel of one plateau and the first of the next are
 * blends of the two cells, and the share of the first cell in them is how far
 * the edge lies beyond the last full pixel of that cell.
 */
function edgesAlong(line, channel) {
  const value = (pixel) => pixel[channel]
  const plateau = (v) => (Math.abs(v - LOW) <= 3 ? LOW : Math.abs(v - HIGH) <= 3 ? HIGH : null)
  const edges = []
  let last = null // index of the last pixel that was a full plateau, with its value
  for (let i = 0; i < line.length; i += 1) {
    const p = plateau(value(line[i]))
    if (p === null) continue
    if (last !== null && p !== last.value) {
      let covered = 0
      for (let k = last.index + 1; k < i; k += 1) covered += (p - value(line[k])) / (p - last.value)
      edges.push(last.index + 1 + covered)
    }
    last = { index: i, value: p }
  }
  return edges
}

/**
 * Where on the page an analysed image starts and ends. Every edge between
 * cells is at a multiple of CELL on the page. Given roughly where the image
 * should start (`near`, in page CSS pixels), each edge says which multiple it
 * is and so where the image's first pixel is; the median of those is the
 * answer, and the spread says how well the edges agree.
 */
export function placeOnPage(analysis, scale, near) {
  const place = (line, channel, length, from) => {
    const edges = edgesAlong(line, channel)
    if (edges.length === 0) return null
    const starts = edges
      .map((at) => CELL * Math.round((from + at / scale) / CELL) - at / scale)
      .sort((a, b) => a - b)
    const start = starts[Math.floor(starts.length / 2)]
    const measured = edges.length > 1 ? (edges[edges.length - 1] - edges[0]) / (edges.length - 1) / CELL : null
    return { start, end: start + length / scale, edges: edges.length, spread: starts[starts.length - 1] - starts[0], measuredScale: measured }
  }
  return {
    x: place(analysis.row, 0, analysis.width, near.x),
    y: place(analysis.column, 1, analysis.height, near.y),
  }
}

export { cellColor }
export { sleep }
