import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EN_CATALOGUE } from './catalogue'
import type { CatalogueEntry } from './catalogue/define'
import { fillEnglish, t } from './i18n'
import { buildMessagesJson } from './locale-file'

const g = globalThis as { browser?: unknown }

afterEach(() => {
  delete g.browser
})

describe('t', () => {
  it('returns the English text when there is no browser object', () => {
    expect(t('sidebarTitle')).toBe('Web Alchemist')
  })

  it('returns the text from the browser when it has some', () => {
    g.browser = { i18n: { getMessage: () => 'Alchimiste du Web' } }
    expect(t('sidebarTitle')).toBe('Alchimiste du Web')
  })

  it('falls back to English when the browser returns an empty string', () => {
    g.browser = { i18n: { getMessage: () => '' } }
    expect(t('sidebarTitle')).toBe('Web Alchemist')
  })

  it('falls back to English when the browser throws', () => {
    g.browser = {
      i18n: {
        getMessage: () => {
          throw new Error('no')
        },
      },
    }
    expect(t('sidebarTitle')).toBe('Web Alchemist')
  })

  it('falls back to English when the browser returns something other than a string', () => {
    g.browser = { i18n: { getMessage: () => Promise.resolve('x') } }
    expect(t('sidebarTitle')).toBe('Web Alchemist')
  })

  it('passes substitutions to the browser as strings', () => {
    let seen: unknown
    g.browser = {
      i18n: {
        getMessage: (_key: string, values: unknown) => {
          seen = values
          return 'x'
        },
      },
    }
    t('sidebarTitle', 3, 'a')
    expect(seen).toEqual(['3', 'a'])
  })
})

describe('fillEnglish', () => {
  const entry: CatalogueEntry = {
    message: 'Delete $NAME$ for $$5 ($COUNT$ left)',
    placeholders: ['NAME', 'COUNT'],
  }

  it('fills placeholders by position and unescapes a dollar sign', () => {
    expect(fillEnglish(entry, ['x', '2'])).toBe('Delete x for $5 (2 left)')
  })

  it('lets a translation reorder the placeholders without changing the order of values', () => {
    expect(fillEnglish({ ...entry, message: '$COUNT$ left: $NAME$' }, ['x', '2'])).toBe('2 left: x')
  })
})

describe('the English catalogue', () => {
  const entries = Object.entries(EN_CATALOGUE) as Array<[string, CatalogueEntry]>

  it('declares every placeholder that its text uses, and uses every one it declares', () => {
    for (const [key, entry] of entries) {
      const used = [...entry.message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) => m[1]!.toLowerCase())
      const declared = (entry.placeholders ?? []).map((name) => name.toLowerCase())
      expect({ key, used: [...new Set(used)].sort() }).toEqual({ key, used: [...declared].sort() })
    }
  })

  it('has a non-empty message for every key', () => {
    for (const [key, entry] of entries) expect({ key, ok: entry.message.trim() !== '' }).toEqual({ key, ok: true })
  })

  it('has every key that the manifest refers to', () => {
    const manifest = readFileSync(resolve(__dirname, '../manifest.json'), 'utf8')
    const keys = [...manifest.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]!)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(Object.keys(EN_CATALOGUE)).toContain(key)
  })

  it('generates a messages.json file with one entry per key', () => {
    const file = JSON.parse(buildMessagesJson()) as Record<string, { message: string }>
    expect(Object.keys(file).sort()).toEqual(Object.keys(EN_CATALOGUE).sort())
    for (const [key, entry] of entries) expect(file[key]!.message).toBe(entry.message)
  })

  it('writes positional content for each named placeholder', () => {
    const file = JSON.parse(
      buildMessagesJson({ a: { message: 'Hi $NAME$ $N2$', placeholders: ['NAME', 'N2'] } }),
    ) as Record<string, { placeholders: Record<string, { content: string }> }>
    expect(file['a']!.placeholders).toEqual({ name: { content: '$1' }, n2: { content: '$2' } })
  })
})

describe('the surface files of the catalogue', () => {
  it('define no key twice', async () => {
    const modules = import.meta.glob('./catalogue/*.ts', { eager: true }) as Record<
      string,
      Record<string, Record<string, unknown>>
    >
    const seen = new Map<string, string>()
    const repeated: string[] = []
    for (const [path, module] of Object.entries(modules)) {
      if (path.endsWith('/index.ts') || path.endsWith('/define.ts')) continue
      for (const exported of Object.values(module)) {
        if (typeof exported !== 'object' || exported === null) continue
        for (const key of Object.keys(exported)) {
          if (seen.has(key)) repeated.push(`${key} in ${seen.get(key)} and ${path}`)
          else seen.set(key, path)
        }
      }
    }
    expect(repeated).toEqual([])
  })
})
