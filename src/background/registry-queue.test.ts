/**
 * Registering user scripts from two places at once (#122).
 *
 * The userScripts stub behaves as Firefox does in the one way that matters
 * here: registering an id that is already registered fails. Each call also
 * waits a tick, so two overlapping calls interleave their read and their write.
 * Without the queue in registry.ts, both calls read "not registered" and the
 * second register() throws.
 */

import { describe, expect, it } from 'vitest'

const store = new Map<string, any>()
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
let stored: unknown[] = []
;(globalThis as unknown as { browser: unknown }).browser = {
  permissions: { contains: async () => true },
  storage: {
    local: { get: async () => ({ transforms: stored, settings: {} }), set: async () => {} },
  },
  userScripts: {
    configureWorld: async () => {
      await tick()
    },
    getScripts: async (f?: { ids?: string[] }) => {
      await tick()
      return [...store.values()].filter((s) => !f?.ids || f.ids.includes(s.id))
    },
    register: async (list: { id: string }[]) => {
      await tick()
      for (const r of list) {
        if (store.has(r.id)) throw new Error(`Script ${r.id} is already registered`)
        store.set(r.id, r)
      }
    },
    update: async (list: { id: string }[]) => {
      await tick()
      for (const r of list) {
        if (!store.has(r.id)) throw new Error(`Script ${r.id} is not registered`)
        store.set(r.id, r)
      }
    },
    unregister: async (f: { ids?: string[] }) => {
      await tick()
      for (const id of f.ids ?? [...store.keys()]) store.delete(id)
    },
  },
}

const { registerTransform, unregisterTransform, reregisterAll } = await import('./registry')

const script = {
  id: 'S',
  name: 'S',
  enabled: true,
  order: 1,
  match: 'example.com/*',
  kind: 'js',
  origin: 'user',
  world: 'USER_SCRIPT',
  capabilities: [],
  intent: 'x',
  rationale: { targets: '', approach: '', assumptions: [] },
  anchor: { tag: 'div', classes: [], path: 'html>body>div', landmarks: [], selector: 'div' },
  code: 'a()',
  createdAt: 1,
  updatedAt: 1,
} as any

describe('overlapping registrations', () => {
  it('registers a script once when two callers register it at the same time', async () => {
    store.clear()
    stored = [script]
    await Promise.all([registerTransform(script), registerTransform(script)])
    expect([...store.keys()]).toEqual(['S'])
  })

  it('does not fail when a re-registration pass overlaps a save', async () => {
    store.clear()
    stored = [script]
    await Promise.all([reregisterAll(), registerTransform(script)])
    expect([...store.keys()]).toEqual(['S'])
  })

  it('leaves the script unregistered when a removal is queued after a registration', async () => {
    store.clear()
    stored = [script]
    await Promise.all([registerTransform(script), unregisterTransform('S')])
    expect(store.size).toBe(0)
  })

  it('keeps working after one change fails', async () => {
    store.clear()
    stored = [script]
    // No permission is not simulated here; a failing configureWorld stands in.
    const browserStub = (globalThis as any).browser
    const original = browserStub.userScripts.configureWorld
    browserStub.userScripts.configureWorld = async () => {
      throw new Error('boom')
    }
    await expect(registerTransform(script)).rejects.toThrow('boom')
    browserStub.userScripts.configureWorld = original
    await registerTransform(script)
    expect(store.has('S')).toBe(true)
  })
})
