/**
 * W1 / #46 — what does a non-extractable CryptoKey actually buy?
 *
 * #46 proposes storing a non-extractable AES-GCM key in IndexedDB and the
 * ciphertext in storage.local, and says the on-disk question must be measured
 * before the change is described to users as protection. This measures it.
 *
 * A generated non-extractable key cannot be exported, so its bytes cannot be
 * searched for directly. The way round that is to IMPORT known bytes with
 * `extractable: false` — the result is non-extractable in exactly the way a
 * generated key is, refuses export identically, and takes the same storage
 * path, but its bytes are known. That makes this a direct measurement of the
 * thing #46 asks about rather than an inference from a neighbouring case.
 *
 * A generated pair is kept alongside it anyway, because the generated key is
 * what the real design would use and its behaviour is worth pinning too.
 *
 * Controls:
 *   1. A plaintext canary stored alongside. If it cannot be found, the search
 *      is looking at the wrong files and every other result is meaningless.
 *   2. A string never written anywhere. If it IS found, the search matches
 *      indiscriminately.
 *   3. Both sealed keys must actually refuse export, or "non-extractable" is
 *      not what is being measured.
 *   4. The extractable key, whose bytes are expected on disk either way.
 */
import { open, verdict } from './rdp.mjs'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PROFILE = '/home/deck/Development/web-alchemist/.web-ext-profile'

const rdp = open()
const ctx = await rdp.contexts({ waitMs: 3000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  process.exit(1)
}

const CANARY = 'WA-CANARY-7f3a9c21-plaintext-marker'

const out = await B.long(`(async () => {
  const DB = "wa-crypto-probe"
  await new Promise((res) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = res })

  const extractable = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
  const sealed      = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", extractable))
  const hex = [...raw].map(b => b.toString(16).padStart(2, "0")).join("")

  /*
   * The decisive one. A key IMPORTED from known bytes with extractable:false is
   * non-extractable in exactly the way a generated one is — same flag, same
   * refusal, same storage path — but its bytes are known, so they can be
   * searched for directly. This removes the inference from the result.
   */
  const knownBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) knownBytes[i] = (i * 7 + 13) & 0xff
  const importedSealed = await crypto.subtle.importKey("raw", knownBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
  const importedHex = [...knownBytes].map(b => b.toString(16).padStart(2, "0")).join("")
  let importedExportRefused = "no"
  try { await crypto.subtle.exportKey("raw", importedSealed); importedExportRefused = "EXPORTED ANYWAY" }
  catch (e) { importedExportRefused = e.name }

  // Prove the sealed key really refuses export, rather than assuming it.
  let exportRefused = "no"
  try { await crypto.subtle.exportKey("raw", sealed); exportRefused = "EXPORTED ANYWAY" }
  catch (e) { exportRefused = e.name }

  const db = await new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore("keys")
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction("keys", "readwrite")
    const s = tx.objectStore("keys")
    s.put(extractable, "extractable")
    s.put(sealed, "sealed")
    s.put(importedSealed, "importedSealed")
    s.put(${JSON.stringify(CANARY)}, "canary")
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })

  // Read the sealed key back and use it, to show a stored non-extractable key
  // is still functional — that is the whole premise of the design.
  const back = await new Promise((res, rej) => {
    const tx = db.transaction("keys", "readonly")
    const r = tx.objectStore("keys").get("sealed")
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, back, new TextEncoder().encode("hello"))
  const pt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, back, ct))

  db.close()
  return JSON.stringify({ hex, importedHex, exportRefused, importedExportRefused, roundTrip: pt, sealedExtractable: back.extractable })
})()`)

let d
try {
  d = JSON.parse(out)
} catch {
  console.log('raw:', out.slice(0, 600))
  rdp.close()
  process.exit(1)
}

console.log('extractable key bytes :', d.hex)
console.log('sealed key export     :', d.exportRefused)
console.log('sealed key .extractable after a round trip through IndexedDB:', d.sealedExtractable)
console.log('sealed key still usable after storage:', JSON.stringify(d.roundTrip))

// Give Firefox a moment to get the transaction onto disk.
await new Promise((r) => setTimeout(r, 4000))

function filesUnder(dir) {
  const found = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const e of entries) {
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) found.push(...filesUnder(p))
    else found.push(p)
  }
  return found
}

