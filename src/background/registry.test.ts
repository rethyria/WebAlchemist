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
