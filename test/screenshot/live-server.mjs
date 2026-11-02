/**
 * Serves the page for the paid run of #37. The badge holds a canvas whose
 * drawing is not in the page's text or markup: an orange circle, a small blue
 * square and a word. Only the screenshot shows them.
 */
import { createServer } from 'node:http'

export const LIVE_PORT = 8795

export const LIVE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>badge page</title>
<style>
  body { margin: 0; padding: 24px; font: 16px sans-serif; background: #f4f4f4 }
  #badge { width: 360px; padding: 16px; background: #fff; border: 1px solid #bbb }
  #badge h2 { margin: 0 0 12px; font-size: 18px }
  canvas { display: block }
</style></head><body>
<main><section id="badge"><h2>Featured badge</h2>
<canvas id="art" width="320" height="200" role="img"></canvas></section></main>
<script>
  const c = document.getElementById('art').getContext('2d')
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, 320, 200)
  c.fillStyle = '#e8590c'; c.beginPath(); c.arc(110, 100, 78, 0, Math.PI * 2); c.fill()
  c.fillStyle = '#1c7ed6'; c.fillRect(240, 20, 50, 50)
  c.fillStyle = '#111111'; c.font = 'bold 28px sans-serif'; c.textBaseline = 'middle'
  c.fillText('ZEBRA-42', 140, 170)
</script></body></html>`

createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(LIVE_PAGE)
}).listen(LIVE_PORT, '127.0.0.1', () => console.log(`live page on http://localhost:${LIVE_PORT}/`))
