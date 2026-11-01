/**
 * Loopback servers for the screenshot probe.
 *
 * The grid page is the subject of the screenshots. Each 40 by 40 CSS pixel cell
 * has a solid colour that depends on the parity of its column and row, so the edges between cells
 * in a captured image show where the image starts and ends on the page, to a
 * small fraction of a pixel.
 *
 * The stub provider on a second port is an OpenAI-compatible endpoint that
 * records what it is sent and returns an error. It is the place where "what
 * would be sent to the provider" can be read without a provider.
 */
import { createServer } from 'node:http'

export const PAGE_PORT = 8793
export const PROVIDER_PORT = 8794
export const CELL = 40
export const COLUMNS = 40
export const ROWS = 80

/**
 * Cell colour. Red alternates between 20 and 230 by column and green by row, so
 * every edge between cells is a large step in one channel, and the blend in an
 * edge pixel (cells that do not land on whole device pixels at a fractional
 * zoom) can be read to a small fraction of a pixel. Blue is constant, so a pixel
 * whose blue differs is not from the grid: a dimming layer, an outline or text
 * of the extension changes it.
 */
export const cellColor = (column, row) => [column % 2 ? 230 : 20, row % 2 ? 230 : 20, 128]

const GRID_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>screenshot probe grid</title>
<style>
html, body { margin: 0; padding: 0; background: #fff }
#grid { position: relative; width: ${COLUMNS * CELL}px; height: ${ROWS * CELL}px }
#grid div { position: absolute; width: ${CELL}px; height: ${CELL}px }
</style></head><body><main><div id="grid"></div></main>
<script>
const grid = document.getElementById('grid')
const frag = document.createDocumentFragment()
for (let r = 0; r < ${ROWS}; r++) for (let c = 0; c < ${COLUMNS}; c++) {
  const d = document.createElement('div')
  d.style.left = c * ${CELL} + 'px'; d.style.top = r * ${CELL} + 'px'
  d.style.background = 'rgb(' + (c % 2 ? 230 : 20) + ',' + (r % 2 ? 230 : 20) + ',128)'
  frag.appendChild(d)
}
grid.appendChild(frag)
</script></body></html>`

const OTHER_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>other page</title>
<style>html, body { margin: 0; background: rgb(250, 10, 10); height: 100vh }</style></head><body><p>A different page, solid red.</p></body></html>`

export function startServers() {
  const received = []
  const page = createServer((request, response) => {
    const path = new URL(request.url, `http://localhost:${PAGE_PORT}`).pathname
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(path === '/other' ? OTHER_PAGE : GRID_PAGE)
  })
  const provider = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      received.push({ method: request.method, url: request.url, body })
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'screenshot probe stub provider' } }))
    })
  })
  return new Promise((resolve) =>
    page.listen(PAGE_PORT, () =>
      provider.listen(PROVIDER_PORT, () =>
        resolve({
          received,
          close: () => {
            page.close()
            provider.close()
          },
        }),
      ),
    ),
  )
}
