/**
 * #79 -- can a content script read `storage.session`, where the vault keeps the
 * key it derives from the passphrase?
 *
 * A content script cannot be evaluated into directly over the debugging
 * protocol, so the background runs `scripting.executeScript` with a function in
 * the ISOLATED world of a test tab. That is the same world, with the same
 * extension API surface, as the manifest or registered content script (the
 * extension's own `wa-content` registration is also present on example.com).
 * The control that this really is a content context is checked, not assumed:
 * the page URL is the web page's, `browser.tabs` does not exist, and
 * `browser.storage.local` still answers, so a failure on `storage.session`
 * cannot be put down to the whole API being absent.
 *
 * Nothing real is read or written. The canary values use their own key names.
 * The listing of keys that `get()` with no argument returns is reduced to the
 * key names inside the content context, and values are never printed.
 */
import { open, uniqueUrl, verdict, sleep } from '../crypto/rdp.mjs'

const SESSION_KEY = 'waVaultSessionProbe'
const LOCAL_KEY = 'waVaultLocalProbe'
const SESSION_CANARY = 'WA-VAULT-SESSION-CANARY-79c1d4'
const LOCAL_CANARY = 'WA-VAULT-LOCAL-CANARY-79c1d4'
const PAGE = uniqueUrl('https://example.com/', 'vault-session')

const rdp = open()
const ctx = await rdp.contexts({ waitMs: 8000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  process.exit(1)
}

/** Runs `body` (the text of an async function body) in the ISOLATED world of `tabId`. */
const inContent = (tabId, body, args = []) =>
  B.run(`(async () => {
    const r = await browser.scripting.executeScript({
      target: { tabId: ${tabId} }, world: 'ISOLATED',
      func: async (...args) => { ${body} },
      args: ${JSON.stringify(args)},
    })
    return JSON.stringify(r[0].result)
  })()`)

const json = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return { raw: s }
  }
}

