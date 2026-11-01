/**
 * The vault's behaviour at the storage layer, run against the real storage and
 * vault code on an in-memory browser.storage. Each PBKDF2 derivation takes a
 * few hundred milliseconds, which is why the tests here are few.
 */

import { localArea, resetBrowserMock } from './test-support/browser-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIN_PASSPHRASE_LENGTH } from '@shared/vault-policy'
import * as storage from './storage'
import { isSealed } from './vault'

beforeEach(() => {
  resetBrowserMock()
})

describe('the passphrase minimum', () => {
  it.each(['', 'short', 'x'.repeat(MIN_PASSPHRASE_LENGTH - 1)])(
    'is enforced by the background: %j is refused and nothing is sealed',
    async (passphrase) => {
      await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })

      await expect(storage.enableVault(passphrase)).rejects.toThrow(/at least/)

      expect(isSealed(localArea.raw()['credentials'])).toBe(false)
      expect((await storage.vaultState()).sealed).toBe(false)
    },
  )

  // The control: a passphrase of exactly the minimum length must be accepted,
  // or the refusals above would pass against a function that always threw.
  it('control: a passphrase of exactly the minimum length seals the vault', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })

    await storage.enableVault('x'.repeat(MIN_PASSPHRASE_LENGTH))

    expect(isSealed(localArea.raw()['credentials'])).toBe(true)
    expect((await storage.readCredentialForRequest('p1'))?.kind).toBe('api_key')
  })
})

describe('credential writes during enabling', () => {
  const PASSPHRASE = 'correct horse battery'

  it('keeps a credential written while the key is being derived', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'old' })

    await Promise.all([
      storage.enableVault(PASSPHRASE),
      storage.setCredential('p2', { kind: 'api_key', value: 'new' }),
    ])

    expect(isSealed(localArea.raw()['credentials'])).toBe(true)
    expect(await storage.readCredentialForRequest('p1')).toMatchObject({ value: 'old' })
    expect(await storage.readCredentialForRequest('p2')).toMatchObject({ value: 'new' })
  })

  it('keeps a rotated OAuth token written while the vault is being enabled', async () => {
    const oauth = (refreshToken: string) =>
      ({
        kind: 'oauth',
        accessToken: 'a',
        refreshToken,
        expiresAt: 0,
        tokenEndpoint: 'https://auth.example.com/token',
        clientId: 'c',
      }) as const
    await storage.setCredential('p1', oauth('r0'))

    await Promise.all([storage.enableVault(PASSPHRASE), storage.setCredential('p1', oauth('r1'))])

    expect(await storage.readCredentialForRequest('p1')).toMatchObject({ refreshToken: 'r1' })
  })

  it('keeps every write when several overlap without any vault', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) => storage.setCredential(id, { kind: 'api_key', value: id })),
    )

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(await storage.readCredentialForRequest(id)).toMatchObject({ value: id })
    }
  })

  // The control: the same writes issued one after another are kept both
  // before and after the fix, so the failures above come from the overlap and
  // not from the mock or the assertions.
  it('control: the same writes made one after another are all kept', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'old' })
    await storage.enableVault(PASSPHRASE)
    await storage.setCredential('p2', { kind: 'api_key', value: 'new' })

    expect(await storage.readCredentialForRequest('p1')).toMatchObject({ value: 'old' })
    expect(await storage.readCredentialForRequest('p2')).toMatchObject({ value: 'new' })
  })
})
