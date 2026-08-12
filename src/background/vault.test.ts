/**
 * The cryptography, on its own.
 *
 * The live run in `test/crypto/vault-probe.mjs` exercises the whole path
 * through a real browser. What it could not establish is the at-rest claim, for
 * reasons written up in `test/crypto/README.md` — so the properties that make
 * the design sound are pinned here, where they can be checked exactly.
 */

import { describe, expect, it } from 'vitest'
import { deriveKey, isSealed, randomSalt, saltOf, seal, unseal } from './vault'

const PASSPHRASE = 'correct horse battery staple'

/*
 * PBKDF2 at 600,000 iterations costs a few hundred milliseconds per call, which
 * is the point of it. Derived once and shared, so the suite does not spend
 * thirty seconds proving the same derivation repeatedly.
 */
const salt = randomSalt()
const key = await deriveKey(PASSPHRASE, salt)

describe('sealing', () => {
  it('round-trips a value', async () => {
    const sealed = await seal(key, salt, '{"a":{"kind":"api_key","value":"sk-test"}}')
    expect(await unseal(key, sealed)).toBe('{"a":{"kind":"api_key","value":"sk-test"}}')
  })

  it('does not leave the plaintext in the sealed value', async () => {
    const sealed = await seal(key, salt, 'sk-SECRET-CANARY')
    expect(JSON.stringify(sealed)).not.toContain('sk-SECRET-CANARY')
    // The control: base64 of the plaintext would also fail the check above
    // while being trivially reversible, so check the encoded form too.
    expect(sealed.data).not.toContain(btoa('sk-SECRET-CANARY').replace(/=+$/, ''))
  })

  it('uses a fresh IV every time, so the same value never encrypts alike', async () => {
    const many = await Promise.all(Array.from({ length: 8 }, () => seal(key, salt, 'same')))
    expect(new Set(many.map((s) => s.iv)).size).toBe(8)
    expect(new Set(many.map((s) => s.data)).size).toBe(8)
  })

  it('is recognisable as sealed, and a plain map is not', () => {
    expect(isSealed({ sealed: true, salt: '', iv: '', data: '' })).toBe(true)
    expect(isSealed({ 'provider-1': { kind: 'api_key', value: 'sk' } })).toBe(false)
    expect(isSealed(undefined)).toBe(false)
    expect(isSealed(null)).toBe(false)
  })

  it('carries the salt, so unlocking needs only the passphrase', async () => {
    const sealed = await seal(key, salt, 'x')
    expect([...saltOf(sealed)]).toEqual([...salt])
  })
})

describe('the wrong passphrase', () => {
  /*
   * The property the unlock step is built on. AES-GCM authenticates, so a wrong
   * key fails the tag check rather than producing plausible garbage — which is
   * what lets a passphrase be verified without storing anything to compare it
   * against. If this ever became a silent success, unlock would accept anything
   * and the failure would surface later as corrupted credentials.
   */
  it('fails rather than returning nonsense', async () => {
    const sealed = await seal(key, salt, 'secret')
    const wrong = await deriveKey('not the passphrase', salt)
    await expect(unseal(wrong, sealed)).rejects.toThrow()
  })

  it('fails when the salt differs, even with the same passphrase', async () => {
    const sealed = await seal(key, salt, 'secret')
    const otherSalt = randomSalt()
    const otherKey = await deriveKey(PASSPHRASE, otherSalt)
    await expect(unseal(otherKey, sealed)).rejects.toThrow()
  })

  it('fails when the ciphertext is altered', async () => {
    const sealed = await seal(key, salt, 'secret')
    const flipped = { ...sealed, data: `${sealed.data.slice(0, -4)}AAAA` }
    await expect(unseal(key, flipped)).rejects.toThrow()
  })

  /* The control: the same operations with the right key must succeed, or the
   * three rejections above would pass against a function that always threw. */
  it('succeeds with the right key and untouched ciphertext', async () => {
    const sealed = await seal(key, salt, 'secret')
    await expect(unseal(key, sealed)).resolves.toBe('secret')
  })
})

describe('salts', () => {
  it('differ between vaults', () => {
    const many = Array.from({ length: 16 }, () => randomSalt().join(','))
    expect(new Set(many).size).toBe(16)
  })

  it('are long enough to make a precomputed table useless', () => {
    expect(randomSalt().length).toBeGreaterThanOrEqual(16)
  })
})
