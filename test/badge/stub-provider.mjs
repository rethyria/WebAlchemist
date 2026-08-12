/**
 * An OpenAI-compatible endpoint that takes its time and returns nothing useful.
 *
 * The badge's working state is raised before the provider call and lowered
 * after it. Testing that against a real provider makes a real request against
 * the user's key; testing it against a provider that fails instantly leaves no
 * window to observe — the raise and the lower both land inside the polling gap,
 * which is exactly what the first two attempts at this run hit.
 *
 * So: a real provider, reached through the real adapter, that holds the request
 * open for a known number of seconds. A loopback base URL needs no credential
 * (`isLoopback` in openai-compatible.ts), so nothing has to be stored to use it.
 */

import { createServer } from 'node:http'

const PORT = 8789
const HOLD_MS = Number(process.env['HOLD_MS'] ?? 6000)

createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    console.log(`${request.method} ${request.url} — holding ${HOLD_MS}ms`)
    setTimeout(() => {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'stub provider, deliberately unhelpful' } }))
    }, HOLD_MS)
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`stub provider on http://localhost:${PORT}/v1 holding ${HOLD_MS}ms per request`)
})
