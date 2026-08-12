/**
 * Every live harness, in one run.
 *
 * These check things unit tests cannot: what Firefox actually does, what lands
 * on disk, what a page ends up styled with. They need a running browser with
 * remote debugging on 41365 and the extension loaded, which is why they are not
 * part of `npm test`.
 *
 * Two of them need a local server, started here so a sweep cannot quietly skip
 * them — a harness that does not run is indistinguishable from one that passed,
 * and this project has been caught by that before.
 *
 *   node test/run-all.mjs
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Servers some probes talk to, and the probes that need them. */
const SERVERS = [
  { name: 'injection fixture', script: 'injection/server.mjs', env: {} },
  {
    name: 'rate-limit stub',
    script: 'badge/stub-provider.mjs',
    env: { HOLD_MS: '6000', STATUS: '429', RETRY_AFTER: '17' },
  },
]

const PROBES = [
  ['crypto/probe.mjs', 'what a non-extractable key buys (#46)'],
  ['crypto/session-probe.mjs', 'whether storage.session reaches disk'],
  ['crypto/vault-probe.mjs', 'the passphrase vault, end to end (#46)'],
  ['injection/measure.mjs', 'which page channels reach the model (#44)'],
  ['oauth/identity-check.mjs', 'the identity permission (#32)'],
  ['badge/probe.mjs', 'the four badge states (#29)'],
  ['ratelimit/probe.mjs', 'retry-after reaching the panel (#35)'],
  ['authoring/probe.mjs', 'writing a transform by hand (#27)'],
  ['intent/probe.mjs', 'the tree for editing a description'],
  ['editor/probe.mjs', 'the editor page'],
  ['suspend/probe.mjs', 'suspend and resume'],
  ['contrast/probe.mjs', 'contrast in both schemes (#38)'],
]

const servers = SERVERS.map(({ name, script, env }) => {
  const child = spawn('node', [join(HERE, script)], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  })
  console.log(`started ${name}`)
  return child
})

await new Promise((r) => setTimeout(r, 2000))

const results = []
try {
  for (const [script, description] of PROBES) {
    console.log(`\n${'='.repeat(72)}\n${script} — ${description}\n${'='.repeat(72)}`)
    const code = await new Promise((resolve) => {
      const child = spawn('node', [join(HERE, script)], { stdio: 'inherit' })
      child.on('close', resolve)
      // Long enough for the slowest (contrast opens four pages).
      setTimeout(() => child.kill(), 420_000)
    })
    /*
     * A probe's exit code is not its verdict — they print PASS or FAIL and exit
     * 0 either way. This only catches a probe that crashed or never ran, which
     * is the failure mode a sweep is most likely to hide.
     */
    results.push({ script, ran: code === 0 })
  }
} finally {
  for (const child of servers) child.kill()
}

console.log(`\n${'='.repeat(72)}`)
console.log('Probes that failed to run at all:')
const broken = results.filter((r) => !r.ran)
for (const r of broken) console.log(`  ${r.script}`)
if (broken.length === 0) console.log('  (none)')
console.log('\nRead the PASS/FAIL line printed by each probe above for its verdict.')
