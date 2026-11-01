/**
 * Transform writes through the message handlers (#84, #85).
 *
 * storage.test.ts covers the storage functions with random delays. These tests
 * send the same messages the sidebar and the editor send, to the real
 * index.ts, so they cover the handlers' use of those functions.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

let h: Harness
const stored = () => h.local.get('transforms') as ReturnType<typeof cssTransform>[]
const byId = (id: string) => stored().find((t) => t.id === id)!

beforeEach(async () => {
  h = createHarness()
  await h.boot()
})

describe('a save of a copy that is out of date', () => {
  it('does not undo a reorder sent in the same moment, in 20 of 20 runs', async () => {
    for (let run = 0; run < 20; run += 1) {
      h.local.set('transforms', [cssTransform({ id: 'a', order: 0 }), cssTransform({ id: 'b', order: 1 })])
      // The editor still holds `a` with order 0 while the sidebar reorders.
      await Promise.all([
        h.onMessage({ type: 'reorder-transforms', orderedIds: ['b', 'a'] }),
        h.onMessage({
          type: 'save-transform',
          transform: cssTransform({ id: 'a', order: 0, code: 'p { margin: 0 }' }),
        }),
      ])
      expect([byId('a').order, byId('a').code]).toEqual([1, 'p { margin: 0 }'])
      expect(byId('b').order).toBe(0)
    }
  })

  it('does not enable a transform that was disabled after the copy was loaded', async () => {
    h.local.set('transforms', [cssTransform({ id: 'a', enabled: true })])
    await h.onMessage({ type: 'set-enabled', id: 'a', enabled: false })
    await h.onMessage({
      type: 'save-transform',
      transform: cssTransform({ id: 'a', enabled: true, code: 'p { margin: 0 }' }),
    })
    expect([byId('a').enabled, byId('a').code]).toEqual([false, 'p { margin: 0 }'])
  })

  it('still saves a new transform with the values it was sent', async () => {
    // Control for the two tests above.
    await h.onMessage({
      type: 'save-transform',
      transform: cssTransform({ id: 'n', order: 4, enabled: false }),
    })
    expect([byId('n').order, byId('n').enabled]).toEqual([4, false])
  })
})

describe('the enable toggle', () => {
  it('keeps a save of the same transform that overlaps it, in 20 of 20 runs', async () => {
    for (let run = 0; run < 20; run += 1) {
      h.local.set('transforms', [cssTransform({ id: 'a' })])
      await Promise.all([
        h.onMessage({ type: 'save-transform', transform: cssTransform({ id: 'a', name: 'renamed' }) }),
        h.onMessage({ type: 'set-enabled', id: 'a', enabled: false }),
      ])
      expect([byId('a').name, byId('a').enabled]).toEqual(['renamed', false])
    }
  })

  it('answers with an error for a transform that does not exist', async () => {
    const reply = await h.onMessage({ type: 'set-enabled', id: 'gone', enabled: false })
    expect(reply).toMatchObject({ ok: false })
  })
})

describe('saving an incomplete transform', () => {
  it('answers with an error and stores nothing', async () => {
    const { rationale: _r, ...incomplete } = cssTransform()
    const reply = await h.onMessage({ type: 'save-transform', transform: incomplete })
    expect(reply).toMatchObject({ ok: false })
    expect(reply.error.message).toContain('rationale')
    expect(h.local.get('transforms')).toBeUndefined()
  })
})
