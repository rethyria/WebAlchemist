/**
 * Previews must not touch the registration of the saved transform they edit.
 *
 * The userScripts API is replaced by an in-memory store, so the test reads
 * back what is registered rather than checking which calls were made.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Transform } from '@shared/types'

const store = new Map<string, unknown>()
;(globalThis as unknown as { browser: unknown }).browser = {
  permissions: { contains: async () => true },
  storage: { local: { get: async () => ({}), set: async () => {} } },
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
  beforeEach(() => store.clear())

  it('leaves the saved registration in place while the preview runs', async () => {
    await registerTransform(saved)
    await registerPreview({ ...saved, code: 'draftCode()' })
    expect(code('SAVED')).toContain('savedCode()')
    expect(code('SAVED')).not.toContain('draftCode()')
    expect(code('preview-SAVED')).toContain('draftCode()')
  })

  it('still has the saved registration after the preview is cleared', async () => {
    await registerTransform(saved)
    await registerPreview({ ...saved, code: 'draftCode()' })
    await unregisterPreview('SAVED')
    expect(store.has('preview-SAVED')).toBe(false)
    expect(code('SAVED')).toContain('savedCode()')
  })
})
