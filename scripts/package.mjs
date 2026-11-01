// Builds a release package for addons.mozilla.org without signing it.
// Usage: npm run package
//
// The steps are: remove the previous build, build in release mode with the
// environment variables that change the build removed, check that the probe
// code is absent, and run `web-ext build` into web-ext-artifacts/.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '../..')
const dist = join(root, 'dist')
const artifacts = join(root, 'web-ext-artifacts')

// These variables change the build output, so a release build must not see
// them. WA_OUT_DIR would also move the output away from dist/.
const env = { ...process.env }
for (const name of ['VITE_CSP_PROBE', 'WA_OUT_DIR']) delete env[name]
env.NODE_ENV = 'production'

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`Failed: ${command} ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

rmSync(dist, { recursive: true, force: true })
run('npx', ['vite', 'build'])

// A release build must contain neither the CSP probe nor any source map.
const problems = []
for (const file of filesUnder(dist)) {
  if (file.endsWith('.map')) problems.push(`${file} is a source map`)
  else if (/\.(js|html|json)$/.test(file)) {
    const text = readFileSync(file, 'utf8')
    if (text.includes('localhost:8787')) problems.push(`${file} contains "localhost:8787"`)
    // The probe's message names are compiled only into a probe build (issue 60).
    for (const name of ['run-csp-probe', 'clear-csp-probe', 'wa-csp-probe']) {
      if (text.includes(name)) problems.push(`${file} contains "${name}"`)
    }
  }
}
if (problems.length > 0) {
  console.error(`The build is not a release build:\n${problems.join('\n')}`)
  process.exit(1)
}

run('npx', [
  'web-ext', 'build',
  '--source-dir', dist,
  '--artifacts-dir', artifacts,
  '--overwrite-dest',
])
if (!existsSync(artifacts)) process.exit(1)
console.log(`Package written to ${artifacts}. It is not signed.`)
