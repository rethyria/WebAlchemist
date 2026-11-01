/**
 * The Anthropic client does not follow a redirect (#75), so the API key and
 * the prompt are not sent to the address a redirect names. Runs the real
 * adapter with `fetch` replaced by a stub that behaves like the platform: it
 * follows a redirect unless the call asked for 'error'. No network call is made.
 */

import { resetBrowserMock } from '../test-support/browser-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@shared/types'
import * as storage from '../storage'
import { createAnthropicProvider } from './anthropic'

const provider = {
  id: 'a1',
  label: 'Claude',
  type: 'anthropic',
  generateModel: 'claude-opus-4-6',
  reviewModel: 'claude-opus-4-6',
  supportsVision: true,
} as Provider

/** Records each request's URL, header and redirect mode, as the platform would see them. */
function redirectingFetch() {
  const requests: { url: string; apiKey: string | null; redirect: string | undefined }[] = []
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string | URL, init: RequestInit) => {
    const href = String(url)
    const headers = new Headers(init.headers)
    requests.push({ url: href, apiKey: headers.get('x-api-key'), redirect: init.redirect })
    if (href.startsWith('http://evil.example')) return new Response('{}')
    // The API address answers with a redirect to a plain-http address.
    if (init.redirect === 'error') throw new TypeError('NetworkError when attempting to fetch resource.')
    requests.push({ url: 'http://evil.example/collect', apiKey: headers.get('x-api-key'), redirect: undefined })
    return new Response('{}')
  }
  return requests
}

beforeEach(async () => {
  resetBrowserMock()
  await storage.saveCredentialFor(provider, { kind: 'api_key', value: 'sk-secret' })
})

describe('requests of the Anthropic client', () => {
  it('ask for redirects to fail, and nothing reaches the address a redirect names', async () => {
    const requests = redirectingFetch()
    await (await createAnthropicProvider(provider)).review({ code: 'x', intent: 'y' }).catch(() => undefined)

    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((r) => r.redirect === 'error')).toBe(true)
    expect(requests.some((r) => r.url.startsWith('http://evil.example'))).toBe(false)
    expect(requests.every((r) => r.url.startsWith('https://api.anthropic.com/'))).toBe(true)
  })

  // Control: the stub does send the key to the redirect target when a call
  // does not ask for 'error', so the result above comes from the option.
  it('the stub follows a redirect when the option is absent', async () => {
    const requests = redirectingFetch()
    await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': 'sk-secret' } })
    expect(requests.map((r) => [r.url, r.apiKey])).toEqual([
      ['https://api.anthropic.com/v1/messages', 'sk-secret'],
      ['http://evil.example/collect', 'sk-secret'],
    ])
  })
})
