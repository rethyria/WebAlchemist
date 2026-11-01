/**
 * Transform storage under concurrent callers (#84, #90).
 *
 * The background script handles each message in its own call, so two handlers
 * can be inside a read-modify-write of the transform list at once. These tests
 * use a fake `browser.storage.local` whose `get` and `set` each wait a random
 * 0 to 5 ms, which is what makes the interleaving happen; with instant
 * promises the calls would happen to run one after another and hide the bug.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transform } from '@shared/types'

let data: Record<string, unknown> = {}
const pause = () => new Promise((r) => setTimeout(r, Math.random() * 5))

vi.stubGlobal('browser', {
  storage: {
    local: {
      async get(key: string) {
        await pause()
        return key in data ? { [key]: structuredClone(data[key]) } : {}
      },
      async set(values: Record<string, unknown>) {
        await pause()
        Object.assign(data, structuredClone(values))
      },
      async remove(key: string) {
        delete data[key]
      },
    },
  },
})

const s = await import('./storage')

const mk = (id: string, order: number, over: Partial<Transform> = {}): Transform => ({
  id,
  name: id,
  enabled: true,
  order,
  match: '*://example.com/*',
  kind: 'css',
  origin: 'manual',
  capabilities: [],
  intent: 'x',
  rationale: { targets: '', approach: '', assumptions: [] },
  anchor: { tag: 'div', classes: [], path: 'body', landmarks: [], selector: 'div' },
  code: 'div{}',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

beforeEach(() => {
  data = {}
})

describe('concurrent transform writes', () => {
  it('keeps every update when saves overlap', async () => {
    await s.saveTransform(mk('a', 1))
    await s.saveTransform(mk('b', 2))
    await Promise.all([
      s.saveTransform(mk('a', 1, { enabled: false })),
      s.saveTransform(mk('b', 2, { enabled: false })),
      s.saveTransform(mk('c', 3)),
    ])
    const all = await s.getAllTransforms()
    expect(all.map((t) => [t.id, t.enabled])).toEqual([
      ['a', false],
      ['b', false],
      ['c', true],
    ])
  })

  it('does not let a save bring back a transform deleted at the same time', async () => {
    await s.saveTransform(mk('a', 1))
    await s.saveTransform(mk('b', 2))
    await Promise.all([s.deleteTransform('a'), s.saveTransform(mk('b', 2, { name: 'renamed' }))])
    const all = await s.getAllTransforms()
    expect(all.map((t) => [t.id, t.name])).toEqual([['b', 'renamed']])
  })

  it('keeps a reorder and an import that overlap', async () => {
    await s.saveTransform(mk('a', 0))
    await s.saveTransform(mk('b', 1))
    await Promise.all([
      s.reorderTransforms(['b', 'a']),
      s.importTransforms({ schemaVersion: 1, exportedAt: 0, transforms: [mk('x', 0)] }),
    ])
    const all = await s.getAllTransforms()
    expect(all).toHaveLength(3)
    expect(all.find((t) => t.id === 'b')?.order).toBe(0)
    expect(all.find((t) => t.id === 'a')?.order).toBe(1)
  })

  it('keeps a save and a field update of the same transform that overlap', async () => {
    // The storage stub's delays are random, so one run can pass by luck.
    for (let run = 0; run < 20; run += 1) {
      data = {}
      await s.saveTransform(mk('a', 1))
      await Promise.all([
        s.saveTransform(mk('a', 1, { name: 'renamed' })),
        s.updateTransform('a', { enabled: false }),
      ])
      const a = (await s.getAllTransforms())[0]!
      expect([a.name, a.enabled]).toEqual(['renamed', false])
    }
  })

  it('reports a missing transform from updateTransform without writing', async () => {
    await s.saveTransform(mk('a', 1))
    expect(await s.updateTransform('gone', { enabled: false })).toBeNull()
    expect((await s.getAllTransforms()).map((t) => t.id)).toEqual(['a'])
  })

  it('keeps running later writes after one fails', async () => {
    await s.saveTransform(mk('a', 1))
    const failing = s.importTransforms({ schemaVersion: 99, exportedAt: 0, transforms: [] })
    const after = s.saveTransform(mk('b', 2))
    await expect(failing).rejects.toThrow()
    await after
    expect((await s.getAllTransforms()).map((t) => t.id)).toEqual(['a', 'b'])
  })
})
