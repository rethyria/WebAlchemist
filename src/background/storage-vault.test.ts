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
