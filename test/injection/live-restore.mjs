/**
 * Puts the development profile back after the paid runs: the models through the
 * extension's own message, the first-run acknowledgement removed, the grant for
 * http://localhost/* removed, the permission prompt preference cleared, and the
 * tabs closed. It then compares the raw stored settings and transforms with the
 * copies saved before the first run (/tmp/wa/orig.json).
 */
import { start, sleep } from './live-lib.mjs'

const s = await start()
const out = {}
try {
  await s.hideSidebar()
  await s.B.run(`browser.tabs.query({}).then(ts => Promise.all(ts.filter(t => /localhost:879/.test(t.url)).map(t => browser.tabs.remove(t.id))))`)
  await s.newTab(`${s.ctx.baseUrl()}src/options/index.html`, false)
  let O = null
  for (let i = 0; i < 15 && !O; i += 1) { await sleep(700); await s.ctx.refresh(); O = s.ctx.find('src/options/index.html') }
  const saved = JSON.parse(s.original.settings)
  const p = saved.providers.find((x) => x.id === saved.activeProviderId)
  await s.setModels(p.generateModel, p.reviewModel, O)
  await s.B.run(`browser.storage.local.remove('wa-disclosure-ack').then(() => 'removed')`)
  if (s.original.localhost === 'false') await s.grant('remove', ['http://localhost/*'])
  await s.parent.run(`(() => { const p = 'extensions.webextOptionalPermissionPrompts'; Services.prefs.clearUserPref(p); return 'cleared' })()`)
  out.settingsIdentical = (await s.rawSettings()) === s.original.settings
  out.ackAbsent = (await s.B.run(`browser.storage.local.get('wa-disclosure-ack').then(s => String('wa-disclosure-ack' in s))`)) === 'false'
  out.transformsIdentical = (await s.B.long(`browser.storage.local.get('transforms').then(s => JSON.stringify(s.transforms ?? null))`)) === s.original.transforms
  out.localhostGrant = await s.B.run(`browser.permissions.contains({ origins: ['http://localhost/*'] })`)
  out.allSitesGrant = await s.B.run(`browser.permissions.contains({ origins: ['<all_urls>'] })`)
  out.prefNow = await s.parent.run(`(() => { const p = 'extensions.webextOptionalPermissionPrompts'; return Services.prefs.prefHasUserValue(p) ? 'user:' + Services.prefs.getBoolPref(p) : 'default' })()`)
  out.original = { localhost: s.original.localhost, allSites: s.original.allSites, pref: s.original.pref, ack: s.original.ack }
  await s.closeTabs()
} catch (e) {
  out.error = e.message
}
console.log(JSON.stringify(out, null, 1))
s.rdp.close()
process.exit(0)
