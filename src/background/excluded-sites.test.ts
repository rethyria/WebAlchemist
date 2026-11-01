/**
 * The background's side of the excluded-sites list (#131): the same refusal
 * when the panel's own check is bypassed, and the list's storage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, type Harness } from './test-browser'

let h: Harness
async function reply(message: unknown) {
  return h.onMessage(message)
}

beforeEach(async () => {
  // The overlay palette is chosen from the colour scheme, which the test environment lacks.
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  h = createHarness()
  h.tabUrls.set(1, 'https://login.bank.example/')
  h.tabUrls.set(2, 'https://news.example/')
  h.contentReply = (m) => (m.type === 'ping' ? true : undefined)
  await h.boot()
})

describe('the list', () => {
  it('starts empty', async () => {
    expect((await reply({ type: 'get-excluded-sites' })).data).toEqual([])
  })

  it('stores normalised hosts without duplicates', async () => {
    const out = await reply({ type: 'set-excluded-sites', sites: ['Bank.Example', 'https://bank.example/x', '*.mail.test'] })
    expect(out.data).toEqual(['bank.example', 'mail.test'])
    expect((await reply({ type: 'get-excluded-sites' })).data).toEqual(['bank.example', 'mail.test'])
  })

  it('refuses an entry that is not a site name, and keeps the old list', async () => {
    await reply({ type: 'set-excluded-sites', sites: ['bank.example'] })
    const out = await reply({ type: 'set-excluded-sites', sites: ['bank.example', 'oops'] })
    expect(out.ok).toBe(false)
    expect((await reply({ type: 'get-excluded-sites' })).data).toEqual(['bank.example'])
  })
})

describe('start-picking', () => {
  const started = () => h.calls.sendMessage.filter((c) => c.message.type === 'start-picking')

  it('is refused on an excluded host and reaches no page', async () => {
    await reply({ type: 'set-excluded-sites', sites: ['bank.example'] })
    const out = await reply({ type: 'start-picking', tabId: 1 })
    expect(out.ok).toBe(false)
    expect(out.error.message).toContain('login.bank.example')
    expect(started()).toEqual([])
  })

  it('proceeds on a host that is not excluded (control)', async () => {
    await reply({ type: 'set-excluded-sites', sites: ['bank.example'] })
    expect((await reply({ type: 'start-picking', tabId: 2 })).ok).toBe(true)
    expect(started()).toHaveLength(1)
  })

  it('proceeds on the excluded host once it is removed', async () => {
    await reply({ type: 'set-excluded-sites', sites: ['bank.example'] })
    await reply({ type: 'set-excluded-sites', sites: [] })
    expect((await reply({ type: 'start-picking', tabId: 1 })).ok).toBe(true)
  })
})

describe('repair', () => {
  it('is refused for a page on an excluded host before any model call', async () => {
    await reply({ type: 'set-excluded-sites', sites: ['bank.example'] })
    const out = await reply({
      type: 'repair',
      tabId: 1,
      transformId: 'x',
      context: { url: 'https://login.bank.example/a' },
      brokenReason: 'b',
    })
    expect(out.ok).toBe(false)
    expect(out.error.message).toContain('excluded')
  })
})

describe('page-has-sensitive-fields', () => {
  it('relays the page answer when there is one', async () => {
    h.contentReply = (m) => (m.type === 'sensitive-fields' ? true : undefined)
    expect((await reply({ type: 'page-has-sensitive-fields', tabId: 2 })).data).toBe(true)
    h.contentReply = (m) => (m.type === 'sensitive-fields' ? false : undefined)
    expect((await reply({ type: 'page-has-sensitive-fields', tabId: 2 })).data).toBe(false)
  })

  it('reports a page with such fields when the page gives no answer (#131)', async () => {
    h.contentReply = () => undefined
    expect((await reply({ type: 'page-has-sensitive-fields', tabId: 2 })).data).toBe(true)
  })
})

describe('generation over the port', () => {
  async function generate(url: string) {
    const posted: any[] = []
    let onMessage: (m: unknown) => void = () => {}
    const port = {
      name: 'wa-generate',
      sender: { url: 'moz-extension://abc-123/src/sidebar/index.html', id: 'wa@test' },
      postMessage: (m: unknown) => posted.push(m),
      disconnect: () => {},
      onMessage: { addListener: (l: (m: unknown) => void) => (onMessage = l) },
      onDisconnect: { addListener: () => {} },
    }
    h.listeners.get('browser.runtime.onConnect')!(port)
    onMessage({ tabId: 1, context: { url }, instruction: 'x', history: [] })
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0))
    return posted
  }

  it('answers with an error and never reports the request as sent, for an excluded host', async () => {
    await reply({ type: 'set-excluded-sites', sites: ['bank.example'] })
    const posted = await generate('https://login.bank.example/')
    expect(posted.some((m) => m.type === 'sent')).toBe(false)
    expect(posted[0].type).toBe('error')
    expect(JSON.stringify(posted[0])).toContain('excluded')
  })
})

describe('the one-shot generate message (#131)', () => {
  it('is not handled, so no page text reaches a provider through it', async () => {
    await reply({ type: 'set-excluded-sites', sites: ['bank.example'] })
    // Before the handler was removed this reached the provider with no
    // exclusion check, and failed here only because no provider is set up.
    const out = await reply({
      type: 'generate',
      context: { url: 'https://login.bank.example/a' },
      instruction: 'x',
      history: [],
    })
    expect(out).toEqual({ ok: true, data: undefined })
  })
})
