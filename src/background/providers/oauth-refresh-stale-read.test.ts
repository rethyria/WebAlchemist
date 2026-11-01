/**
 * A caller whose read of the credential is older than a refresh that has since
 * finished must not refresh again. Providers rotate refresh tokens, so sending
 * the one the first refresh spent is rejected, and a provider that follows RFC
 * 9700 section 4.14.2 revokes the whole grant when it sees a spent token.
 */

import { localArea, resetBrowserMock } from '../test-support/browser-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

/** As in oauth-replaced-by-key.test.ts: the caller gets a snapshot, late. */
function holdNextCredentialRead() {
  const original = localArea.get
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let held = false
  localArea.get = async (keys?: string | string[]) => {
    const result = await original.call(localArea, keys)
    if (!held && keys === 'credentials') {
      held = true
      await gate
    }
    return result
  }
  return { release, restore: () => void (localArea.get = original) }
}

let restore: () => void = () => undefined

beforeEach(() => {
  resetBrowserMock()
})
afterEach(() => restore())

describe('a caller holding an out-of-date copy of the credential', () => {
  it('uses the token another caller already refreshed, and sends no second refresh', async () => {
    await storage.saveCredentialFor(provider, {
      kind: 'oauth',
      accessToken: 'a0',
      refreshToken: 'r0',
      expiresAt: 0,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'c',
    })
    const refreshTokensSent: string[] = []
    const bearers: string[] = []
    // Accepts only the newest refresh token, as a rotating provider does.
    let current = 0
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/token')) {
        const sent = new URLSearchParams(init.body as URLSearchParams).get('refresh_token')!
        refreshTokensSent.push(sent)
        if (sent !== `r${current}`) return new Response('{"error":"invalid_grant"}', { status: 400 })
        current += 1
        return new Response(
          JSON.stringify({ access_token: `a${current}`, refresh_token: `r${current}`, expires_in: 3600 }),
        )
      }
      bearers.push(String((init.headers as Record<string, string>)['Authorization']))
      return new Response(OK)
    })
    const adapter = await createOpenAiCompatibleProvider(provider)

    // Caller A reads the credential (expired, refresh token r0) and is held.
    const hold = holdNextCredentialRead()
    restore = hold.restore
    const callA = adapter.review(ARGS)
    await tick()

    // Caller B runs to the end: it refreshes r0 to r1 and sends its request.
    await adapter.review(ARGS)
    expect(refreshTokensSent).toEqual(['r0'])

    // Caller A now continues with its copy from before B's refresh.
    hold.release()
    await expect(callA).resolves.toEqual({ verdict: 'match', explanation: '' })

    expect(refreshTokensSent).toEqual(['r0'])
    expect(bearers).toEqual(['Bearer a1', 'Bearer a1'])
  })

  // The control: a caller whose copy is not out of date, on a credential that
  // is not near expiry, sends no refresh at all.
  it('control: a current copy of a valid credential causes no refresh', async () => {
    await storage.saveCredentialFor(provider, {
      kind: 'oauth',
      accessToken: 'a0',
      refreshToken: 'r0',
      expiresAt: Date.now() + 3_600_000,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'c',
    })
    const spy = vi.fn(async () => new Response(OK))
    ;(globalThis as unknown as { fetch: unknown }).fetch = spy
    const adapter = await createOpenAiCompatibleProvider(provider)

    await adapter.review(ARGS)

    expect(spy).toHaveBeenCalledTimes(1)
  })
})
