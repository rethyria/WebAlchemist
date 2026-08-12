/**
 * W5 / #35 — does the wait the provider asked for reach the panel?
 *
 * The parsing is unit-tested in `src/background/providers/retry-after.test.ts`,
 * against every header shape the two ecosystems use. What a unit test cannot
 * answer is whether the number survives the trip: adapter → ProviderError →
 * the message boundary → BackgroundError → the flow's error object. That path
 * crosses two serialisation boundaries, and an undefined dropped at either of
 * them looks exactly like a provider that said nothing.
 *
 * Run the stub first:
 *
 *   HOLD_MS=200 STATUS=429 RETRY_AFTER=17 node test/badge/stub-provider.mjs
 *
 * Nothing is spent: the stub is a loopback provider, which needs no credential.
 */
import { open, verdict } from '../crypto/rdp.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EXPECTED = 17

const rdp = open()
const ctx = await rdp.contexts({ waitMs: 3000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  process.exit(1)
}

const snapshot = await B.long(
  `browser.storage.local.get('settings').then(s => JSON.stringify(s.settings ?? null))`,
)
const out = {}
let tab = -1

try {
  /*
   * A background fetch to another origin is subject to CORS like any other, so
   * the stub is unreachable without a host permission for it — the first run of
   * this probe reported "Could not reach" and a `network` kind, which is what
   * that looks like from the panel. Granted through the parent process because
   * permissions.request needs a live gesture, and revoked at the end.
   */
  console.log('grant:', await ctx.parent.run(`(async () => {
    const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs")
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs")
    const ext = ExtensionParent.GlobalManager.extensionMap.get("@webalchemist")
    await ExtensionPermissions.add("@webalchemist", { permissions: [], origins: ["http://localhost/*"] }, ext)
    return "granted http://localhost/*"
  })()`))
  await sleep(1500)

  await B.run(`(async () => {
    const s = await browser.storage.local.get('settings')
    await browser.storage.local.set({ settings: { ...(s.settings || {}),
      providers: [{ id: 'wa-429', label: '429 stub', type: 'openai-compatible',
        baseUrl: 'http://localhost:8789/v1', generateModel: 'stub', reviewModel: 'stub',
        supportsVision: false }],
      activeProviderId: 'wa-429' } })
    return 'stub provider active'
  })()`)

  const url = `${ctx.baseUrl()}src/options/index.html`
  tab = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: false }).then(t => t.id)`))
  let O = null
  for (let i = 0; i < 15; i += 1) {
    await sleep(800)
    await ctx.refresh()
    O = ctx.find('src/options/index.html')
    if (O && (await O.raw('typeof browser')) === 'object') break
    O = null
  }
  if (!O) throw new Error('options page never appeared')

  const CONTEXT = `{ url: 'https://example.com/', target: { selector: 'h1', tag: 'h1',
    outerHTMLExcerpt: '<h1>', computedStyles: {}, matchedRules: [] },
    ancestors: [], customProperties: {} }`

  /* The port path, which is what a real generation uses. */
  out.overPort = await O.long(`new Promise(resolve => {
    const port = browser.runtime.connect({ name: 'wa-generate' })
    port.onMessage.addListener(m => { if (m.type === 'error') resolve(JSON.stringify(m.error)) })
    port.postMessage({ context: ${CONTEXT}, instruction: 'probe', history: [] })
    setTimeout(() => resolve('(no error message arrived)'), 20000)
  })`)
  console.log('error over the generate port:', out.overPort)

  /* And the one-shot path, which repair and the editor use. */
  out.overMessage = await O.long(`browser.runtime.sendMessage({ type: 'generate',
    context: ${CONTEXT}, instruction: 'probe', history: [] })
    .then(r => JSON.stringify(r.error ?? r), e => 'ERR ' + e.message)`)
  console.log('error over sendMessage    :', out.overMessage)
} finally {
  console.log(
    '\nrestore settings:',
    await B.run(`browser.storage.local.set({ settings: ${snapshot} }).then(() => 'restored')`),
  )
  if (tab > 0) await B.run(`browser.tabs.remove(${tab}).catch(() => {}).then(() => 'closed')`)
  console.log('revoke:', await ctx.parent.run(`(async () => {
    const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs")
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs")
    const ext = ExtensionParent.GlobalManager.extensionMap.get("@webalchemist")
    await ExtensionPermissions.remove("@webalchemist", { permissions: [], origins: ["http://localhost/*"] }, ext)
    return "revoked"
  })()`))
}

const port = out.overPort?.startsWith('{') ? JSON.parse(out.overPort) : null
const message = out.overMessage?.startsWith('{') ? JSON.parse(out.overMessage) : null

verdict([
  [`control  the stub really returned a rate limit (${port?.kind ?? message?.kind})`,
    (port?.kind ?? message?.kind) === 'rate-limit'],
  [`control  the error is marked retryable (${port?.retryable})`, port?.retryable === true],
  [`test     retryInSeconds crosses the generate port (${port?.retryInSeconds})`,
    port?.retryInSeconds === EXPECTED],
  [`test     retryInSeconds crosses sendMessage (${message?.retryInSeconds})`,
    message?.retryInSeconds === EXPECTED],
  [`test     the message names the wait rather than saying "a moment"`,
    new RegExp(`${EXPECTED} seconds`).test(port?.message ?? '')],
])

rdp.close()
