/**
 * Locking the vault while a refresh is waiting for the token endpoint. The
 * provider has already replaced the old refresh token by the time its response
 * arrives, so the new one has to be stored before the key is forgotten, or it
 * is lost and the sign-in cannot be renewed.
 */

import { resetBrowserMock } from '../test-support/browser-mock'
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

describe('locking during a refresh', () => {
  it('waits for the rotated refresh token to be stored, then locks', async () => {
    await sealedWithExpiredSignIn()
    const server = slowTokenEndpoint()
    const adapter = await createOpenAiCompatibleProvider(provider)

    const call = adapter.review({ code: 'x', intent: 'y' })
    await server.requestSeen
    const lock = storage.lockVault()
    server.release()
    await Promise.all([call, lock])

    expect((await storage.vaultState()).unlocked).toBe(false)
    await storage.unlockVault(PASSPHRASE)
    expect(await storage.readStoredCredential('p1')).toMatchObject({ refreshToken: 'r1' })
  })

  // The control: with no refresh running, locking takes effect and the stored
  // credential is untouched, so the tests above are about the overlap.
  it('control: locking with no refresh running locks and keeps the credential', async () => {
    await sealedWithExpiredSignIn()

    await storage.lockVault()

    expect((await storage.vaultState()).unlocked).toBe(false)
    await storage.unlockVault(PASSPHRASE)
    expect(await storage.readStoredCredential('p1')).toMatchObject({ refreshToken: 'r0' })
  })
})
