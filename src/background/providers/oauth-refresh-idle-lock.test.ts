/**
 * The idle lock firing while a refresh is waiting for the token endpoint. As
 * with a lock by hand, the rotated refresh token has to be stored first.
 */

import { resetBrowserMock } from '../test-support/browser-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '@shared/types'
import * as storage from '../storage'
import { IDLE_ALARM } from '../vault'
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

const PASSPHRASE = 'correct horse battery'
const OK = JSON.stringify({ choices: [{ message: { content: '{"verdict":"match","explanation":""}' } }] })

function slowTokenEndpoint() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let received!: () => void
  const requestSeen = new Promise<void>((resolve) => (received = resolve))
  ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    if (url.includes('/token')) {
      received()
      await gate
      return new Response(JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }))
    }
    return new Response(OK)
  })
  return { release, requestSeen }
}

async function sealedWithExpiredSignIn() {
  await storage.saveCredentialFor(provider, {
    kind: 'oauth',
    accessToken: 'a0',
    refreshToken: 'r0',
    expiresAt: 0,
    tokenEndpoint: 'https://auth.example.com/token',
    clientId: 'c',
  })
  await storage.enableVault(PASSPHRASE)
}

beforeEach(() => {
  resetBrowserMock()
})

describe('the idle lock during a refresh', () => {
  it('waits for the rotated refresh token to be stored, then locks', async () => {
    await sealedWithExpiredSignIn()
    const server = slowTokenEndpoint()
    const adapter = await createOpenAiCompatibleProvider(provider)

    const call = adapter.review({ code: 'x', intent: 'y' })
    await server.requestSeen
    const lock = storage.handleVaultIdleAlarm({ name: IDLE_ALARM })
    server.release()
    await Promise.all([call, lock])

    expect((await storage.vaultState()).unlocked).toBe(false)
    await storage.unlockVault(PASSPHRASE)
    expect(await storage.readStoredCredential('p1')).toMatchObject({ refreshToken: 'r1' })
  })

})
