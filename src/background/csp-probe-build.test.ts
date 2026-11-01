/**
 * The CSP probe handler is compiled only into a probe build (#60).
 *
 * The message handler registers a user script for localhost and navigates the
 * tab to a local server. Only the sidebar button was behind the build flag, so
 * a release build answered the message from any sender.
 *
 * This builds the extension twice, once as a release and once with
 * VITE_CSP_PROBE=1, and searches the emitted JavaScript for strings that occur
 * only in the probe. The probe build is the control: it shows the search finds
 * the strings when they are there.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')
// Under the project root because the extension plugin ignores an outDir outside it.
const SCRATCH = join(ROOT, '.vite', `csp-probe-build-${process.pid}`)

/** Strings that appear in the probe's code or message handling and in no other source file. */
const PROBE_ONLY = ['localhost:8787', 'wa-csp-probe', 'run-csp-probe', 'clear-csp-probe']

function build(name: string, flag: string | undefined): string {
  const out = join(SCRATCH, name)
  mkdirSync(SCRATCH, { recursive: true })
  const env: Record<string, string | undefined> = { ...process.env, WA_OUT_DIR: out }
  // Vitest sets NODE_ENV=test, under which Svelte compiles in development mode and
  // wraps comparisons in helper calls, so a build-time constant is no longer folded.
  // `npm run build` and `npm run package` do not run under that setting.
  env['NODE_ENV'] = 'production'
  delete env['VITE_CSP_PROBE']
  if (flag !== undefined) env['VITE_CSP_PROBE'] = flag
  execFileSync(join(ROOT, 'node_modules', '.bin', 'vite'), ['build'], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
  })
  return out
}

/** All emitted JavaScript, which excludes the source maps that quote sources. */
function emittedScript(dir: string): string {
  let text = ''
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) text += emittedScript(path)
    else if (entry.endsWith('.js')) text += readFileSync(path, 'utf8')
  }
  return text
}

afterAll(() => {
  if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true })
})

describe('the CSP probe in the background script', () => {
  it('is present in a build made with VITE_CSP_PROBE=1 (control)', () => {
    const script = emittedScript(build('probe', '1'))
    for (const text of PROBE_ONLY) expect(script).toContain(text)
  }, 120_000)

  it('is absent from a normal build', () => {
    const script = emittedScript(build('release', undefined))
    expect(script.length).toBeGreaterThan(10_000)
    for (const text of PROBE_ONLY) expect(script).not.toContain(text)
  }, 120_000)

  it('is absent from a build where the flag has another value', () => {
    const script = emittedScript(build('zero', '0'))
    for (const text of PROBE_ONLY) expect(script).not.toContain(text)
  }, 120_000)
})
