/**
 * The per-transform usage store stays bounded (#126): a deleted transform's
 * entry is removed, and the entries of drafts that were never saved are folded
 * into one.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { NOT_SAVED_USAGE_ID } from '@shared/usage'
import { createHarness, cssTransform, type Harness } from './test-browser'

let h: Harness
const call = { calls: 1, reportedCalls: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.5, pricedCalls: 1 }
const usageOf = () => (h.local.get('usage') as { transforms: Record<string, typeof call> }).transforms
const record = (transformId: string) =>
  h.onMessage({ type: 'save-transform', transform: cssTransform({ id: transformId }) })

beforeEach(async () => {
  h = createHarness()
  await h.boot()
})

describe('deleting a transform', () => {
  it('removes its usage entry and keeps the others and the monthly totals', async () => {
    h.local.set('transforms', [cssTransform({ id: 'a' }), cssTransform({ id: 'b' })])
    h.local.set('usage', { months: { '2026-11': { p: call } }, transforms: { a: call, b: call } })

    await h.onMessage({ type: 'delete-transform', id: 'a' })

    expect(Object.keys(usageOf())).toEqual(['b'])
    expect((h.local.get('usage') as { months: unknown }).months).toEqual({ '2026-11': { p: call } })
  })

  // Control: a transform that is not deleted keeps its entry when another is.
  it('keeps the entry of a transform that is saved again', async () => {
    h.local.set('transforms', [cssTransform({ id: 'a' })])
    h.local.set('usage', { months: {}, transforms: { a: call } })
    await record('a')
    expect(Object.keys(usageOf())).toEqual(['a'])
  })

  it('deletes the transform when there is no usage stored at all', async () => {
    h.local.set('transforms', [cssTransform({ id: 'a' })])
    const reply = await h.onMessage({ type: 'delete-transform', id: 'a' })
    expect(reply.ok).toBe(true)
    expect(h.local.get('transforms')).toEqual([])
  })
})

describe('drafts that were not saved', () => {
  const seed = () => {
    h.local.set('transforms', [cssTransform({ id: 'saved' })])
    h.local.set('usage', {
      months: {},
      transforms: { saved: call, 'draft-1': call, 'draft-2': { ...call, calls: 3, costUsd: 1 } },
    })
  }

  it('are folded into one entry when the browser starts, in sum', async () => {
    seed()
    await h.listeners.get('browser.runtime.onStartup')!()
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(Object.keys(usageOf()).sort()).toEqual([NOT_SAVED_USAGE_ID, 'saved'])
    expect(usageOf()[NOT_SAVED_USAGE_ID]).toMatchObject({ calls: 4, costUsd: 1.5, inputTokens: 20 })
    expect(usageOf()['saved']).toEqual(call)
  })

  it('are folded when the extension is installed or updated', async () => {
    seed()
    await h.listeners.get('browser.runtime.onInstalled')!({ reason: 'update' })
    expect(Object.keys(usageOf()).sort()).toEqual([NOT_SAVED_USAGE_ID, 'saved'])
  })

  // Control: folding twice adds nothing again, and a stored record that fails
  // validation still counts as saved.
  it('are folded once, and an invalid stored record keeps its usage', async () => {
    h.local.set('transforms', [{ id: 'broken' }])
    h.local.set('usage', { months: {}, transforms: { broken: call, 'draft-1': call } })
    await h.listeners.get('browser.runtime.onStartup')!()
    await h.listeners.get('browser.runtime.onStartup')!()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(usageOf()[NOT_SAVED_USAGE_ID]?.calls).toBe(1)
    expect(usageOf()['broken']).toEqual(call)
  })

  it('are not folded while the sidebar is working on them, only at the times above', async () => {
    seed()
    await h.onMessage({ type: 'get-usage' })
    expect(Object.keys(usageOf())).toContain('draft-1')
  })
})
