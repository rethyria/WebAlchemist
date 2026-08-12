/**
 * #45 ends with an audit and the sentence "that audit needs repeating if either
 * ever changes". This is that sentence, executed.
 *
 * Extension pages run with the extension's own permissions and can read
 * `storage.local` directly, credentials included. Nothing stops them, and #45
 * establishes that nothing can — so the boundary that matters is the one
 * before it: model output, which is the only untrusted thing these pages
 * render, must never reach a construct that executes.
 *
 * A grep in a commit message decays. A grep in a test does not.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')
const PAGES = ['sidebar', 'options', 'editor']

/**
 * Constructs that turn a string into markup or into script. Each is matched
 * against source text rather than a parse tree, which over-reports rather than
 * under-reports — the failure mode a security check should have.
 */
const SINKS: { name: string; pattern: RegExp }[] = [
  { name: 'Svelte {@html}', pattern: /\{@html\b/ },
  { name: 'innerHTML assignment', pattern: /\.innerHTML\s*=/ },
  { name: 'outerHTML assignment', pattern: /\.outerHTML\s*=/ },
  { name: 'insertAdjacentHTML', pattern: /insertAdjacentHTML/ },
  { name: 'document.write', pattern: /document\s*\.\s*write/ },
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'new Function', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'iframe srcdoc', pattern: /srcdoc/ },
  // A string first argument to a timer is `eval` wearing a different name.
  { name: 'string-argument timer', pattern: /set(?:Timeout|Interval)\s*\(\s*['"`]/ },
]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path))
      continue
    }
    if (/\.(svelte|ts)$/.test(entry) && !entry.endsWith('.test.ts')) found.push(path)
  }
  return found
}

function sinksIn(source: string): string[] {
  return SINKS.filter(({ pattern }) => pattern.test(source)).map(({ name }) => name)
}

describe('extension pages cannot execute what they render', () => {
  const files = PAGES.flatMap((page) => sourceFiles(join(ROOT, page)))

  it('finds the pages at all', () => {
    // Otherwise a rename turns this whole file into a test that passes by
    // scanning nothing — the shape of failure #21's CSP harness had.
    expect(files.length).toBeGreaterThan(10)
    for (const page of PAGES) {
      expect(files.some((f) => f.includes(`/${page}/`))).toBe(true)
    }
  })

  it.each(PAGES)('%s has no construct that turns a string into markup or script', (page) => {
    const offenders = files
      .filter((file) => file.includes(`/${page}/`))
      .map((file) => ({ file: relative(ROOT, file), found: sinksIn(readFileSync(file, 'utf8')) }))
      .filter(({ found }) => found.length > 0)

    expect(offenders).toEqual([])
  })

  /*
   * The control. A check that cannot fail proves nothing, and this one would
   * pass just as happily against an empty regex list or a source tree it never
   * opened.
   */
  it('detects each sink in a sample that contains it', () => {
    const samples: Record<string, string> = {
      'Svelte {@html}': '<div>{@html transform.code}</div>',
      'innerHTML assignment': 'box.innerHTML = transform.code',
      'outerHTML assignment': 'box.outerHTML = transform.code',
      insertAdjacentHTML: "box.insertAdjacentHTML('beforeend', transform.code)",
      'document.write': 'document.write(transform.code)',
      eval: 'eval(transform.code)',
      'new Function': 'new Function(transform.code)()',
      'iframe srcdoc': '<iframe srcdoc={transform.code}></iframe>',
      'string-argument timer': "setTimeout('doThing()', 100)",
    }

    for (const { name } of SINKS) {
      const sample = samples[name]
      expect(sample, `no sample for ${name}`).toBeTruthy()
      expect(sinksIn(sample as string), `${name} went undetected`).toContain(name)
    }
  })

  it('does not flag the code the pages actually contain', () => {
    // Model output reaches the DOM as text, through `{value}` and `{#each}`.
    // If that ever stopped being enough, the check above is what would say so —
    // this one only proves it is not matching everything indiscriminately.
    expect(sinksIn('<pre>{#each lines as line}<span>{line.text}</span>{/each}</pre>')).toEqual([])
    expect(sinksIn('const excerpt = element.outerHTMLExcerpt')).toEqual([])
  })
})
