/**
 * The oracle for the runtime guard probe: a loopback server that records which
 * requests reach it. The probe asks this server, and not the code under test,
 * whether a request left the browser.
 *
 * It also serves the probe page at /page. The page has to come from here and not
 * from a public site: Firefox does not let a page on a public https origin
 * request loopback addresses, so the controls would fail for a reason that has
 * nothing to do with the guard.
 *
 * Every request carries a `via` value naming the route and the feature that made
 * it, for example `timerThis.fetch`. WebSocket handshakes arrive as an upgrade
 * event and are recorded the same way.
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

export const PORT = 8791

export function startServer() {
  const arrived = new Set()
  const note = (url) => {
    const via = new URL(url, `http://localhost:${PORT}`).searchParams.get('via')
    if (via) arrived.add(via)
  }
  const server = createServer((request, response) => {
    note(request.url)
    const path = new URL(request.url, `http://localhost:${PORT}`).pathname
    if (path === '/page' || path === '/page-csp') {
      // /page-csp has a policy of its own that refuses images, fonts, frames and
      // stylesheet imports, to show which of the inserted elements the page's
      // policy governs.
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        ...(path === '/page-csp'
          ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; frame-src 'none'" }
          : {}),
      })
      response.end('<!doctype html><html><head><meta charset="utf-8"><title>runtime guard probe</title></head><body><main><p id="subject">Probe page</p></main></body></html>')
      return
    }
    if (path === '/page-style') {
      // A page with a style element of its own, for the routes that change one.
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html><head><meta charset="utf-8"><title>style</title><style id="pagestyle">main { margin: 0 }</style></head><body><main><p id="subject">Probe page with a style element</p></main></body></html>')
      return
    }
    if (path === '/page-frames' || path === '/blank') {
      // /page-frames already has two same-origin frames, one of them named, so
      // that a window reached by index without the transform creating anything
      // can be measured.
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        path === '/blank'
          ? '<!doctype html><html><body>blank frame</body></html>'
          : '<!doctype html><html><head><meta charset="utf-8"><title>frames</title></head><body><main><p id="subject">Probe page with frames</p><iframe name="wa_existing" src="/blank"></iframe><iframe src="/blank"></iframe></main></body></html>',
      )
      return
    }
    const type = path.endsWith('.css')
      ? 'text/css'
      : path === '/mod.js'
        ? 'text/javascript'
        : 'text/plain'
    response.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' })
    response.end(path === '/mod.js' ? 'export default 1' : '')
  })
  server.on('upgrade', (request, socket) => {
    note(request.url)
    // The handshake is completed and the connection is closed at once. A refused
    // handshake makes Firefox delay every later WebSocket to this host, so the
    // attempts after the first would arrive late or not at all, which looks like
    // a block.
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    socket.end(Buffer.from([0x88, 0x00]))
  })
  return new Promise((resolve) =>
    server.listen(PORT, () =>
      resolve({
        arrived,
        reset: () => arrived.clear(),
        close: () => server.close(),
      }),
    ),
  )
}
