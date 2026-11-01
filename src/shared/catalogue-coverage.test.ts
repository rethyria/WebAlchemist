import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN_CATALOGUE } from './catalogue'

/**
 * Finds user-visible English text that is written in the source instead of
 * being read from the message catalogue.
 *
 * Two kinds of source are checked. In a Svelte component, the text between
 * tags and the static values of the attributes aria-label, title, placeholder,
 * alt and label are checked, and so are the string literals inside the
 * expressions of the template. In a TypeScript module and the script of a
 * component, a string literal is checked when it reads like a sentence (it
 * starts with a capital letter and has at least three words) or when it is the
 * argument of Error or ProviderError. A literal that is the same as a message
 * of the catalogue is also reported, because it would not be translated.
 *
 * This is a heuristic. It does not find a one- or two-word label in a script,
 * for example, and the allow-list below names what it finds that is not
 * user-visible text.
 */

const SRC = resolve(__dirname, '..')

/** Text attributes whose static value a user can see or hear. */
const TEXT_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt', 'label']

/**
 * Files that are not checked, with the reason. Paths are relative to src/.
 */
const SKIPPED_FILES: Record<string, string> = {
  'background/prompts.ts': 'Instructions to the model, which the model reads and the user does not.',
  'background/providers/types.ts': 'Descriptions in the schema of the model response, read by the model.',
  'background/csp-probe.ts': 'Test code that is built only with VITE_CSP_PROBE=1.',
  'background/test-browser.ts': 'A fake browser for tests.',
}

/** Directories that are not checked, with the reason. */
const SKIPPED_DIRECTORIES: Record<string, string> = {
  'shared/catalogue': 'This is the catalogue.',
  'background/test-support': 'Support code for tests.',
  'types': 'Type declarations.',
}

/**
 * Text that the check finds and that is not a message for the user. Each entry
 * is a file path relative to src/ and the exact text.
 */
const ALLOWED_TEXT: Array<{ file: string; text: string; reason: string }> = [
  {
    file: 'background/index.ts',
    text: 'Resetting the world of transforms failed:',
    reason: 'A line written to the browser console for the developer.',
  },
  {
    file: 'background/index.ts',
    text: 'Binding stored credentials failed:',
    reason: 'A line written to the browser console for the developer.',
  },
  {
    file: 'background/storage.ts',
    text: 'Binding stored credentials failed:',
    reason: 'A line written to the browser console for the developer.',
  },
  {
    file: 'editor/main.ts',
    text: 'Editor root element is missing.',
    reason: 'A programming error when the page lacks its mount element, which users cannot cause.',
  },
  {
    file: 'options/main.ts',
    text: 'Options root element is missing.',
    reason: 'A programming error when the page lacks its mount element, which users cannot cause.',
  },
  {
    file: 'sidebar/main.ts',
    text: 'Sidebar root element is missing.',
    reason: 'A programming error when the page lacks its mount element, which users cannot cause.',
  },
  {
    file: 'sidebar/App.svelte',
    text: 'Run CSP probe',
    reason: 'Shown only in a build made with VITE_CSP_PROBE=1, which is not released.',
  },
  {
    file: 'sidebar/components/Picking.svelte',
    text: 'role=',
    reason: 'The name of the HTML attribute of the picked element, shown as code beside its value.',
  },
]

export interface Violation {
  file: string
  text: string
}

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const rel = relative(SRC, path).split('\\').join('/')
    if (statSync(path).isDirectory()) {
      if (rel in SKIPPED_DIRECTORIES) continue
      found.push(...sourceFiles(path))
    } else if (/\.(ts|svelte)$/.test(name) && !/\.(test|d)\.ts$/.test(name) && !(rel in SKIPPED_FILES)) {
      found.push(path)
    }
  }
  return found
}

/**
 * The string literals of a TypeScript source, with the text that precedes
 * each one. Comments are skipped. The static parts of a template literal are
 * returned as one literal.
 */
