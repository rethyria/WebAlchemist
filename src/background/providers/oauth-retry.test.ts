/**
 * A 401 on a sign-in token causes one refresh and one retry. Runs the real
 * storage and adapter code with `fetch` replaced; no network call is made.
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

/** Not near expiry by the clock, so any refresh is caused by a 401. */
const live = {
  kind: 'oauth' as const,
  accessToken: 'dead',
  refreshToken: 'r0',
  expiresAt: Date.now() + 60 * 60 * 1000,
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'c',
}

/**
 * A provider that accepts only the newest token it issued. `current` starts as
 * the token the credential holds, which the server has already revoked.
 */
function server(options: { acceptNew?: boolean } = {}) {
  const acceptNew = options.acceptNew ?? true
  const state = { tokenRequests: 0, chatTokens: [] as string[], issued: 0 }
  const spy = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/token')) {
      state.tokenRequests += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      state.issued += 1
      return new Response(
        JSON.stringify({ access_token: `fresh${state.issued}`, refresh_token: `r${state.issued}`, expires_in: 3600 }),
      )
    }
    const bearer = (init.headers as Record<string, string>)['Authorization'] ?? ''
    state.chatTokens.push(bearer.replace('Bearer ', ''))
    return bearer.startsWith('Bearer fresh') && acceptNew
      ? new Response(OK)
      : new Response('{}', { status: 401 })
  })
  ;(globalThis as unknown as { fetch: unknown }).fetch = spy
  return state
}

beforeEach(() => {
  resetBrowserMock()
})

describe('a 401 on a sign-in token', () => {
  it('refreshes once, retries once with the new token, and succeeds', async () => {
    await storage.saveCredentialFor(provider, live)
    const state = server()
    const adapter = await createOpenAiCompatibleProvider(provider)

    await expect(adapter.review(ARGS)).resolves.toEqual({ verdict: 'match', explanation: '' })

    expect(state.tokenRequests).toBe(1)
    expect(state.chatTokens).toEqual(['dead', 'fresh1'])
    expect(await storage.readStoredCredential('p1')).toMatchObject({ accessToken: 'fresh1', refreshToken: 'r1' })
  })

  it('is reported as rejected only when the retried request also gets 401, and does not loop', async () => {
    await storage.saveCredentialFor(provider, live)
    const state = server({ acceptNew: false })
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(ARGS).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('auth')
    expect((error as ProviderError).message).toMatch(/rejected the credential/)
    expect(state.tokenRequests).toBe(1)
    expect(state.chatTokens).toHaveLength(2)
  })

  it('causes one token request for two overlapping calls that both got the same 401', async () => {
    await storage.saveCredentialFor(provider, live)
    const state = server()
    const adapter = await createOpenAiCompatibleProvider(provider)

    const results = await Promise.allSettled([adapter.review(ARGS), adapter.review(ARGS)])

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(state.tokenRequests).toBe(1)
  })

  it('reports a failed refresh as a sign-in that expired', async () => {
    await storage.saveCredentialFor(provider, live)
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) =>
      url.includes('/token') ? new Response('{}', { status: 400 }) : new Response('{}', { status: 401 }),
    )
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(ARGS).catch((e: unknown) => e)

    expect((error as ProviderError).kind).toBe('auth')
    expect((error as ProviderError).message).toMatch(/expired/i)
  })
})

describe('controls', () => {
  it('a token the server accepts causes no refresh', async () => {
    await storage.saveCredentialFor(provider, { ...live, accessToken: 'fresh0' })
    const state = server()
    const adapter = await createOpenAiCompatibleProvider(provider)

    await adapter.review(ARGS)

    expect(state.tokenRequests).toBe(0)
    expect(state.chatTokens).toEqual(['fresh0'])
  })

  it('a 401 on an API key is reported at once, with no refresh and no retry', async () => {
    await storage.saveCredentialFor(provider, { kind: 'api_key', value: 'sk-x' })
    const spy = vi.fn(async () => new Response('{}', { status: 401 }))
    ;(globalThis as unknown as { fetch: unknown }).fetch = spy
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(ARGS).catch((e: unknown) => e)

    expect((error as ProviderError).kind).toBe('auth')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('a 403 on a sign-in token is not retried', async () => {
    await storage.saveCredentialFor(provider, live)
    const spy = vi.fn(async () => new Response('{}', { status: 403 }))
    ;(globalThis as unknown as { fetch: unknown }).fetch = spy
    const adapter = await createOpenAiCompatibleProvider(provider)

    const error = await adapter.review(ARGS).catch((e: unknown) => e)

    expect((error as ProviderError).kind).toBe('auth')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