let tab = -1
const rows = []
try {
  console.log('write canaries from the background')
  await B.run(`(async () => {
    await browser.storage.session.set({ ${SESSION_KEY}: ${JSON.stringify(SESSION_CANARY)} })
    await browser.storage.local.set({ ${LOCAL_KEY}: ${JSON.stringify(LOCAL_CANARY)} })
    return 'written'
  })()`)

  const bgSession = await B.run(
    `browser.storage.session.get(${JSON.stringify(SESSION_KEY)}).then(s => s[${JSON.stringify(SESSION_KEY)}])`,
  )
  console.log('background reads session canary:', bgSession === SESSION_CANARY ? 'yes' : bgSession)
  rows.push(['control: background reads the session canary', bgSession === SESSION_CANARY])

  tab = Number(await B.run(`browser.tabs.create({ url: ${JSON.stringify(PAGE)}, active: false }).then(t => t.id)`))
  for (let i = 0; i < 30; i += 1) {
    await sleep(500)
    const s = await B.run(`browser.tabs.get(${tab}).then(t => t.status + ' ' + t.url)`)
    if (s.startsWith('complete')) break
  }
  console.log('test tab', tab, await B.run(`browser.tabs.get(${tab}).then(t => t.url)`))

  const probeBody = `
    const out = {}
    out.href = location.href
    out.hasTabsApi = typeof browser.tabs !== 'undefined'
    out.hasSessionObject = typeof browser.storage.session
    out.hasSetAccessLevel = typeof browser.storage.session?.setAccessLevel
    out.storageProperties = Object.keys(browser.storage).sort()
    out.storagePrototypeProperties = Object.getOwnPropertyNames(Object.getPrototypeOf(browser.storage)).sort()
    const attempt = async (name, fn) => {
      try { out[name] = { ok: true, value: await fn() } }
      catch (e) { out[name] = { ok: false, error: String(e && e.message || e) } }
    }
    await attempt('localGetCanary', async () => (await browser.storage.local.get(args[1]))[args[1]])
    await attempt('sessionGetKey', async () => (await browser.storage.session.get(args[0]))[args[0]])
    await attempt('sessionGetAll', async () => Object.keys(await browser.storage.session.get()))
    await attempt('sessionGetNull', async () => Object.keys(await browser.storage.session.get(null)))
    await attempt('sessionBytes', async () => await browser.storage.session.getBytesInUse(null))
    await attempt('storageGetViaGeneric', async () => Object.keys(await browser.storage.session.get([args[0]])))
    // A message route: the vault state message is answered with status only,
    // and only its field names are kept here.
    await attempt('vaultStateMessage', async () => {
      const r = await browser.runtime.sendMessage({ type: 'vault-state' })
      return r && typeof r === 'object' ? Object.keys(r) : r
    })
    globalThis.__waEvents = []
    browser.storage.onChanged.addListener((changes, area) => {
      globalThis.__waEvents.push([area, Object.keys(changes)])
    })
    return out`
  const raw = json(await inContent(tab, probeBody, [SESSION_KEY, LOCAL_KEY]))
  // The listing is reduced to whether the canary key is present, plus a count,
  // so a real vault key name is never what the report is about.
  const summarise = (r) =>
    r && r.ok && Array.isArray(r.value)
      ? { ok: true, keyCount: r.value.length, includesCanary: r.value.includes(SESSION_KEY) }
      : r
  const content = {
    ...raw,
    sessionGetAll: summarise(raw.sessionGetAll),
    sessionGetNull: summarise(raw.sessionGetNull),
    storageGetViaGeneric: summarise(raw.storageGetViaGeneric),
  }
  console.log('\ncontent context, as measured:')
  console.log(JSON.stringify(content, null, 2))

  rows.push(['control: the content context is the web page, with no tabs API', typeof raw.href === 'string' && raw.href.startsWith('https://example.com/') && raw.hasTabsApi === false])
  rows.push(['control: storage.local is readable there (the API answers)', raw.localGetCanary?.ok === true && raw.localGetCanary.value === LOCAL_CANARY])
  const sessionReadable = raw.sessionGetKey?.ok === true && raw.sessionGetKey.value === SESSION_CANARY
  const listed = raw.sessionGetAll?.ok === true && raw.sessionGetAll.value.includes(SESSION_KEY)
  console.log(`\nRESULT: content script ${sessionReadable ? 'CAN' : 'CANNOT'} read the session canary by key; get() listing ${listed ? 'includes' : 'does not include'} it`)

  // A change made after the listener exists. Whether the content script is told
  // about a session write is a second route to the same value.
  await B.run(`browser.storage.session.set({ ${SESSION_KEY}: ${JSON.stringify(SESSION_CANARY + '-2')} }).then(() => 'changed')`)
  await B.run(`browser.storage.local.set({ ${LOCAL_KEY}: ${JSON.stringify(LOCAL_CANARY + '-2')} }).then(() => 'changed')`)
  await sleep(1500)
  const events = json(await inContent(tab, 'return globalThis.__waEvents ?? null'))
  console.log('\nstorage.onChanged events seen in the content context:', JSON.stringify(events))
  const localEvent = Array.isArray(events) && events.some(([a, k]) => a === 'local' && k.includes(LOCAL_KEY))
  const sessionEvent = Array.isArray(events) && events.some(([a, k]) => a === 'session' && k.includes(SESSION_KEY))
  rows.push(['control: a local write is reported to the content listener', localEvent])
  console.log('session write reported to the content listener:', sessionEvent)

  // Write route: can the content context overwrite session storage?
  const w = json(await inContent(tab, `
    try { await browser.storage.session.set({ [args[0]]: 'WRITTEN-FROM-CONTENT' }); return { ok: true } }
    catch (e) { return { ok: false, error: String(e && e.message || e) } }`, [SESSION_KEY]))
  const after = await B.run(`browser.storage.session.get(${JSON.stringify(SESSION_KEY)}).then(s => s[${JSON.stringify(SESSION_KEY)}])`)
  // Control for the write check: the same write to storage.local from the content context lands.
  await inContent(tab, `await browser.storage.local.set({ [args[0]]: 'WRITTEN-FROM-CONTENT' }); return 1`, [LOCAL_KEY])
  const localAfter = await B.run(`browser.storage.local.get(${JSON.stringify(LOCAL_KEY)}).then(s => s[${JSON.stringify(LOCAL_KEY)}])`)
  rows.push(['control: a local write from the content context reaches the background', localAfter === 'WRITTEN-FROM-CONTENT'])
  rows.push(['a session write from the content context did not land', after !== 'WRITTEN-FROM-CONTENT'])
  console.log('content write to session:', JSON.stringify(w), ' background then reads:', after)

  // Mitigation, tried only for what the measurement shows.
  // Applies only if the area exists in the content context but is readable.
  const level = !sessionReadable ? 'not needed: the area is absent from the content context' : await B.run(`(async () => {
    if (typeof browser.storage.session.setAccessLevel !== 'function') return 'setAccessLevel absent in background'
    try { await browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); return 'set TRUSTED_CONTEXTS' }
    catch (e) { return 'setAccessLevel threw: ' + e.message }
  })()`)
  console.log('\nbackground setAccessLevel TRUSTED_CONTEXTS:', level)
  await B.run(`browser.storage.session.set({ ${SESSION_KEY}: ${JSON.stringify(SESSION_CANARY)} }).then(() => 'rewritten')`)
  const again = !sessionReadable ? { ok: false, error: 'skipped' } : json(await inContent(tab, `
    try { return { ok: true, value: (await browser.storage.session.get(args[0]))[args[0]] ?? null } }
    catch (e) { return { ok: false, error: String(e && e.message || e) } }`, [SESSION_KEY]))
  console.log('content read after setAccessLevel:', JSON.stringify(again))
  await B.run(`browser.storage.session.set({ ${SESSION_KEY}: ${JSON.stringify(SESSION_CANARY)} }).then(() => 'restored')`)
  const bgAfter = await B.run(`browser.storage.session.get(${JSON.stringify(SESSION_KEY)}).then(s => s[${JSON.stringify(SESSION_KEY)}])`)
  rows.push(['control: background still reads the canary at the end', bgAfter === SESSION_CANARY])
  const blockedAfter = !(again.ok === true && again.value === SESSION_CANARY)
  if (sessionReadable) console.log(`after setAccessLevel the content script ${blockedAfter ? 'CANNOT' : 'CAN'} read it`)
  console.log(
    sessionReadable
      ? 'conclusion: readable by default'
      : 'conclusion: not readable by default' + (blockedAfter ? '' : ' (but readable after setAccessLevel?!)'),
  )
  rows.push(['measurement completed', raw.sessionGetKey !== undefined])
} finally {
  await B.run(`(async () => {
    await browser.storage.session.remove(${JSON.stringify(SESSION_KEY)})
    await browser.storage.local.remove(${JSON.stringify(LOCAL_KEY)})
    ${tab > 0 ? `await browser.tabs.remove(${tab}).catch(() => {})` : ''}
    return 'cleaned'
  })()`)
  const ok = verdict(rows)
  rdp.close()
  process.exit(ok ? 0 : 1)
}
