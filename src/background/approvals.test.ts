import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transform } from '@shared/types'
import { hashCode, isApproved, mayBeSaved, recordApproval, spendApproval } from './approvals'

/** Session storage as a plain object, which is all the module uses. */
let session: Record<string, unknown> = {}

beforeEach(() => {
  session = {}
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: async (key: string) => (key in session ? { [key]: session[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(session, items)
        },
      },
    },
  })
})

const transform = (over: Partial<Transform>): Transform => ({
  id: 't',
  name: 'T',
  enabled: true,
  order: 0,
  match: 'example.com/*',
  kind: 'js',
  origin: 'ai',
  capabilities: [],
  intent: 'x',
  rationale: { targets: '', approach: '', assumptions: [] },
  anchor: { tag: 'div', classes: [], path: '', landmarks: [], selector: 'div' },
  code: 'document.title = "a"',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const BIND = { transformId: 't', match: 'example.com/*' }

describe('approvals', () => {
  it('hashes the code and the world', async () => {
    const a = await hashCode('x', 'USER_SCRIPT')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashCode('x', undefined)).toBe(a)
    expect(await hashCode('x', 'MAIN')).not.toBe(a)
    expect(await hashCode('x ', 'USER_SCRIPT')).not.toBe(a)
  })

  it('approves only the code that was recorded, and only with its token', async () => {
    const token = await recordApproval('a()', undefined, [], 'match', BIND)
    expect(await isApproved(token, 'a()', undefined, [], BIND)).toBe(true)
    expect(await isApproved(token, 'a() ', undefined, [], BIND)).toBe(false)
    expect(await isApproved(token, 'a()', 'MAIN', [], BIND)).toBe(false)
    expect(await isApproved(token, 'b()', undefined, [], BIND)).toBe(false)
    expect(await isApproved(undefined, 'a()', undefined, [], BIND)).toBe(false)
    expect(await isApproved('not-a-token', 'a()', undefined, [], BIND)).toBe(false)
  })

  it('ties a token to the transform and the match pattern it was given for', async () => {
    const token = await recordApproval('a()', undefined, [], 'match', BIND)
    expect(await isApproved(token, 'a()', undefined, [], { ...BIND, transformId: 'other' })).toBe(false)
    expect(await isApproved(token, 'a()', undefined, [], { ...BIND, match: 'evil.example/*' })).toBe(false)
    // Control: the same token with the original binding is accepted.
    expect(await isApproved(token, 'a()', undefined, [], BIND)).toBe(true)
  })

  it('gives each approval its own token, and a new review replaces the old token', async () => {
    const first = await recordApproval('a()', undefined, [], 'match', BIND)
    const second = await recordApproval('a()', undefined, [], 'match', BIND)
    expect(second).not.toBe(first)
    expect(await isApproved(first, 'a()', undefined, [], BIND)).toBe(false)
    expect(await isApproved(second, 'a()', undefined, [], BIND)).toBe(true)
  })

  it('stops accepting a token once it is spent, and leaves other tokens alone', async () => {
    const one = await recordApproval('a()', undefined, [], 'match', BIND)
    const two = await recordApproval('b()', undefined, [], 'match', BIND)
    await spendApproval(one)
    expect(await isApproved(one, 'a()', undefined, [], BIND)).toBe(false)
    expect(await isApproved(two, 'b()', undefined, [], BIND)).toBe(true)
  })

  it('treats an approval for some capabilities as covering fewer, never more', async () => {
    const token = await recordApproval('a()', undefined, ['network', 'storage'], 'match', BIND)
    expect(await isApproved(token, 'a()', undefined, ['network'], BIND)).toBe(true)
    expect(await isApproved(token, 'a()', undefined, [], BIND)).toBe(true)
    expect(await isApproved(token, 'a()', undefined, ['cookies'], BIND)).toBe(false)
    expect(await isApproved(token, 'a()', undefined, ['network', 'cookies'], BIND)).toBe(false)
  })

  it('does not grow without limit', async () => {
    const first = await recordApproval('c0()', undefined, [], 'match', BIND)
    let last = ''
    for (let i = 1; i < 250; i += 1) last = await recordApproval(`c${i}()`, undefined, [], 'match', BIND)
    expect((session['wa-approvals'] as unknown[]).length).toBe(200)
    expect(await isApproved(first, 'c0()', undefined, [], BIND)).toBe(false)
    expect(await isApproved(last, 'c249()', undefined, [], BIND)).toBe(true)
  })
})

describe('mayBeSaved', () => {
  it('refuses code with no recorded approval', async () => {
    expect(await mayBeSaved(undefined, transform({}), undefined)).toBe(false)
  })

  it('accepts code once approved, and refuses a one-character change to it', async () => {
    const token = await recordApproval('document.title = "a"', undefined, [], 'match', BIND)
    expect(await mayBeSaved(undefined, transform({}), token)).toBe(true)
    expect(await mayBeSaved(undefined, transform({ code: 'document.title = "b"' }), token)).toBe(false)
  })

  it('refuses approved code saved under another transform id or match pattern', async () => {
    const token = await recordApproval('document.title = "a"', undefined, [], 'match', BIND)
    expect(await mayBeSaved(undefined, transform({ id: 'other' }), token)).toBe(false)
    expect(await mayBeSaved(undefined, transform({ match: 'evil.example/*' }), token)).toBe(false)
  })

  it('accepts a rename of stored code without a new approval', async () => {
    const stored = transform({ name: 'Old' })
    expect(await mayBeSaved(stored, transform({ name: 'New' }), undefined)).toBe(true)
  })

  it('does not accept stored code with a new capability or a new world', async () => {
    const stored = transform({})
    expect(await mayBeSaved(stored, transform({ capabilities: ['network'] }), undefined)).toBe(false)
    expect(await mayBeSaved(stored, transform({ world: 'MAIN' }), undefined)).toBe(false)
  })

  it('accepts stored code saved with fewer capabilities', async () => {
    const stored = transform({ capabilities: ['network'] })
    expect(await mayBeSaved(stored, transform({ capabilities: [] }), undefined)).toBe(true)
  })
})
