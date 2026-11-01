/**
 * A sign-in replaced by an API key while a call is starting. The call should
 * use the key, as a call made a moment later would, and not fail as if the
 * credential had been removed.
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
const KEY = { kind: 'api_key' as const, value: 'sk-new' }

const oauth = (over: object = {}) => ({
  kind: 'oauth' as const,
  accessToken: 'a0',
  refreshToken: 'r0',
  expiresAt: 0,
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'c',
  ...over,
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

/**
 * Makes the next read of the credential map return the data as it is now, but
 * only after `release` is called. The mock takes its snapshot when `get` is
 * called, so the caller receives a copy that later writes do not change.
 */
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
  return {
    release,
    restore: () => {
      localArea.get = original
    },
  }
}

let restore: () => void = () => undefined

beforeEach(() => {
  resetBrowserMock()
})
afterEach(() => restore())

describe('a sign-in replaced by an API key', () => {
  it('uses the key when the replacement happens before the refresh starts', async () => {
    await storage.saveCredentialFor(provider, oauth())
    const hold = holdNextCredentialRead()
    restore = hold.restore
    const bearers: string[] = []
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      bearers.push(String((init.headers as Record<string, string>)['Authorization']))
      return new Response(OK)
    })
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchSpy
    const adapter = await createOpenAiCompatibleProvider(provider)

    const call = adapter.review(ARGS)
    await tick()
    await storage.saveCredentialFor(provider, KEY)
    hold.release()

    await expect(call).resolves.toEqual({ verdict: 'match', explanation: '' })
    expect(bearers).toEqual(['Bearer sk-new'])
  })

  it('uses the key when the replacement happens after the server answered 401', async () => {
    await storage.saveCredentialFor(provider, oauth({ expiresAt: Date.now() + 3_600_000 }))
    const bearers: string[] = []
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const bearer = String((init.headers as Record<string, string>)['Authorization'])
      bearers.push(bearer)
      if (bearer === 'Bearer a0') {
        await storage.saveCredentialFor(provider, KEY)
        return new Response('{}', { status: 401 })
      }
      return new Response(OK)
    })
    const adapter = await createOpenAiCompatibleProvider(provider)

    await expect(adapter.review(ARGS)).resolves.toEqual({ verdict: 'match', explanation: '' })
    expect(bearers).toEqual(['Bearer a0', 'Bearer sk-new'])
  })

  // The control: a credential that is really gone is still reported as gone.
  it('control: a removed credential is still reported as removed', async () => {
    await storage.saveCredentialFor(provider, oauth())
    const hold = holdNextCredentialRead()
    restore = hold.restore
    const fetchSpy = vi.fn(async () => new Response(OK))
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchSpy
    const adapter = await createOpenAiCompatibleProvider(provider)

    const call = adapter.review(ARGS).catch((e: unknown) => e)
    await tick()
    await storage.clearCredential('p1')
    hold.release()

    expect(((await call) as Error).message).toMatch(/removed/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