export function literalsOf(source: string): Array<{ text: string; before: string }> {
  const found: Array<{ text: string; before: string }> = []
  let i = 0
  while (i < source.length) {
    const c = source[i]!
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
    } else if (c === "'" || c === '"') {
      const start = i
      let text = ''
      i += 1
      while (i < source.length && source[i] !== c && source[i] !== '\n') {
        if (source[i] === '\\') {
          text += source[i + 1] ?? ''
          i += 2
        } else {
          text += source[i]
          i += 1
        }
      }
      found.push({ text, before: source.slice(Math.max(0, start - 40), start) })
      i += 1
    } else if (c === '`') {
      const start = i
      let text = ''
      i += 1
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') {
          text += source[i + 1] ?? ''
          i += 2
        } else if (source[i] === '$' && source[i + 1] === '{') {
          let depth = 1
          i += 2
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth += 1
            else if (source[i] === '}') depth -= 1
            i += 1
          }
          text += '\u0000'
        } else {
          text += source[i]
          i += 1
        }
      }
      found.push({ text: text.replace(/\u0000/g, ' '), before: source.slice(Math.max(0, start - 40), start) })
      i += 1
    } else {
      i += 1
    }
  }
  return found
}

const WORDS = /[A-Za-z]{2,}/g

function looksLikeEnglish(text: string, before: string): boolean {
  const words = text.match(WORDS) ?? []
  if (words.length >= 3 && /^[A-Z]/.test(text.trim()) && text.includes(' ')) return true
  return /(?:Error|ProviderError)\(\s*$/.test(before) && words.length >= 2 && text.includes(' ')
}

function checkScript(file: string, source: string): Violation[] {
  return literalsOf(source)
    .filter(({ text, before }) => looksLikeEnglish(text, before))
    .map(({ text }) => ({ file, text: text.trim() }))
}

/** Splits a component into its script, its style and its template. */
function splitComponent(source: string): { scripts: string[]; template: string } {
  const scripts: string[] = []
  let template = source.replace(/<!--[\s\S]*?-->/g, '')
  template = template.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (_all, body: string) => {
    scripts.push(body)
    return ''
  })
  template = template.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
  return { scripts, template }
}

/** Removes every {expression} of a template and returns what it held as scripts. */
function takeExpressions(template: string): { rest: string; expressions: string[] } {
  const expressions: string[] = []
  let rest = ''
  let i = 0
  while (i < template.length) {
    if (template[i] === '{') {
      let depth = 1
      let j = i + 1
      let quote = ''
      while (j < template.length && depth > 0) {
        const c = template[j]!
        if (quote) {
          if (c === '\\') j += 1
          else if (c === quote) quote = ''
        } else if (c === "'" || c === '"' || c === '`') quote = c
        else if (c === '{') depth += 1
        else if (c === '}') depth -= 1
        j += 1
      }
      expressions.push(template.slice(i + 1, j - 1))
      rest += ' '
      i = j
    } else {
      rest += template[i]
      i += 1
    }
  }
  return { rest, expressions }
}

export function checkComponent(file: string, source: string): Violation[] {
  const { scripts, template } = splitComponent(source)
  const found: Violation[] = []
  for (const script of scripts) found.push(...checkScript(file, script))
  const { rest, expressions } = takeExpressions(template)
  for (const expression of expressions) found.push(...checkScript(file, expression))

  for (const name of TEXT_ATTRIBUTES) {
    for (const match of rest.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))) {
      const value = (match[1] ?? '').trim()
      if (/[A-Za-z]{2,}/.test(value)) found.push({ file, text: value })
    }
  }
  const text = rest.replace(/<[^>]*>/g, '\n')
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/\s+/g, ' ').trim()
    if (/[A-Za-z]{2,}/.test(trimmed)) found.push({ file, text: trimmed })
  }
  return found
}

export function checkSource(file: string, source: string): Violation[] {
  return file.endsWith('.svelte') ? checkComponent(file, source) : checkScript(file, source)
}

function isAllowed(violation: Violation): boolean {
  return ALLOWED_TEXT.some(
    (allowed) => allowed.file === violation.file && violation.text.includes(allowed.text),
  )
}

function violationsInTree(): Violation[] {
  return sourceFiles(SRC)
    .flatMap((path) => {
      const file = relative(SRC, path).split('\\').join('/')
      return checkSource(file, readFileSync(path, 'utf8'))
    })
    .filter((violation) => !isAllowed(violation))
}

