/**
 * A token endpoint that never answers must not hold the credential lock, and
 * with it every credential change, indefinitely. The timeout is shortened here
 * with a module mock so the test does not wait the real length.
 */

import { resetBrowserMock } from '../test-support/browser-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '@shared/types'

vi.mock('../oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../oauth')>()),
  TOKEN_REQUEST_TIMEOUT_MS: 100,
}))

const storage = await import('../storage')
const { createOpenAiCompatibleProvider } = await import('./openai-compatible')
const { ProviderError } = await import('./types')

const provider = {
  id: 'p1',
  label: 'Remote',
  type: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  generateModel: 'm',
  reviewModel: 'm',
  supportsVision: false,
} as unknown as Provider

beforeEach(() => {
  resetBrowserMock()
})

describe('a token endpoint that does not answer', () => {
  it('fails the call as a network error and lets a queued credential change run', async () => {
    await storage.saveCredentialFor(provider, {
      kind: 'oauth',
      accessToken: 'a0',
      refreshToken: 'r0',
      expiresAt: 0,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'c',
    })
    // Never resolves, and rejects only when the request is aborted.
    let requestSent!: () => void
    const sent = new Promise<void>((resolve) => (requestSent = resolve))
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          requestSent()
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )
    const adapter = await createOpenAiCompatibleProvider(provider)

    const call = adapter.review({ code: 'x', intent: 'y' }).catch((e: unknown) => e)
    // Queued only once the refresh holds the lock and is waiting.
    await sent
    const removal = storage.clearCredential('p1')

    const error = await call
    await removal

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as InstanceType<typeof ProviderError>).kind).toBe('network')
    expect(await storage.readStoredCredential('p1')).toBeNull()
  }, 2000)
})
