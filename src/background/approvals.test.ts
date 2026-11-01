import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transform } from '@shared/types'
import { hashCode, isApproved, mayBeSaved, recordApproval } from './approvals'

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

describe('approvals', () => {
  it('hashes the code and the world', async () => {
    const a = await hashCode('x', 'USER_SCRIPT')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashCode('x', undefined)).toBe(a)
    expect(await hashCode('x', 'MAIN')).not.toBe(a)
    expect(await hashCode('x ', 'USER_SCRIPT')).not.toBe(a)
  })

  it('approves only the code that was recorded', async () => {
    await recordApproval('a()', undefined, [], 'match')
    expect(await isApproved('a()', undefined, [])).toBe(true)
    expect(await isApproved('a() ', undefined, [])).toBe(false)
    expect(await isApproved('a()', 'MAIN', [])).toBe(false)
    expect(await isApproved('b()', undefined, [])).toBe(false)
  })

  it('treats an approval for some capabilities as covering fewer, never more', async () => {
    await recordApproval('a()', undefined, ['network', 'storage'], 'match')
    expect(await isApproved('a()', undefined, ['network'])).toBe(true)
    expect(await isApproved('a()', undefined, [])).toBe(true)
    expect(await isApproved('a()', undefined, ['cookies'])).toBe(false)
    expect(await isApproved('a()', undefined, ['network', 'cookies'])).toBe(false)
  })

  it('does not grow without limit', async () => {
    for (let i = 0; i < 250; i += 1) await recordApproval(`c${i}()`, undefined, [], 'match')
    expect((session['wa-approvals'] as unknown[]).length).toBe(200)
    expect(await isApproved('c0()', undefined, [])).toBe(false)
    expect(await isApproved('c249()', undefined, [])).toBe(true)
  })
})

describe('mayBeSaved', () => {
  it('refuses code with no recorded approval', async () => {
    expect(await mayBeSaved(undefined, transform({}))).toBe(false)
  })

  it('accepts code once approved, and refuses a one-character change to it', async () => {
    await recordApproval('document.title = "a"', undefined, [], 'match')
    expect(await mayBeSaved(undefined, transform({}))).toBe(true)
    expect(await mayBeSaved(undefined, transform({ code: 'document.title = "b"' }))).toBe(false)
  })

  it('accepts a rename of stored code without a new approval', async () => {
    const stored = transform({ name: 'Old' })
    expect(await mayBeSaved(stored, transform({ name: 'New' }))).toBe(true)
  })

  it('does not accept stored code with a new capability or a new world', async () => {
    const stored = transform({})
    expect(await mayBeSaved(stored, transform({ capabilities: ['network'] }))).toBe(false)
    expect(await mayBeSaved(stored, transform({ world: 'MAIN' }))).toBe(false)
  })

  it('accepts stored code saved with fewer capabilities', async () => {
    const stored = transform({ capabilities: ['network'] })
    expect(await mayBeSaved(stored, transform({ capabilities: [] }))).toBe(true)
  })
})
