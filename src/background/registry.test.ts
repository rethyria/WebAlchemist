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
/** Ids whose registration fails, to test a preview that cannot be registered. */
const failing = new Set<string>()
let stored: unknown[] = []
let killSwitch = false
let offHosts: string[] = []
;(globalThis as unknown as { browser: unknown }).browser = {
  permissions: { contains: async () => true },
  // `stored` is what getAllTransforms reads, so a test can say what is saved.
  storage: {
    local: {
      get: async () => ({ transforms: stored, settings: { aiJsKillSwitch: killSwitch }, 'wa-sites-off': offHosts }),
      set: async () => {},
    },
  },
  userScripts: {
    configureWorld: async () => {},
    getScripts: async (f: { ids: string[] }) =>
      f.ids.filter((id) => store.has(id)).map((id) => store.get(id)),
    register: async (list: { id: string }[]) => {
      for (const r of list) {
        if (failing.has(r.id)) throw new Error('register failed')
        store.set(r.id, r)
      }
    },
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
    killSwitch = false
    offHosts = []
    failing.clear()
  })

  it('registers the saved script again when the preview cannot be registered', async () => {
    await registerTransform(saved)
    failing.add('preview-SAVED')
    await expect(registerPreview({ ...saved, code: 'draftCode()' })).rejects.toThrow(
      'register failed',
    )
    // Control: the saved script was paused by registerPreview before the
    // failure, so without the restore this is false.
    expect(code('SAVED')).toContain('savedCode()')
    expect(store.has('preview-SAVED')).toBe(false)
  })

  it('runs a preview of a script that is disabled in storage', async () => {
    await registerPreview({ ...saved, enabled: false, code: 'draftCode()' })
    expect(code('preview-SAVED')).toContain('draftCode()')
  })

  it('refuses a preview of model-written code while the kill switch is on', async () => {
    await registerTransform(saved)
    killSwitch = true
    await expect(
      registerPreview({ ...saved, origin: 'ai', code: 'draftCode()' }),
    ).rejects.toThrow(/switched off/)
    expect(store.has('preview-SAVED')).toBe(false)
    // The refused preview did not pause the saved registration.
    expect(store.has('SAVED')).toBe(true)
  })

  it('refuses a preview of hand-written code while the kill switch is on (#121)', async () => {
    // Before #121 the switch covered only model-written code, and this
    // preview ran.
    killSwitch = true
    await expect(registerPreview({ ...saved, code: 'draftCode()' })).rejects.toThrow(/switched off/)
    expect(store.has('preview-SAVED')).toBe(false)
  })

  it('previews hand-written code while the kill switch is off (control)', async () => {
    await registerPreview({ ...saved, code: 'draftCode()' })
    expect(code('preview-SAVED')).toContain('draftCode()')
  })

  it('does not register hand-written code while the kill switch is on (#121)', async () => {
    killSwitch = true
    await registerTransform(saved)
    expect(store.has('SAVED')).toBe(false)
  })

  it('excludes the hosts that are turned off from a registration (#121)', async () => {
    offHosts = ['www.example.com', 'bank.example.org']
    await registerTransform(saved)
    expect((store.get('SAVED') as any).excludeMatches).toEqual([
      '*://bank.example.org/*',
      '*://www.example.com/*',
    ])
  })

  it('registers with no exclusions when no host is turned off (control)', async () => {
    await registerTransform(saved)
    expect((store.get('SAVED') as any).excludeMatches).toBeUndefined()
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

  it('is both for a stored pattern with no scheme, so a transform saved before schemes were recorded keeps running on http', async () => {
    expect(await patternsFor('example.com/docs*')).toEqual([
      'https://example.com/docs*',
      'http://example.com/docs*',
    ])
  })

  it('control: a pattern saved with a scheme is not widened to both', async () => {
    expect(await patternsFor('https://example.com/docs*')).toEqual(['https://example.com/docs*'])
    expect(await patternsFor('http://example.com/docs*')).toEqual(['http://example.com/docs*'])
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

  it('also registers the trailing-slash form of a pattern that has a query and ends in a wildcard', () => {
    expect(paths('https://example.com/search?q=*')).toEqual(['/search?q=*', '/search/?q=*'])
  })

  it('registers the root page without duplicating the slash', () => {
    expect(paths('https://example.com/')).toEqual(['/', '/?*'])
  })
})