const extDirs = readdirSync(join(PROFILE, 'storage', 'default')).filter((d) => d.startsWith('moz-extension'))
const files = extDirs.flatMap((d) => filesUnder(join(PROFILE, 'storage', 'default', d)))
console.log(`\nsearching ${files.length} file(s) under ${extDirs.length} moz-extension origin(s)`)

const keyBytes = Buffer.from(d.hex, 'hex')
const importedBytes = Buffer.from(d.importedHex, 'hex')
const canaryBytes = Buffer.from(CANARY, 'utf8')
const canaryUtf16 = Buffer.from(CANARY, 'utf16le')
const absent = Buffer.from('WA-NEVER-WRITTEN-1a2b3c4d5e6f', 'utf8')

const hits = { key: [], imported: [], canary: [], absent: [] }
for (const f of files) {
  let buf
  try {
    buf = readFileSync(f)
  } catch {
    continue
  }
  if (buf.includes(keyBytes)) hits.key.push(f)
  if (buf.includes(importedBytes)) hits.imported.push(f)
  if (buf.includes(canaryBytes) || buf.includes(canaryUtf16)) hits.canary.push(f)
  if (buf.includes(absent)) hits.absent.push(f)
}

const short = (p) => p.replace(`${PROFILE}/storage/default/`, '')
console.log('\nplaintext canary found in:')
for (const f of hits.canary) console.log('  ', short(f))
console.log('extractable key bytes found in:')
for (const f of hits.key) console.log('  ', short(f))
if (hits.key.length === 0) console.log('   (nowhere)')
console.log('NON-EXTRACTABLE key bytes found in:')
for (const f of hits.imported) console.log('  ', short(f))
if (hits.imported.length === 0) console.log('   (nowhere)')

verdict([
  [
    `control  the sealed key refuses export (${d.exportRefused})`,
    d.exportRefused !== 'no' && d.exportRefused !== 'EXPORTED ANYWAY',
  ],
  [
    `control  the sealed key survives IndexedDB and still decrypts (${d.roundTrip})`,
    d.roundTrip === 'hello',
  ],
  [
    `control  it is still non-extractable after the round trip (${d.sealedExtractable})`,
    d.sealedExtractable === false,
  ],
  [`control  the plaintext canary is on disk (${hits.canary.length} file(s))`, hits.canary.length > 0],
  [`control  a string never written is not found (${hits.absent.length} file(s))`, hits.absent.length === 0],
  [
    `control  the imported sealed key also refuses export (${d.importedExportRefused})`,
    d.importedExportRefused !== 'no' && d.importedExportRefused !== 'EXPORTED ANYWAY',
  ],
  [
    `control  the extractable key's raw bytes are on disk in the clear (${hits.key.length} file(s))`,
    hits.key.length > 0,
  ],
  [
    `TEST     a NON-EXTRACTABLE key's raw bytes are on disk in the clear (${hits.imported.length} file(s))`,
    hits.imported.length > 0,
  ],
])

console.log(
  hits.imported.length > 0
    ? '\nREADING: non-extractable key material is written to the profile in the clear.\n' +
      'extractable:false is enforced at the WebCrypto API boundary, in the process.\n' +
      'It is not an at-rest protection.'
    : '\nREADING: the non-extractable key bytes were not found on disk. Something wraps\n' +
      'or reorders them — find out what before concluding anything.',
)

await B.run(
  `new Promise(res => { const r = indexedDB.deleteDatabase("wa-crypto-probe"); r.onsuccess = r.onerror = r.onblocked = () => res("cleaned") })`,
).then((r) => console.log('\ncleanup:', r))

rdp.close()
