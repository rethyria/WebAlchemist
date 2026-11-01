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
    expect((await storage.readStoredCredential('p1'))?.kind).toBe('api_key')
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
    expect(await storage.readStoredCredential('p1')).toMatchObject({ value: 'old' })
    expect(await storage.readStoredCredential('p2')).toMatchObject({ value: 'new' })
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

    expect(await storage.readStoredCredential('p1')).toMatchObject({ refreshToken: 'r1' })
  })

  it('keeps every write when several overlap without any vault', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) => storage.setCredential(id, { kind: 'api_key', value: id })),
    )

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(await storage.readStoredCredential(id)).toMatchObject({ value: id })
    }
  })

  // The control: the same writes issued one after another are kept both
  // before and after the fix, so the failures above come from the overlap and
  // not from the mock or the assertions.
  it('control: the same writes made one after another are all kept', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'old' })
    await storage.enableVault(PASSPHRASE)
    await storage.setCredential('p2', { kind: 'api_key', value: 'new' })

    expect(await storage.readStoredCredential('p1')).toMatchObject({ value: 'old' })
    expect(await storage.readStoredCredential('p2')).toMatchObject({ value: 'new' })
  })
})

describe('enabling a vault that is already sealed', () => {
  const FIRST = 'correct horse battery'

  it('throws and leaves the sealed data and the unlock state unchanged', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    await storage.enableVault(FIRST)
    await storage.lockVault()
    const before = structuredClone(localArea.raw()['credentials'])

    await expect(storage.enableVault('a different passphrase')).rejects.toThrow(/already/i)

    expect(localArea.raw()['credentials']).toEqual(before)
    expect(await storage.vaultState()).toEqual({ sealed: true, unlocked: false })
  })

  it('control: the original passphrase still unlocks after the refused change', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    await storage.enableVault(FIRST)
    await storage.lockVault()
    await storage.enableVault('a different passphrase').catch(() => undefined)

    await storage.unlockVault(FIRST)

    expect(await storage.readStoredCredential('p1')).toMatchObject({ value: 'sk-x' })
  })
})

describe('discarding the stored credentials', () => {
  const PASSPHRASE = 'correct horse battery'

  it('refuses when the credentials are not sealed, so plain keys are not deleted', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })

    await expect(storage.discardVault()).rejects.toThrow(/locked/i)

    expect(await storage.readStoredCredential('p1')).toMatchObject({ value: 'sk-x' })
  })

  it('refuses while the vault is unlocked, because the passphrase is then known', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    await storage.enableVault(PASSPHRASE)

    await expect(storage.discardVault()).rejects.toThrow(/locked/i)

    expect(await storage.readStoredCredential('p1')).toMatchObject({ value: 'sk-x' })
  })

  // The control: from the one state it exists for, sealed and locked, discard
  // must work, or the refusals above would pass against a function that
  // always threw.
  it('control: discards when the vault is sealed and locked', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    await storage.enableVault(PASSPHRASE)
    await storage.lockVault()

    await storage.discardVault()

    expect(await storage.vaultState()).toEqual({ sealed: false, unlocked: true })
    expect(await storage.readStoredCredential('p1')).toBeNull()
  })
})
