/**
 * Oracle for the user script world CSP.
 *
 * The important design choice: this server, not the probe, decides what
 * happened. The probe fires six kinds of network egress at `/egress`, and
 * anything that arrives here escaped the CSP.
 *
 * Asking the probe to report its own outcome would be weaker evidence. A
 * `fetch` can reject for a dozen reasons that are not CSP — offline, DNS,
 * CORS, an abort — and a probe that catches an exception cannot tell which it
 * was. A request that reaches this process is unambiguous: the sandbox leaked.
 * A request that does not arrive within the window is treated as blocked, and
 * the run is only meaningful because the control below proves the path works.
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = 8787
const SETTLE_MS = 4000

/** Every egress method the probe attempts, and what it means if it arrives. */
const METHODS = [
  ['fetch', 'connect-src'],
  ['xhr', 'connect-src'],
  ['websocket', 'connect-src'],
  ['beacon', 'connect-src'],
  ['eventsource', 'connect-src'],
  ['image', 'img-src'],
]

const arrived = new Set()
let probeReported = null
let finished = false

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`)

  if (url.pathname === '/egress') {
    const via = url.searchParams.get('via') ?? 'unknown'
    arrived.add(via)
    console.log(`  !! egress arrived via ${via}`)
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
    response.end()
    return
  }

  /*
   * The control. This is fired by the *page*, which has no extension CSP, so
   * it must always arrive. If it does not, the probe never ran or the server
   * is unreachable, and "nothing arrived" would otherwise be misread as a
   * pass — the most dangerous possible false negative for this test.
   */
  if (url.pathname === '/control') {
    arrived.add('control')
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
    response.end()
    return
  }

  if (url.pathname === '/report' && request.method === 'POST') {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      try {
        probeReported = JSON.parse(body)
      } catch {
        probeReported = { parseError: body.slice(0, 200) }
      }
      response.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
      response.end()
      setTimeout(finish, SETTLE_MS)
    })
    return
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(readFileSync(join(HERE, 'page.html'), 'utf8'))
    return
  }

  response.writeHead(404)
  response.end()
})

function finish() {
  if (finished) return
  finished = true

  console.log('\n' + '='.repeat(64))
  console.log('user script world CSP — verification result')
  console.log('='.repeat(64))

  if (!arrived.has('control')) {
    console.log('\nINCONCLUSIVE — the control request never arrived.')
    console.log('The probe did not run, or could not reach this server.')
    console.log('Nothing can be concluded about the CSP from this run.\n')
    server.close()
    process.exitCode = 2
    return
  }

  console.log('\ncontrol request arrived, so the path to this server works.\n')

  let escaped = 0
  for (const [method, directive] of METHODS) {
    const leaked = arrived.has(method)
    if (leaked) escaped += 1
    const local = probeReported?.[method]
    console.log(
      `  ${leaked ? 'ESCAPED ' : 'blocked '} ${method.padEnd(12)} ${directive.padEnd(12)}` +
        (local ? `probe saw: ${String(local).slice(0, 48)}` : ''),
    )
  }

  console.log('')
  if (escaped === 0) {
    console.log('All egress was contained. The capability model holds as written.')
  } else {
    console.log(
      `${escaped} of ${METHODS.length} escaped. The CSP does NOT contain the world,`,
    )
    console.log('and every claim that a declared capability is enforced is wrong')
    console.log('for the escaping methods. Fix the directives or the claim.')
  }
  console.log('')

  server.close()
  process.exitCode = escaped === 0 ? 0 : 1
}

server.listen(PORT, () => {
  console.log(`CSP probe oracle listening on http://localhost:${PORT}`)
  console.log('Open that page in the Firefox instance with the extension loaded,')
  console.log('then use the sidebar\'s "Run CSP probe" button.\n')
})

// Never hang a CI run or an unattended terminal.
setTimeout(() => {
  if (!probeReported) {
    console.log('\nTimed out waiting for the probe to report.')
    finish()
  }
}, 120_000)
