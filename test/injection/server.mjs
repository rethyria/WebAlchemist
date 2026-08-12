/**
 * Serves the injection fixture over http.
 *
 * A file:// page would do for reading markup, but content scripts are
 * registered against granted origins and `file://` is not one of them. Serving
 * on localhost puts the fixture on the same footing as a real site, which is
 * the point — the measurement has to run through the real injection path or it
 * is measuring something else.
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = 8788

createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0]
  if (path === '/' || path === '/page.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(readFileSync(join(HERE, 'page.html')))
    return
  }
  response.writeHead(404)
  response.end('not here')
}).listen(PORT, '127.0.0.1', () => {
  console.log(`injection fixture on http://localhost:${PORT}/`)
})
