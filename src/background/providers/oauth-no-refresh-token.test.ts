/**
 * Sign-in with a provider that issues no refresh token. Runs the real storage
 * and adapter code with `fetch` replaced; no network call is made.
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

const OK = JSON.stringify({ choices: [{ message: { content: '{"verdict":"match","explanation":""}' } }] })
const ARGS = { code: 'x', intent: 'y' }

const base = {
  kind: 'oauth' as const,
  accessToken: 'tok',
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'c',
}

function stubFetch(status = 200) {
  const spy = vi.fn(async (_url: string, _init: RequestInit) =>
    status === 200 ? new Response(OK) : new Response('{}', { status }),
  )
  ;(globalThis as unknown as { fetch: unknown }).fetch = spy
  return spy
}

const tokenRequests = (spy: ReturnType<typeof stubFetch>) =>
  spy.mock.calls.filter(([url]) => url.includes('/token')).length

beforeEach(() => {
  resetBrowserMock()
})

describe('a sign-in with no refresh token', () => {
  it('sends the access token while it is valid', async () => {
    await storage.saveCredentialFor(provider, { ...base, expiresAt: Date.now() + 3_600_000 })
    const spy = stubFetch()
    const adapter = await createOpenAiCompatibleProvider(provider)

    await adapter.review(ARGS)

    expect((spy.mock.calls[0]![1].headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('sends the access token when its expiry is unknown', async () => {
    await storage.saveCredentialFor(provider, base)
    const spy = stubFetch()
    const adapter = await createOpenAiCompatibleProvider(provider)

    await adapter.review(ARGS)

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reports an expired token as a sign-in to repeat, and sends no request', async () => {
    await storage.saveCredentialFor(provider, { ...base, expiresAt: Date.now() - 1000 })
    const spy = stubFetch()
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(ARGS).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('auth')
    expect((error as ProviderError).retryable).toBe(false)
    expect((error as ProviderError).message).toMatch(/Sign in again/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('reports a 401 the same way and sends no token request', async () => {
    await storage.saveCredentialFor(provider, base)
    const spy = stubFetch(401)
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(ARGS).catch((e: unknown) => e)

    expect((error as ProviderError).kind).toBe('auth')
    expect((error as ProviderError).message).toMatch(/Sign in again/)
    expect(tokenRequests(spy)).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('shows in the credential status that it cannot be renewed', async () => {
    await storage.saveCredentialFor(provider, base)
    expect(await storage.getCredentialStatus('p1')).toMatchObject({ kind: 'oauth', renewable: false })
  })
})

describe('a token with no refresh token that ends within the refresh margin', () => {
  it('is still used, because it has not ended', async () => {
    await storage.saveCredentialFor(provider, { ...base, expiresAt: Date.now() + 30_000 })
    const spy = stubFetch()
    const adapter = await createOpenAiCompatibleProvider(provider)

    await expect(adapter.review(ARGS)).resolves.toBeDefined()

    expect(spy).toHaveBeenCalledTimes(1)
  })

  // Control: the same expiry with a refresh token is renewed ahead of time.
  it('control: the same expiry with a refresh token is refreshed first', async () => {
    await storage.saveCredentialFor(provider, { ...base, refreshToken: 'r', expiresAt: Date.now() + 30_000 })
    const spy = vi.fn(async (url: string) =>
      url.includes('/token')
        ? new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }))
        : new Response(OK),
    )
    ;(globalThis as unknown as { fetch: unknown }).fetch = spy
    await (await createOpenAiCompatibleProvider(provider)).review(ARGS)

    expect(spy.mock.calls.filter(([url]) => url.includes('/token'))).toHaveLength(1)
  })
})

describe('controls', () => {
  it('an expired token that has a refresh token is still refreshed', async () => {
    await storage.saveCredentialFor(provider, { ...base, refreshToken: 'r', expiresAt: Date.now() - 1000 })
    const spy = vi.fn(async (url: string) =>
      url.includes('/token')
        ? new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }))
        : new Response(OK),
    )
    ;(globalThis as unknown as { fetch: unknown }).fetch = spy
    const adapter = await createOpenAiCompatibleProvider(provider)

    await adapter.review(ARGS)

    expect(spy.mock.calls.filter(([url]) => url.includes('/token'))).toHaveLength(1)
    expect(await storage.getCredentialStatus('p1')).toMatchObject({ renewable: true })
  })
})
