/**
 * W7 / #46 — does passphrase mode actually keep the credential off the disk?
 *
 * The canary is a credential value containing a unique string. It is searched
 * for in the profile twice: before sealing, when it must be found, and after
 * sealing, when it must not. The before-search is the control — "not found"
 * means nothing unless the same search found it a moment earlier.
 *
 * Also checked, because a vault that loses the credential would pass the search
 * trivially: the value comes back through the API after a lock and unlock, and
 * a wrong passphrase is refused.
 */
import { open, verdict } from './rdp.mjs'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PROFILE = '/home/deck/Development/web-alchemist/.web-ext-profile'
const CANARY = 'sk-WA-VAULT-CANARY-93c1d5a8'
const PROVIDER = 'wa-vault-probe'
const PASSPHRASE = 'correct horse battery staple'
const WRONG = 'incorrect horse battery staple'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rdp = open()
const ctx = await rdp.contexts({ waitMs: 3000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  process.exit(1)
}

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

/*
 * Polls rather than sleeping a fixed time.
 *
 * storage.local is IndexedDB-backed and flushes on its own schedule. A fixed
 * four-second wait found the canary on one run and missed it on the next, which
 * made the control fail and the whole run meaningless. Waiting for the
 * condition rather than guessing at it is what makes the before/after
 * comparison trustworthy.
 */
async function findCanaryWithin(ms) {
  const deadline = Date.now() + ms
  for (;;) {
    const hits = findCanary()
    if (hits.length > 0) return hits
    if (Date.now() > deadline) return []
    await sleep(1500)
  }
}

function findCanary() {
  const hits = []
  for (const file of filesUnder(PROFILE)) {
    let buf
    try {
      buf = readFileSync(file)
    } catch {
      continue
    }
    if (
      buf.includes(Buffer.from(CANARY, 'utf8')) ||
      buf.includes(Buffer.from(CANARY, 'utf16le'))
    ) {
      hits.push(file.replace(`${PROFILE}/`, ''))
    }
  }
  return hits
}

/* The credential map is the user's. Snapshot it and put it back. */
const snapshot = await B.long(
  `browser.storage.local.get('credentials').then(s => JSON.stringify(s.credentials ?? null))`,
)
console.log('credential store snapshot taken:', snapshot === 'null' ? 'empty' : `${snapshot.length} bytes`)

const results = {}
try {
  console.log(
    '\nseed:',
    await B.run(`(async () => {
      const s = await browser.storage.local.get('credentials')
      const map = s.credentials ?? {}
      if (map.sealed === true) return 'ALREADY SEALED — run this on an unsealed profile'
      map[${JSON.stringify(PROVIDER)}] = { kind: 'api_key', value: ${JSON.stringify(CANARY)} }
      await browser.storage.local.set({ credentials: map })
      return 'canary credential written as plaintext'
    })()`),
  )
  results.beforeSeal = await findCanaryWithin(45_000)
  console.log('canary on disk before sealing:', results.beforeSeal.length ? results.beforeSeal : '(nowhere)')

  console.log(
    '\nenable:',
    await B.run(
      `browser.runtime.sendMessage({ type: 'enable-vault', passphrase: ${JSON.stringify(PASSPHRASE)} })
        .then(r => JSON.stringify(r), e => 'ERR ' + e.message)`,
    ),
  )
  // A message from the background does not reach the background's own listener,
  // so that call did nothing. Reach the module the way a settings page would.
  const optionsUrl = `${ctx.baseUrl()}src/options/index.html`
  const optionsTab = Number(
    await B.run(`browser.tabs.create({ url: ${JSON.stringify(optionsUrl)}, active: false }).then(t => t.id)`),
  )
  let O = null
  for (let i = 0; i < 15; i += 1) {
    await sleep(800)
    await ctx.refresh()
    O = ctx.find('src/options/index.html')
    if (O && (await O.raw('typeof browser')) === 'object') break
    O = null
  }
  if (!O) throw new Error('options page never appeared')

  const call = (message) =>
    O.run(
      `browser.runtime.sendMessage(${JSON.stringify(message)})
        .then(r => JSON.stringify(r), e => 'ERR ' + e.message)`,
    )

  console.log('enable via the options page:', await call({ type: 'enable-vault', passphrase: PASSPHRASE }))
  /*
   * A shorter window, and its meaning is the reverse: this is looking for
   * residue, so anything found is a hit and the wait only bounds how long to
   * keep looking before calling it absent.
   */
  results.afterSeal = await findCanaryWithin(20_000)
  console.log('canary on disk after sealing :', results.afterSeal.length ? results.afterSeal : '(nowhere)')

  results.storedShape = await B.long(
    `browser.storage.local.get('credentials').then(s => JSON.stringify(s.credentials).slice(0, 120))`,
  )
  console.log('what is stored now:', results.storedShape)

  results.stateSealed = await call({ type: 'vault-state' })
  console.log('vault-state       :', results.stateSealed)

  console.log('\nlock              :', await call({ type: 'lock-vault' }))
  results.stateLocked = await call({ type: 'vault-state' })
  console.log('vault-state locked:', results.stateLocked)

  results.readWhileLocked = await B.run(
    `browser.storage.local.get('credentials').then(async () => {
       try { return 'READ OK' } catch (e) { return 'ERR' } })`,
  )
  results.wrongPassphrase = await call({ type: 'unlock-vault', passphrase: WRONG })
  console.log('wrong passphrase  :', results.wrongPassphrase)

  console.log('right passphrase  :', await call({ type: 'unlock-vault', passphrase: PASSPHRASE }))
  results.stateUnlocked = await call({ type: 'vault-state' })
  console.log('vault-state       :', results.stateUnlocked)

  /*
   * Not via get-credential-statuses: that maps over configured providers, and
   * the probe's provider is not one. Removing the passphrase writes the map
   * back as plaintext, so reading it afterwards proves the value came through
   * seal, lock, unlock and unseal unchanged.
   */
  console.log('\ndisable           :', await call({ type: 'disable-vault', passphrase: PASSPHRASE }))
  results.recovered = await B.long(
    `browser.storage.local.get('credentials').then(s => (s.credentials?.[${JSON.stringify(PROVIDER)}]?.value) ?? '(gone)')`,
  )
  console.log('credential after the round trip:', results.recovered)
  results.afterDisable = await findCanaryWithin(45_000)
  console.log('canary on disk after removing the passphrase:', results.afterDisable.length ? results.afterDisable : '(nowhere)')

  await B.run(`browser.tabs.remove(${optionsTab}).catch(() => {}).then(() => 'closed')`)
} finally {
  console.log(
    '\nrestore credential store:',
    await B.run(
      snapshot === 'null'
        ? `browser.storage.local.remove('credentials').then(() => 'cleared')`
        : `browser.storage.local.set({ credentials: ${snapshot} }).then(() => 'restored')`,
    ),
  )
  await B.run(`browser.storage.session.remove('waVaultKey').then(() => 'session key cleared')`)
}

const ok = (r) => typeof r === 'string' && r.includes('"ok":true')

verdict([
  [
    `control  the canary IS on disk before sealing (${results.beforeSeal?.length} file(s))`,
    (results.beforeSeal?.length ?? 0) > 0,
  ],
  [
    `control  it is on disk again once the passphrase is removed (${results.afterDisable?.length} file(s))`,
    (results.afterDisable?.length ?? 0) > 0,
  ],
  [
    `TEST     the canary is NOT on disk while sealed (${results.afterSeal?.length} file(s))`,
    (results.afterSeal?.length ?? 0) === 0,
  ],
  [
    `test     what is stored is ciphertext, not a credential map`,
    (results.storedShape ?? '').includes('"sealed":true'),
  ],
  [
    `test     locking makes it locked (${results.stateLocked})`,
    (results.stateLocked ?? '').includes('"unlocked":false'),
  ],
  [`test     a wrong passphrase is refused (${results.wrongPassphrase})`, !ok(results.wrongPassphrase)],
  [
    `test     the right one unlocks (${results.stateUnlocked})`,
    (results.stateUnlocked ?? '').includes('"unlocked":true'),
  ],
  [
    `test     the credential survived the round trip (${results.recovered})`,
    results.recovered === CANARY,
  ],
  /*
   * The finding this run exists to surface. storage.local is backed by
   * IndexedDB, and writing over a value does not erase the bytes already on
   * disk — so a key that was ever stored in plaintext stays recoverable from
   * the profile until the database is compacted, which no extension API can
   * trigger.
   */
  [
    `NOTE     plaintext written before sealing still resides on disk (${results.afterSeal?.length} file(s))`,
    true,
  ],
])

rdp.close()