describe('user-visible text in the source', () => {
  it('is read from the catalogue, with nothing written in components or modules', () => {
    expect(violationsInTree()).toEqual([])
  })

  it('skips only files and directories that exist (control for stale entries)', () => {
    for (const path of [...Object.keys(SKIPPED_FILES), ...Object.keys(SKIPPED_DIRECTORIES)]) {
      expect(statSync(join(SRC, path)).isFile() || statSync(join(SRC, path)).isDirectory()).toBe(true)
    }
  })

  it('has a reason for every allowed text, and each one still occurs (control for stale entries)', () => {
    for (const allowed of ALLOWED_TEXT) {
      expect(allowed.reason).not.toBe('')
      const source = readFileSync(join(SRC, allowed.file), 'utf8')
      expect(source).toContain(allowed.text)
    }
  })
})

describe('the check itself (controls)', () => {
  it('reports text between the tags of a component', () => {
    expect(checkComponent('x.svelte', '<script lang="ts"></script>\n<p>Delete this transform now</p>')).toEqual([
      { file: 'x.svelte', text: 'Delete this transform now' },
    ])
  })

  it('reports a static aria-label, title and placeholder', () => {
    const source = '<button aria-label="Close panel" title="Close it" placeholder="Type here"></button>'
    expect(checkComponent('x.svelte', source).map((v) => v.text).sort()).toEqual([
      'Close it',
      'Close panel',
      'Type here',
    ])
  })

  it('reports a string inside a template expression', () => {
    expect(checkComponent('x.svelte', "<p>{ok ? 'This went well today' : t('a')}</p>")).toEqual([
      { file: 'x.svelte', text: 'This went well today' },
    ])
  })

  it('reports a sentence in a script and the argument of Error', () => {
    expect(checkSource('x.ts', "const a = 'This is a full sentence.'")).toHaveLength(1)
    expect(checkSource('x.ts', "throw new Error('Something broke')")).toHaveLength(1)
    expect(checkSource('x.ts', "throw new ProviderError('Nothing here', 'code')")).toHaveLength(1)
  })

  it('does not report calls of t, markup without text, comments, or code strings', () => {
    expect(checkComponent('x.svelte', "<p class=\"a\" aria-label={t('k')}>{t('k')}</p><!-- A comment with words -->")).toEqual([])
    expect(checkSource('x.ts', "// This is a comment with words\nconst a = t('key')\nconst b = 'api.anthropic.com'")).toEqual([])
    expect(checkSource('x.ts', "const kind = 'every-load'")).toEqual([])
  })

  it('reports a literal string that is added to a real component', () => {
    const real = readFileSync(join(SRC, 'sidebar/components/Saving.svelte'), 'utf8')
    expect(checkComponent('Saving.svelte', real)).toEqual([])
    const changed = real.replace('<div class="panel">', '<div class="panel">\n  <p>A literal sentence for the user</p>')
    expect(checkComponent('Saving.svelte', changed)).toEqual([
      { file: 'Saving.svelte', text: 'A literal sentence for the user' },
    ])
  })

  it('reports a literal string that is added to a real module', () => {
    const real = readFileSync(join(SRC, 'shared/kill-switch.ts'), 'utf8')
    expect(checkSource('kill-switch.ts', real)).toEqual([])
    const changed = real + "\nexport const EXTRA = 'This sentence is not in the catalogue.'\n"
    expect(checkSource('kill-switch.ts', changed)).toHaveLength(1)
  })
})

describe('the catalogue and its uses', () => {
  it('has no message that no source file uses', () => {
    const used = new Set<string>()
    const keys = Object.keys(EN_CATALOGUE)
    const sources = [
      ...sourceFiles(SRC).map((path) => readFileSync(path, 'utf8')),
      readFileSync(join(SRC, 'manifest.json'), 'utf8'),
    ]
    for (const source of sources) {
      for (const key of keys) if (source.includes(`'${key}'`) || source.includes(`__MSG_${key}__`)) used.add(key)
    }
    expect(keys.filter((key) => !used.has(key))).toEqual([])
  })
})
