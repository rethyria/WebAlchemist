/**
 * Does `browser.storage.session` reach the disk?
 *
 * W1 killed #46's default design: a non-extractable key's bytes are written
 * into the profile's IndexedDB file in the clear, so the key would sit beside
 * the ciphertext it decrypts.
 *
 * That leaves a passphrase-derived key as the only design that survives reading
 * the profile — and its cost is an unlock step. In an MV3 event page that cost
 * is normally prohibitive: the background is torn down when idle, so the
 * derived key cannot simply live in a module variable, and every teardown would
 * mean another prompt.
 *
 * `storage.session` is documented as in-memory and not persisted. If that holds,
 * the derived key survives background teardown without touching the disk, and
 * the user unlocks once per browser session instead of once per generation.
 *
 * Documented is not measured. W1 is the reason for the distinction.
 *
 * Controls, the same three that made W1 mean something:
 *   1. The same canary written to `storage.local`, which MUST be found. Without
 *      it, "not found in session" might only mean the search is broken.
 *   2. A string never written anywhere, which must not be found.
 *   3. The value must be readable back through the API, or it was never stored
 *      and its absence from disk proves nothing.
 */
import { open, verdict } from './rdp.mjs'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PROFILE = '/home/deck/Development/web-alchemist/.web-ext-profile'
const SESSION_CANARY = 'WA-SESSION-CANARY-4b1f8e27'
const LOCAL_CANARY = 'WA-LOCAL-CANARY-4b1f8e27'
const NEVER = 'WA-NEVER-WRITTEN-4b1f8e27'

const rdp = open()
const ctx = await rdp.contexts({ waitMs: 3000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  process.exit(1)
}

console.log(
  'write:',
  await B.run(`(async () => {
    await browser.storage.session.set({ waSessionProbe: ${JSON.stringify(SESSION_CANARY)} })
    await browser.storage.local.set({ waLocalProbe: ${JSON.stringify(LOCAL_CANARY)} })
    return 'both written'
  })()`),
)

const readBack = await B.run(
  `browser.storage.session.get('waSessionProbe').then(s => s.waSessionProbe ?? '(missing)')`,
)
console.log('session reads back as:', readBack)

// Long enough for anything buffered to be flushed.
await new Promise((r) => setTimeout(r, 6000))

function filesUnder(dir) {
  const found = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(dir, entry)
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (stat.isDirectory()) found.push(...filesUnder(path))
    else found.push(path)
  }
  return found
}

/* The whole profile, not just the extension's corner of it. */
const files = filesUnder(PROFILE)
const hits = { session: [], local: [], never: [] }
for (const file of files) {
  let buf
  try {
    buf = readFileSync(file)
  } catch {
    continue
  }
  const has = (text) => buf.includes(Buffer.from(text, 'utf8')) || buf.includes(Buffer.from(text, 'utf16le'))
  if (has(SESSION_CANARY)) hits.session.push(file)
  if (has(LOCAL_CANARY)) hits.local.push(file)
  if (has(NEVER)) hits.never.push(file)
}

const short = (p) => p.replace(`${PROFILE}/`, '')
console.log(`\nsearched ${files.length} files under the whole profile`)
console.log('storage.local canary found in:')
for (const f of hits.local) console.log('  ', short(f))
if (!hits.local.length) console.log('   (nowhere)')
console.log('storage.session canary found in:')
for (const f of hits.session) console.log('  ', short(f))
if (!hits.session.length) console.log('   (nowhere)')

console.log(
  '\ncleanup:',
  await B.run(`(async () => {
    await browser.storage.session.remove('waSessionProbe')
    await browser.storage.local.remove('waLocalProbe')
    return 'removed'
  })()`),
)

verdict([
  [`control  the session value reads back through the API (${readBack === SESSION_CANARY})`,
    readBack === SESSION_CANARY],
  [`control  the storage.local canary IS on disk (${hits.local.length} file(s))`, hits.local.length > 0],
  [`control  a string never written is not found (${hits.never.length} file(s))`, hits.never.length === 0],
  [`TEST     the storage.session value is NOT on disk (${hits.session.length} file(s))`,
    hits.session.length === 0],
])

console.log(
  hits.session.length === 0
    ? '\nREADING: storage.session holds a value that never reaches the profile.\nA passphrase-derived key can live there for the session without being written.'
    : '\nREADING: storage.session reached the disk. A derived key cannot be held there,\nand passphrase mode would need an unlock on every background teardown.',
)

rdp.close()
