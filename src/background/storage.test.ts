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

describe('malformed transform records (#90)', () => {
  // A record with no `match` made matchesUrl throw on every navigation, so one
  // bad record disabled every site. The bad shapes below are each one field
  // short of valid, which is how a hand-edited or truncated file looks.
  const { match: _match, ...withoutMatch } = mk('bad', 0)
  const malformed: [string, unknown][] = [
    ['no match', withoutMatch],
    ['a non-string match', { ...mk('bad', 0), match: 42 }],
    ['an unknown kind', { ...mk('bad', 0), kind: 'html' }],
    ['no anchor', { ...mk('bad', 0), anchor: undefined }],
    ['no rationale', { ...mk('bad', 0), rationale: null }],
    ['non-array capabilities', { ...mk('bad', 0), capabilities: 'network' }],
    ['no intent', { ...mk('bad', 0), intent: undefined }],
    ['no anchor tag', { ...mk('bad', 0), anchor: { ...mk('x', 0).anchor, tag: undefined } }],
    ['no anchor path', { ...mk('bad', 0), anchor: { ...mk('x', 0).anchor, path: undefined } }],
    ['non-array anchor classes', { ...mk('bad', 0), anchor: { ...mk('x', 0).anchor, classes: 'a b' } }],
    ['non-string anchor classes', { ...mk('bad', 0), anchor: { ...mk('x', 0).anchor, classes: [1] } }],
    ['not an object', 'transform'],
    ['null', null],
  ]

  it.each(malformed)('skips a stored record with %s when reading', async (_label, record) => {
    data['transforms'] = [mk('good', 0), record, mk('also-good', 1)]
    const all = await s.getAllTransforms()
    expect(all.map((t) => t.id)).toEqual(['good', 'also-good'])
  })

  it('does not drop records that are valid', async () => {
    // Control for the cases above: the same read returns a valid record whose
    // optional fields are present, so the check is not refusing everything.
    const full = mk('full', 0, { kind: 'js', world: 'MAIN', scopeDepth: 2 })
    data['transforms'] = [full]
    expect((await s.getAllTransforms()).map((t) => t.id)).toEqual(['full'])
  })

  it('skips invalid records on import and reports how many', async () => {
    const result = await s.importTransforms({
      schemaVersion: 1,
      exportedAt: 0,
      transforms: [mk('a', 0), withoutMatch as Transform, mk('b', 1)],
    })
    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(1)
    expect(await s.getAllTransforms()).toHaveLength(2)
  })

  it.each([
    ['no schemaVersion', { exportedAt: 0, transforms: [] }],
    ['no transforms array', { schemaVersion: 1, exportedAt: 0 }],
    ['not an object', 'text'],
  ])('rejects a bundle with %s', async (_label, bundle) => {
    await expect(s.importTransforms(bundle as never)).rejects.toThrow()
  })
})

describe('invalid records are kept, not deleted (#90)', () => {
  // A record the validator rejects, such as a hand-edited import or one from a
  // newer version. Reads skip it; no write may remove it.
  const odd = { id: 'odd', name: 'hand edited', kind: 'css' }
  const stored = () => (data['transforms'] as unknown[]).filter((r) => (r as { id?: string }).id === 'odd')

  beforeEach(() => {
    data['transforms'] = [mk('a', 0), odd, mk('b', 1)]
  })

  it('keeps it through a save of another transform', async () => {
    await s.saveTransform(mk('a', 0, { name: 'renamed' }))
    expect(stored()).toEqual([odd])
  })

  it('keeps it through a save that adds a transform', async () => {
    await s.saveTransform(mk('c', 2))
    expect(stored()).toEqual([odd])
  })

  it('keeps it through a delete', async () => {
    await s.deleteTransform('a')
    expect(stored()).toEqual([odd])
  })

  it('keeps it through a reorder', async () => {
    await s.reorderTransforms(['b', 'a'])
    expect(stored()).toEqual([odd])
  })

  it('keeps it through a field update', async () => {
    await s.updateTransform('a', { enabled: false })
    expect(stored()).toEqual([odd])
  })

  it('keeps it through an import', async () => {
    await s.importTransforms({ schemaVersion: 1, exportedAt: 0, transforms: [mk('x', 0)] })
    expect(stored()).toEqual([odd])
  })

  it('still leaves it out of reads and exports', async () => {
    expect((await s.getAllTransforms()).map((t) => t.id)).toEqual(['a', 'b'])
    expect((await s.exportTransforms()).transforms.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('counts the records it skips', async () => {
    expect(await s.countSkippedTransforms()).toBe(1)
    data['transforms'] = [mk('a', 0)]
    expect(await s.countSkippedTransforms()).toBe(0)
  })
})

describe('saving an incomplete transform (#90)', () => {
  // What a provider that ignores strict structured output can return.
  const incomplete: [string, Record<string, unknown>][] = [
    ['rationale.assumptions', { rationale: { targets: '', approach: '' } }],
    ['capabilities', { capabilities: undefined }],
    ['anchor.classes', { anchor: { tag: 'div', path: 'body', landmarks: [], selector: 'div' } }],
    ['intent', { intent: undefined }],
  ]

  it.each(incomplete)('refuses a record with no %s and stores nothing', async (field, over) => {
    await expect(s.saveTransform(mk('new', 0, over as Partial<Transform>))).rejects.toThrow(
      new RegExp(field.replace('.', '\\.')),
    )
    expect(data['transforms']).toBeUndefined()
  })

  it('refuses a field update that would make a stored record invalid', async () => {
    await s.saveTransform(mk('a', 0))
    await expect(s.updateTransform('a', { match: undefined } as never)).rejects.toThrow(/match/)
    expect((await s.getAllTransforms())[0]!.match).toBe('*://example.com/*')
  })

  it('stores a complete record, as the control for the refusals', async () => {
    await s.saveTransform(mk('ok', 0))
    expect((await s.getAllTransforms()).map((t) => t.id)).toEqual(['ok'])
  })
})
