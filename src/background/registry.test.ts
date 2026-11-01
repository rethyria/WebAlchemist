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

const { registerTransform, registerPreview, unregisterPreview } = await import('./registry')

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
