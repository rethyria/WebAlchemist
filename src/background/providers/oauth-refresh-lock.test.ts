/**
 * A token refresh holds the credential lock for its whole length, from reading
 * the credential to storing the result, so that nothing changed while the
 * token request is waiting is overwritten by it. Runs the real storage and
 * adapter code with `fetch` replaced; no network call is made.
 */

import { localArea, resetBrowserMock } from '../test-support/browser-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '@shared/types'
import * as storage from '../storage'
import { createOpenAiCompatibleProvider } from './openai-compatible'

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

const expired = {
  kind: 'oauth' as const,
  accessToken: 'a0',
  refreshToken: 'r0',
  expiresAt: 0,
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'c',
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

/**
 * A token endpoint that does not answer until `release` is called, and says
 * when it has received the request.
 */
function slowTokenEndpoint() {
  const release = deferred()
  const received = deferred()
  const sent: string[] = []
  ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/token')) {
      sent.push(new URLSearchParams(init.body as URLSearchParams).get('refresh_token')!)
      received.resolve()
      await release.promise
      return new Response(JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }))
    }
    return new Response(OK)
  })
  return { release: release.resolve, received: received.promise, sent }
}

beforeEach(() => {
  resetBrowserMock()
})

describe('a credential changed while a refresh request is waiting', () => {
  it('stays removed when it was removed during the request', async () => {
    await storage.saveCredentialFor(provider, expired)
    const server = slowTokenEndpoint()
    const adapter = await createOpenAiCompatibleProvider(provider)

    const call = adapter.review(ARGS)
    await server.received
    const removal = storage.clearCredential('p1')
    server.release()
    await Promise.allSettled([call, removal])

    expect(await storage.readStoredCredential('p1')).toBeNull()
  })

  it('keeps the credential that was saved during the request, not the refreshed old grant', async () => {
    await storage.saveCredentialFor(provider, expired)
    const server = slowTokenEndpoint()
    const adapter = await createOpenAiCompatibleProvider(provider)

    const call = adapter.review(ARGS)
    await server.received
    const reconnect = storage.saveCredentialFor(provider, { ...expired, accessToken: 'new', refreshToken: 'rNew' })
    server.release()
    await Promise.allSettled([call, reconnect])

    expect(await storage.readStoredCredential('p1')).toMatchObject({ refreshToken: 'rNew' })
  })

  it('drops the result when something that does not use the lock replaced the credential', async () => {
    await storage.saveCredentialFor(provider, expired)
    const server = slowTokenEndpoint()
    const adapter = await createOpenAiCompatibleProvider(provider)

    const call = adapter.review(ARGS)
    await server.received
    // Written straight to storage, as an older version or a future caller
    // that forgot the lock would.
    localArea.raw()['credentials'] = { p1: { ...expired, refreshToken: 'rOther' } }
    server.release()
    await Promise.allSettled([call])

    expect(await storage.readStoredCredential('p1')).toMatchObject({ refreshToken: 'rOther' })
  })

  // The control for the three tests above: with nothing changed during the
  // request, the refreshed credential is stored.
  it('control: an unchanged credential is replaced by the refreshed one', async () => {
    await storage.saveCredentialFor(provider, expired)
    const server = slowTokenEndpoint()
    const adapter = await createOpenAiCompatibleProvider(provider)

    const call = adapter.review(ARGS)
    await server.received
    server.release()
    await call

    expect(await storage.readStoredCredential('p1')).toMatchObject({ refreshToken: 'r1', accessToken: 'a1' })
  })
})
