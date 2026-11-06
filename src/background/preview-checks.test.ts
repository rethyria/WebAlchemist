/**
 * What preview-js checks before it registers code for a page (#55).
 *
 * Each refusal has a control that sends the same message with the one field
 * that the refusal is about made correct, so a test that passes only because
 * the message was malformed in some other way cannot pass.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 3
const PAGE = 'https://www.example.com/shop/item?id=4'

const draft = (over: Record<string, unknown> = {}) =>
  cssTransform({
    id: 'draft',
    kind: 'js',
    world: 'USER_SCRIPT',
    code: 'document.title = "draft"',
    match: '*.example.com/*',
    capabilities: [],
    ...over,
  })

let h: Harness
beforeEach(async () => {
  h = createHarness()
  h.hasUserScripts = true
  h.tabUrls.set(TAB, PAGE)
  await h.boot()
})

const send = (message: unknown) => h.onMessage(message)
const registered = () => h.userScriptsHeld.has('preview-draft')

describe('the page of the preview', () => {
  it('registers when the page is covered, the address is expected and the review matched (control)', async () => {
    const reply = await send(await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft() }))
    expect(reply.ok).toBe(true)
    expect(registered()).toBe(true)
  })

  it('refuses a page that the draft pattern does not cover', async () => {
    const reply = await send(
      await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft({ match: 'other.example.org/*' }) }),
    )
    expect(reply.ok).toBe(false)
    expect(reply.error.message).toMatch(/does not apply to this page/)
    expect(registered()).toBe(false)
  })

  it('refuses a page on the excluded list', async () => {
    await send({ type: 'set-excluded-sites', sites: ['example.com'] })
    const reply = await send(await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft() }))
    expect(reply.ok).toBe(false)
    expect(registered()).toBe(false)
  })

  it('refuses when the tab is at another address than the sidebar expects', async () => {
    const reply = await send(
      await h.approvedPreview({
        type: 'preview-js',
        tabId: TAB,
        transform: draft(),
        expectedUrl: 'https://www.example.com/shop/other',
      }),
    )
    expect(reply.ok).toBe(false)
    expect(reply.error.message).toMatch(/moved to another page/)
    expect(registered()).toBe(false)
  })

  it('accepts the same page when its query differs from the address the sidebar showed', async () => {
    const reply = await send(
      await h.approvedPreview({
        type: 'preview-js',
        tabId: TAB,
        transform: draft(),
        expectedUrl: 'https://www.example.com/shop/item?id=4&status=premium%2Cpromo',
      }),
    )
    expect(reply.ok).toBe(true)
    expect(registered()).toBe(true)
  })

  it('accepts the two spaceship.com addresses as the same page', async () => {
    const filtered =
      'https://www.spaceship.com/en-GB/domain-search/domains/?query=engram.&status=premium%2Cpromo%2Caftermarket'
    h.tabUrls.set(TAB, 'https://www.spaceship.com/en-GB/domain-search/domains/?query=engram.')
    const reply = await send(
      await h.approvedPreview({
        type: 'preview-js',
        tabId: TAB,
        transform: draft({ match: 'www.spaceship.com/*' }),
        expectedUrl: filtered,
      }),
    )
    expect(reply.ok).toBe(true)
  })

  it('refuses another host with the same path', async () => {
    const reply = await send(
      await h.approvedPreview({
        type: 'preview-js',
        tabId: TAB,
        transform: draft(),
        expectedUrl: 'https://shop.example.com/shop/item?id=4',
      }),
    )
    expect(reply.ok).toBe(false)
    expect(reply.error.message).toMatch(/moved to another page/)
  })

  it('ignores the fragment when comparing the addresses', async () => {
    const reply = await send(
      await h.approvedPreview({
        type: 'preview-js',
        tabId: TAB,
        transform: draft(),
        expectedUrl: `${PAGE}#reviews`,
      }),
    )
    expect(reply.ok).toBe(true)
  })
})

describe('the page of the preview, with any query', () => {
  it('is registered for the path with and without a query, and with no trailing-slash form', async () => {
    await send(await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft() }))
    expect(h.userScriptsHeld.get('preview-draft').matches).toEqual([
      'https://www.example.com/shop/item',
      'https://www.example.com/shop/item?*',
    ])
  })

  it('control: the saved script with the same pattern is registered with the expanded forms', async () => {
    h.local.set('transforms', [draft({ id: 'saved', match: 'www.example.com/shop/item?id=4' })])
    await h.boot()
    const matches: string[] = h.userScriptsHeld.get('saved').matches
    expect(matches).toContain('https://www.example.com/shop/item/?id=4')
    expect(matches.length).toBeGreaterThan(1)
  })

  it('refuses a page whose path has a wildcard character', async () => {
    h.tabUrls.set(TAB, 'https://www.example.com/shop/*')
    const reply = await send(await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft() }))
    expect(reply.ok).toBe(false)
    expect(registered()).toBe(false)
  })
})

describe('the review that a preview needs', () => {
  const approvals = () => (h.session.get('wa-approvals') as unknown[]) ?? []

  it('refuses a message with no token', async () => {
    const message = await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft() })
    const reply = await send({ ...message, approvalToken: '' })
    expect(reply.ok).toBe(false)
    expect(registered()).toBe(false)
  })

  it('refuses a token that was issued for other code', async () => {
    const message = await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft() })
    const reply = await send({ ...message, transform: draft({ code: 'document.title = "changed"' }) })
    expect(reply.ok).toBe(false)
    expect(registered()).toBe(false)
  })

  it('refuses a token that was issued for the isolated world when the draft asks for MAIN', async () => {
    const message = await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft() })
    const reply = await send({ ...message, transform: draft({ world: 'MAIN' }) })
    expect(reply.ok).toBe(false)
    expect(registered()).toBe(false)
  })

  it.each(['mismatch', 'uncertain', 'user-written'] as const)('refuses a token whose verdict is %s', async (verdict) => {
    const message = await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft() }, verdict)
    const reply = await send(message)
    expect(reply.ok).toBe(false)
    expect(registered()).toBe(false)
  })

  it('registers a MAIN preview only with a token for MAIN (control)', async () => {
    const reply = await send(
      await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft({ world: 'MAIN' }) }),
    )
    expect(reply.ok).toBe(true)
    expect(h.userScriptsHeld.get('preview-draft').world).toBe('MAIN')
  })

  it('does not spend the token', async () => {
    await send(await h.approvedPreview({ type: 'preview-js', tabId: TAB, transform: draft() }))
    expect(approvals()).toHaveLength(1)
  })
})
