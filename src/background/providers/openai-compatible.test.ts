/**
 * The OpenAI-compatible adapter's error handling, run against the real storage
 * and vault code with `fetch` replaced. No network call is made.
 */

import { resetBrowserMock } from '../test-support/browser-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '@shared/types'
import * as storage from '../storage'
import { createOpenAiCompatibleProvider } from './openai-compatible'
import { ProviderError } from './types'

const provider = {
  id: 'p1',
  label: 'Remote',
  type: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  generateModel: 'm',
  reviewModel: 'm',
  supportsVision: false,
} as unknown as Provider

const REVIEW_ARGS = { code: 'x', intent: 'y' }
const PASSPHRASE = 'correct horse battery'

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  ;(globalThis as unknown as { fetch: unknown }).fetch = spy
  return spy
}

beforeEach(() => {
  resetBrowserMock()
})

describe('credential errors keep their own kind', () => {
  /*
   * Each case asserts that `fetch` was never called for the chat request. The
   * control for the whole group is the first test after it: with a usable
   * credential the same call reaches `fetch`, so a rejection above cannot be
   * explained by the stub refusing everything.
   */
  it('reports a locked vault as a locked vault, not a network failure', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    await storage.enableVault(PASSPHRASE)
    await storage.lockVault()
    const fetchSpy = stubFetch(async () => new Response('{}'))
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(REVIEW_ARGS).catch((e: unknown) => e)

    expect((error as Error).name).toBe('LockedError')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports a failed OAuth refresh as kind auth and not retryable', async () => {
    await storage.setCredential('p1', {
      kind: 'oauth',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 0,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'c',
    })
    stubFetch(async () => new Response('{}', { status: 400 }))
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(REVIEW_ARGS).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('auth')
    expect((error as ProviderError).retryable).toBe(false)
  })

  it('reports a missing remote credential as kind no-credential', async () => {
    const fetchSpy = stubFetch(async () => new Response('{}'))
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(REVIEW_ARGS).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('no-credential')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still reports an unreachable token endpoint during refresh as a network failure', async () => {
    await storage.setCredential('p1', {
      kind: 'oauth',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 0,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'c',
    })
    stubFetch(async () => {
      throw new TypeError('NetworkError when attempting to fetch resource.')
    })
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(REVIEW_ARGS).catch((e: unknown) => e)

    expect((error as ProviderError).kind).toBe('network')
    expect((error as ProviderError).retryable).toBe(true)
  })

  it('control: an unreachable chat endpoint is still a retryable network failure', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    const fetchSpy = stubFetch(async () => {
      throw new TypeError('NetworkError when attempting to fetch resource.')
    })
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(REVIEW_ARGS).catch((e: unknown) => e)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect((error as ProviderError).kind).toBe('network')
    expect((error as ProviderError).retryable).toBe(true)
  })
})

describe('a response body that is not JSON', () => {
  const okReview = JSON.stringify({
    choices: [{ message: { content: '{"verdict":"match","explanation":""}' } }],
  })

  it('is reported as a bad response naming the cause, not as a raw parse error', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    stubFetch(async () => new Response('<html><body>Sign in to the network</body></html>', { status: 200 }))
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(REVIEW_ARGS).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('bad-response')
    expect((error as ProviderError).message).toMatch(/not JSON/i)
    // The raw parser message must not be what the user sees.
    expect((error as ProviderError).message).not.toMatch(/JSON\.parse|unexpected character/i)
  })

  it('control: a valid JSON body is parsed and returned', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    stubFetch(async () => new Response(okReview, { status: 200 }))
    const adapter = await createOpenAiCompatibleProvider(provider)

    await expect(adapter.review(REVIEW_ARGS)).resolves.toEqual({ verdict: 'match', explanation: '' })
  })
})

describe('a token endpoint that answers with something that is not JSON', () => {
  const stale = {
    kind: 'oauth' as const,
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 0,
    tokenEndpoint: 'https://auth.example.com/token',
    clientId: 'c',
  }

  it('is reported as an auth failure that asks for a reconnect', async () => {
    await storage.setCredential('p1', stale)
    stubFetch(async () => new Response('<html>portal</html>', { status: 200 }))
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(REVIEW_ARGS).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('auth')
  })

  it('control: a valid token response refreshes and the chat request goes out with the new token', async () => {
    await storage.setCredential('p1', stale)
    const spy = stubFetch(async (url) =>
      url.includes('/token')
        ? new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }))
        : new Response(
            JSON.stringify({ choices: [{ message: { content: '{"verdict":"match","explanation":""}' } }] }),
          ),
    )
    const adapter = await createOpenAiCompatibleProvider(provider)

    await adapter.review(REVIEW_ARGS)

    const chat = spy.mock.calls.find(([url]) => url.includes('/chat/completions'))!
    expect((chat[1].headers as Record<string, string>)['Authorization']).toBe('Bearer a2')
  })
})
