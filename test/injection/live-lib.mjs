/**
 * Shared helpers for the paid runs against a real model (#37 and #44).
 *
 * The runs drive the real sidebar and the real picker in the development
 * Firefox, with trusted input, and use the real provider that is configured in
 * the development profile. Nothing here reads, prints or stores a credential:
 * the stored settings hold none (credentials are a separate key that is never
 * read), and the request recorder keeps the body of a request to the provider
 * and never its headers.
 *
 * Every model call is appended to a ledger file when its usage is read from the
 * extension's own report, and `assertBudget` refuses to start another call once
 * the ledger is at the call limit or the cost limit.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { open, sleep } from '../crypto/rdp.mjs'
import { inWindow, trustedClick, trustedDrag, trustedPageClick } from '../screenshot/drive.mjs'

export { sleep, inWindow, trustedClick, trustedDrag, trustedPageClick }

export const SIDEBAR = 'src/sidebar/index.html'
export const ORIGINAL = '/tmp/wa/orig.json'
export const LEDGER = '/tmp/wa/ledger.jsonl'
export const MAX_CALLS = 40
export const MAX_COST = 5
/** USD per million tokens, from the brief of the run. */
export const PRICES = {
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
}

mkdirSync('/tmp/wa', { recursive: true })

export function ledger() {
  if (!existsSync(LEDGER)) return []
  return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
export function totals() {
  const rows = ledger()
  return { calls: rows.length, cost: rows.reduce((s, r) => s + r.cost, 0) }
}
export function assertBudget(reserve = 0.4) {
  const t = totals()
  if (t.calls >= MAX_CALLS || t.cost + reserve > MAX_COST) {
    throw new Error(`BUDGET: ${t.calls} calls and $${t.cost.toFixed(4)} are recorded; stopping`)
  }
}
export function record(label, kind, model, inputTokens, outputTokens) {
  const price = PRICES[model]
  if (!price) throw new Error('no price for ' + model)
  const cost = (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000
  const row = { at: new Date().toISOString(), label, kind, model, inputTokens, outputTokens, cost }
  appendFileSync(LEDGER, JSON.stringify(row) + '\n')
  return row
}

export async function start() {
  const rdp = open()
  const ctx = await rdp.contexts({ waitMs: 8000 })
  const B = ctx.background
  if (!B) throw new Error('background not alive')
  const s = { rdp, ctx, B, parent: ctx.parent, openedTabs: [], sb: null }

  const rawSettings = () =>
    B.long(`browser.storage.local.get('settings').then(s => JSON.stringify(s.settings ?? null))`)
  s.rawSettings = rawSettings
  if (!existsSync(ORIGINAL)) {
    const original = {
      settings: await rawSettings(),
      ack: await B.long(`browser.storage.local.get('wa-disclosure-ack').then(s => JSON.stringify(s['wa-disclosure-ack'] ?? null))`),
      pref: await s.parent.run(`(() => { const p = 'extensions.webextOptionalPermissionPrompts'; return Services.prefs.prefHasUserValue(p) ? 'user:' + Services.prefs.getBoolPref(p) : 'default' })()`),
      transforms: await B.long(`browser.storage.local.get('transforms').then(s => JSON.stringify(s.transforms ?? null))`),
      localhost: await B.run(`browser.permissions.contains({ origins: ['http://localhost/*'] })`),
      allSites: await B.run(`browser.permissions.contains({ origins: ['<all_urls>'] })`),
    }
    writeFileSync(ORIGINAL, JSON.stringify(original))
  }
  s.original = JSON.parse(readFileSync(ORIGINAL, 'utf8'))

  s.sendFrom = (page, message) => page.long(`browser.runtime.sendMessage(${JSON.stringify(message)}).then(r => JSON.stringify(r))`)

  s.grant = (op, origins) =>
    s.parent.run(`(async () => {
      const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      const id = ${JSON.stringify(ctx.addon.id)}; const ext = ExtensionParent.GlobalManager.extensionMap.get(id);
      await ExtensionPermissions.${op}(id, { permissions: [], origins: ${JSON.stringify(origins)} }, ext);
      return 'done ${op}';
    })()`)

  s.newTab = async (url, active = true) => {
    const id = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: ${active} }).then(t => t.id)`))
    s.openedTabs.push(id)
    for (let i = 0; i < 30; i += 1) {
      await sleep(300)
      if ((await B.run(`browser.tabs.get(${id}).then(t => t.status)`)) === 'complete') break
    }
    return id
  }
  s.closeTabs = async () => {
    await B.run(`Promise.all(${JSON.stringify(s.openedTabs)}.map(id => browser.tabs.remove(id).catch(() => {}))).then(() => 'closed')`)
    s.openedTabs.length = 0
  }
  s.hideSidebar = () => s.parent.run(`(() => { const w = Services.wm.getMostRecentWindow('navigator:browser'); w.SidebarController.hide(); return 'hidden' })()`)
  s.showSidebar = async () => {
    await s.parent.run(`(async () => { const w = Services.wm.getMostRecentWindow('navigator:browser'); await w.SidebarController.show('_webalchemist-sidebar-action'); return 'shown' })()`)
    let sb = null
    for (let i = 0; i < 20 && !sb; i += 1) {
      await sleep(500)
      await ctx.refresh()
      sb = ctx.find(SIDEBAR)
    }
    s.sb = sb
    return sb
  }
  s.waitFor = async (page, expr, ms = 15000) => {
    for (let t = 0; t < ms; t += 400) {
      const v = await page.run(`(() => { try { return (${expr}) } catch { return false } })()`)
      if (v === 'true') return true
      await sleep(400)
    }
    return false
  }
  s.text = () => s.sb.long(`document.body.innerText`)
  s.sidebarButton = (label) => `[...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`
  s.hasButton = (label) => `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`
  s.click = (label) => trustedClick(rdp, SIDEBAR, s.sidebarButton(label))

  /** Logs every message the sidebar sends or receives, with images replaced by their length. */
  s.hookSidebar = () =>
    s.sb.run(`(() => {
      globalThis.__log = [];
      const clean = (m) => JSON.parse(JSON.stringify(m, (k, v) => (k === 'dataUrl' && typeof v === 'string' ? '[image ' + v.length + ' chars]' : v)));
      const oc = browser.runtime.connect.bind(browser.runtime);
      browser.runtime.connect = (...a) => {
        const p = oc(...a);
        p.onMessage.addListener((m) => __log.push({ t: Date.now(), port: p.name, msg: clean(m) }));
        const op = p.postMessage.bind(p);
        p.postMessage = (m) => { __log.push({ t: Date.now(), port: p.name, sent: clean(m) }); return op(m) };
        return p;
      };
      const os = browser.runtime.sendMessage.bind(browser.runtime);
      browser.runtime.sendMessage = (m, ...r) => {
        __log.push({ t: Date.now(), sent: clean(m) });
        const res = os(m, ...r);
        res.then((v) => __log.push({ t: Date.now(), reply: m && m.type, value: clean(v) }), (e) => __log.push({ t: Date.now(), replyError: m && m.type, message: String(e && e.message) }));
        return res;
      };
      return 'hooked';
    })()`)
  s.log = async (from = 0) => JSON.parse(await s.sb.long(`JSON.stringify(__log.slice(${from}))`))
  s.logLength = async () => Number(await s.sb.run(`__log.length`))

  /**
   * Records what is sent to the provider, as the extension's background sends
   * it: the URL, the method and a summary of the body, with the body's text. Headers are
   * never read, so the credential is not in the record.
   */
  s.hookRequests = () =>
    B.run(`(() => {
      if (globalThis.__reqWrapped) { globalThis.__reqs.length = 0; return 'reset' }
      const of = globalThis.fetch.bind(globalThis);
      globalThis.__reqs = [];
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        const rec = { t: Date.now(), url, method: init && init.method };
        try {
          if (init && typeof init.body === 'string' && /anthropic/.test(url)) {
            const body = JSON.parse(init.body);
            const content = (body.messages || []).flatMap((m) => (typeof m.content === 'string' ? [{ role: m.role, type: 'text', text: m.content }] : m.content.map((b) => ({ role: m.role, ...b }))));
            rec.model = body.model; rec.maxTokens = body.max_tokens; rec.stream = body.stream; rec.thinking = body.thinking; rec.output = body.output_config && Object.keys(body.output_config);
            rec.systemLength = JSON.stringify(body.system || '').length;
            rec.images = [];
            for (const b of content) {
              if (b.type === 'image') {
                const data = b.source && b.source.data || '';
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
                rec.images.push({ role: b.role, media_type: b.source && b.source.media_type, base64Length: data.length, sha256: [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join(''), data });
              }
            }
            rec.texts = content.filter((b) => b.type === 'text').map((b) => ({ role: b.role, text: b.text }));
            rec.blockTypes = content.map((b) => b.type);
            rec.system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system);
          }
        } catch (e) { rec.error = String(e.message) }
        __reqs.push(rec);
        return of(input, init);
      };
      globalThis.__reqWrapped = true;
      return 'wrapped';
    })()`)
  s.requests = async () => JSON.parse(await B.long(`JSON.stringify(__reqs)`))

  /** Changes the models of the active provider through the extension's own message, from the sidebar. */
  s.setModels = async (generateModel, reviewModel, page = s.sb) => {
    const settings = JSON.parse(await rawSettings())
    const providerId = settings.activeProviderId
    const reply = await s.sendFrom(page, { type: 'patch-settings', change: { kind: 'update-provider', providerId, set: { generateModel, reviewModel } } })
    const after = JSON.parse(await rawSettings())
    const p = after.providers.find((x) => x.id === providerId)
    if (p.generateModel !== generateModel || p.reviewModel !== reviewModel) throw new Error('models not set: ' + reply.slice(0, 200))
  }

  s.restore = async () => {
    const out = {}
    const ids = s.openedTabs
    if (ids.length) await s.closeTabs()
    try { await s.hideSidebar() } catch {}
    if (s.original) {
      // The settings are restored with the extension's own message, then compared with the saved raw text.
      const saved = JSON.parse(s.original.settings)
      const now = JSON.parse(await rawSettings())
      const orig = saved.providers.find((p) => p.id === saved.activeProviderId)
      if (s.sb || true) {
        const holder = s.sb ?? null
        if (holder) {
          await s.sendFrom(holder, { type: 'patch-settings', change: { kind: 'update-provider', providerId: orig.id, set: { generateModel: orig.generateModel, reviewModel: orig.reviewModel } } })
        } else {
          void now
        }
      }
      out.settingsIdentical = (await rawSettings()) === s.original.settings
    }
    await B.run(`browser.storage.local.remove('wa-disclosure-ack').then(() => 'ack removed')`)
    out.ackAbsent = (await B.run(`browser.storage.local.get('wa-disclosure-ack').then(s => String('wa-disclosure-ack' in s))`)) === 'false'
    out.transformsIdentical = (await B.long(`browser.storage.local.get('transforms').then(s => JSON.stringify(s.transforms ?? null))`)) === s.original.transforms
    return out
  }
  return s
}

/** The generate request that the provider received, matched from the recorded requests by its model and blocks. */
export function generateRequestsOf(requests) {
  return requests.filter((r) => /\/v1\/messages$/.test(new URL(r.url).pathname) && r.model)
}
