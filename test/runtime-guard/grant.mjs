/**
 * Grants or removes the host permission for http://localhost/* from the parent
 * process, and saves or compares the raw stored settings. Usage:
 *   WA_RDP_PORT=<port> node test/runtime-guard/grant.mjs add|remove|snapshot|compare
 * `snapshot` writes the SHA-256 and the length of the raw stored data (all keys,
 * which include credentials, so only the hash is kept) to /tmp/wa/settings.hash
 * and `compare` exits with 1 when the stored data differs from that.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { open } from '../crypto/rdp.mjs'

const op = process.argv[2]
const rdp = open()
const ctx = await rdp.contexts({ waitMs: 3000 })
let code = 0
if (op === 'add' || op === 'remove') {
  console.log(
    await ctx.parent.run(`(async () => {
      const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      const id = ${JSON.stringify(ctx.addon.id)}; const ext = ExtensionParent.GlobalManager.extensionMap.get(id);
      await ExtensionPermissions.${op}(id, { permissions: [], origins: ['http://localhost/*'] }, ext);
      return 'done ${op}';
    })()`),
  )
} else {
  const raw = await ctx.background.run(`browser.storage.local.get().then(async s => { const j = JSON.stringify(s); const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(j)); return j.length + ':' + [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('') })`)
  mkdirSync('/tmp/wa', { recursive: true })
  if (op === 'snapshot') {
    writeFileSync('/tmp/wa/settings.hash', raw)
    console.log('saved', raw.length, 'bytes')
  } else {
    const same = readFileSync('/tmp/wa/settings.hash', 'utf8') === raw
    console.log(same ? 'stored data identical to the snapshot' : 'STORED DATA DIFFERS')
    if (!same) code = 1
  }
}
rdp.close()
process.exit(code)
