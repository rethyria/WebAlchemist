/**
 * Runs a string of code as a user script in a USER_SCRIPT world on a test page,
 * and reads back the attribute that the code wrote. Shared by the probes that
 * measure one part of the guard at a time (frames.mjs and styles.mjs).
 */
import { open, uniqueUrl, sleep } from '../crypto/rdp.mjs'

export const STRICT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "connect-src 'none'",
  "img-src 'none'",
].join('; ')

export async function connectWorld() {
  const rdp = open()
  const ctx = await rdp.contexts({ waitMs: 8000 })
  if (!ctx.background) {
    rdp.close()
    throw new Error('BACKGROUND NOT ALIVE')
  }
  const B = ctx.background
  let counter = 0
  /**
   * Registers `code`, opens `pagePath` and waits for the attribute `attribute`
   * to hold JSON. `after` is evaluated in the page afterwards (from its own
   * context) and its JSON result is returned as `page`.
   */
  async function run({ code, csp = STRICT_CSP, pagePath = '/page', attribute = 'data-wa-rg', after = null, settleMs = 1500 }) {
    counter += 1
    const label = `world-${Date.now()}-${counter}`
    const script = 'wa-world-probe'
    await B.run(`(async () => {
      try { await browser.userScripts.unregister({ ids: [${JSON.stringify(script)}] }) } catch {}
      await browser.userScripts.configureWorld({ worldId: 'wa-world-probe', csp: ${JSON.stringify(csp)}, messaging: false })
      await browser.userScripts.register([{ id: ${JSON.stringify(script)}, matches: ['http://localhost/*'],
        js: [{ code: ${JSON.stringify(code)} }], world: 'USER_SCRIPT', worldId: 'wa-world-probe', runAt: 'document_idle' }])
      return 'registered'
    })()`)
    const tabId = Number(
      await B.run(`browser.tabs.create({ url: ${JSON.stringify(uniqueUrl(`http://localhost:8791${pagePath}`, label))}, active: true }).then(t => t.id)`),
    )
    let report = null
    let page = null
    try {
      let tab = null
      for (let i = 0; i < 40 && !report; i += 1) {
        await sleep(500)
        tab ??= await ctx.tab(`wa-probe=${label}`)
        if (!tab) continue
        const raw = await tab.long(`document.documentElement.getAttribute(${JSON.stringify(attribute)}) || ''`)
        if (raw.startsWith('{')) report = JSON.parse(raw)
      }
      if (tab && after) {
        const raw = await tab.long(`(async () => JSON.stringify(await (${after})()))()`)
        try { page = JSON.parse(raw) } catch { page = { raw } }
      }
      await sleep(settleMs)
    } finally {
      await B.run(`browser.tabs.remove(${tabId}).catch(() => {})`)
      await B.run(`browser.userScripts.unregister({ ids: [${JSON.stringify(script)}] }).then(() => 'x', () => 'x')`)
    }
    return { report, page }
  }
  return { rdp, ctx, B, run, close: () => rdp.close() }
}
