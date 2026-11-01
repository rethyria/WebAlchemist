/**
 * Previews must not remove the registration of the saved transform they edit
 * for good: the saved script is paused while the preview runs and registered
 * again from storage when the preview is cleared.
 *
 * The userScripts API is replaced by an in-memory store, so the test reads
 * back what is registered rather than checking which calls were made.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Transform } from '@shared/types'

const store = new Map<string, unknown>()
let stored: unknown[] = []
;(globalThis as unknown as { browser: unknown }).browser = {
  permissions: { contains: async () => true },
  // `stored` is what getAllTransforms reads, so a test can say what is saved.
  storage: {
    local: { get: async () => ({ transforms: stored }), set: async () => {} },
  },
  userScripts: {
    configureWorld: async () => {},
    getScripts: async (f: { ids: string[] }) =>
      f.ids.filter((id) => store.has(id)).map((id) => store.get(id)),
    register: async (list: { id: string }[]) => list.forEach((r) => store.set(r.id, r)),
    update: async (list: { id: string }[]) => list.forEach((r) => store.set(r.id, r)),
    unregister: async (f: { ids?: string[] }) => {
      if (f.ids) f.ids.forEach((id) => store.delete(id))
      else store.clear()
    },
  },
}

const { registerTransform, registerPreview, unregisterPreview, matchPatternsFor } = await import('./registry')

const saved = {
  id: 'SAVED',
  name: 'Saved',
  enabled: true,
  order: 1,
  match: '*.example.com/*',
  kind: 'js',
  origin: 'user',
  world: 'USER_SCRIPT',
  capabilities: [],
  intent: 'x',
  rationale: { targets: '', approach: '', assumptions: [] },
  anchor: { tag: 'div', classes: [], path: 'html>body>div', landmarks: [], selector: 'div.x' },
  code: 'savedCode()',
  createdAt: 1,
  updatedAt: 1,
} as unknown as Transform

const code = (id: string) => JSON.stringify(store.get(id))

describe('previewing a saved JavaScript transform', () => {
  beforeEach(() => {
    store.clear()
    stored = [saved]
  })

  it('pauses the saved registration while the preview runs', async () => {
    await registerTransform(saved)
    await registerPreview({ ...saved, code: 'draftCode()' })
    expect(store.has('SAVED')).toBe(false)
    expect(code('preview-SAVED')).toContain('draftCode()')
  })

  it('registers the saved transform again when the preview is cleared', async () => {
    await registerTransform(saved)
    await registerPreview({ ...saved, code: 'draftCode()' })
    await unregisterPreview('SAVED')
    expect(store.has('preview-SAVED')).toBe(false)
    expect(code('SAVED')).toContain('savedCode()')
    expect(code('SAVED')).not.toContain('draftCode()')
  })

  it('does not register a transform that is disabled in storage', async () => {
    stored = [{ ...saved, enabled: false }]
    await registerPreview({ ...saved, code: 'draftCode()' })
    await unregisterPreview('SAVED')
    expect(store.size).toBe(0)
  })

  it('registers nothing for a preview of a transform that was never saved', async () => {
    stored = []
    await registerPreview({ ...saved, id: 'NEW', code: 'draftCode()' })
    expect(code('preview-NEW')).toContain('draftCode()')
    await unregisterPreview('NEW')
    expect(store.size).toBe(0)
  })
})

describe('the schemes a script is registered for (#59)', () => {
  const patternsFor = async (match: string) => {
    store.clear()
    await registerTransform({ ...saved, match })
    return (store.get('SAVED') as { matches: string[] }).matches
  }

  it('is https only for a transform saved on an https page', async () => {
    expect(await patternsFor('https://example.com/*')).toEqual(['https://example.com/*'])
  })

  it('is http only for a transform saved on an http page', async () => {
    expect(await patternsFor('http://localhost/*')).toEqual(['http://localhost/*'])
  })

  it('is both only when the stored pattern says *:// explicitly', async () => {
    expect(await patternsFor('*://example.com/*')).toEqual([
      'https://example.com/*',
      'http://example.com/*',
    ])
  })

  it('is https only for a stored pattern with no scheme, which was saved before schemes were recorded', async () => {
    expect(await patternsFor('example.com/docs*')).toEqual(['https://example.com/docs*'])
  })

  it('never registers a scheme other than http or https', () => {
    for (const match of ['https://a.test/*', 'http://a.test/*', '*://a.test/*', 'a.test/*']) {
      const all = matchPatternsFor({ ...saved, match })
      expect(all.every((m) => /^https?:\/\//.test(m)), match).toBe(true)
    }
    expect(matchPatternsFor({ ...saved, match: 'https://a.test/*' })).not.toContain('http://a.test/*')
  })
})

describe('the paths a script is registered for (#95)', () => {
  const paths = (match: string) =>
    matchPatternsFor({ ...saved, match }).map((m) => m.replace(/^https:\/\/example\.com/, ''))

  it('covers the page with and without a trailing slash, and with any query, when the pattern has no query', () => {
    expect(paths('https://example.com/watch')).toEqual(['/watch', '/watch?*', '/watch/', '/watch/?*'])
    expect(paths('https://example.com/watch/')).toEqual(['/watch', '/watch?*', '/watch/', '/watch/?*'])
  })

  it('keeps the query of a pattern that has one, with and without the trailing slash', () => {
    expect(paths('https://example.com/watch?v=abc')).toEqual(['/watch?v=abc', '/watch/?v=abc'])
  })

  it('leaves a pattern that ends in a wildcard as it is', () => {
    expect(paths('https://example.com/*')).toEqual(['/*'])
    expect(paths('https://example.com/docs*')).toEqual(['/docs*'])
  })

  it('registers the root page without duplicating the slash', () => {
    expect(paths('https://example.com/')).toEqual(['/', '/?*'])
  })
})
