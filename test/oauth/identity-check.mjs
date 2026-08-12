import { open, verdict } from '../crypto/rdp.mjs'
const rdp = open(); const ctx = await rdp.contexts({ waitMs: 2500 }); const B = ctx.background
const warnings = await ctx.parent.long(`(() => {
  const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs")
  const ext = ExtensionParent.GlobalManager.extensionMap.get("@webalchemist")
  return JSON.stringify(ext ? ext.warnings : ["(no extension)"])
})()`)
console.log('manifest warnings:', warnings)
const required = await B.run(`browser.runtime.getManifest().permissions.join(',')`)
const optional = await B.run(`browser.runtime.getManifest().optional_permissions.join(',')`)
console.log('permissions         :', required)
console.log('optional_permissions:', optional)
const has = await B.run(`browser.permissions.contains({permissions:['identity']}).then(v=>String(v),e=>'ERR '+e.message)`)
const redirect = await B.run(`(() => { try { return browser.identity.getRedirectURL() } catch (e) { return 'ERR ' + e.message } })()`)
console.log('identity granted    :', has)
console.log('redirect URI        :', redirect)
verdict([
  ['control  this is the rebuilt extension (userScripts still optional)', optional.includes('userScripts')],
  ['control  identity is NOT in the optional set, which Firefox refuses', !optional.includes('identity')],
  ['test     identity is declared as required', required.includes('identity')],
  ['test     Firefox raised no manifest warning', warnings === '[]'],
  ['test     the permission is actually held', has === 'true'],
  ['test     getRedirectURL returns a usable URI', /^https?:\/\/|^moz-extension:\/\//.test(redirect)],
])
rdp.close()
