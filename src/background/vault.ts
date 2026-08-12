/**
 * Optional passphrase encryption for stored credentials.
 *
 * ## Why this shape and not the one #46 proposed first
 *
 * #46's first proposal was a non-extractable `CryptoKey` in IndexedDB with the
 * ciphertext in `storage.local`. That was measured before it was built, which
 * is what #46 asked for, and it does not work: Firefox writes the key material
 * into the profile's IndexedDB file in the clear, so the decryption key would
 * sit beside the ciphertext it decrypts, under the same file permissions. See
 * `test/crypto/README.md` — the measurement is direct, using a key imported
 * from known bytes with `extractable: false`.
 *
 * `extractable: false` stops *JavaScript* reading the key. It does not stop
 * anything reading the profile, and the profile is the threat #46 is about.
 *
 * That leaves a passphrase-derived key as the only design that survives:
 * nothing on disk decrypts without something only the user knows.
 *
 * ## Why it is usable, which it normally would not be
 *
 * The obvious objection is the unlock step. The MV3 background is an event page
 * torn down whenever it goes idle, so a derived key cannot live in a module
 * variable — and re-deriving after every teardown means a prompt every few
 * minutes, which nobody would accept.
 *
 * `storage.session` is the way out, and it was measured too
 * (`test/crypto/session-probe.mjs`): a value written there was not found
 * anywhere in the 3823 files of the profile, while the same string written to
 * `storage.local` was found immediately. So the derived key survives background
 * teardown without being written down, and the user unlocks once per browser
 * session rather than once per request.
 *
 * ## What this does not protect against
 *
 * Code running in an extension context while unlocked, which can simply ask for
 * the plaintext. #45 establishes that exposure and it is unchanged here. This
 * protects a profile at rest, and nothing more.
 *
 * ## Off by default
 *
 * A forgotten passphrase means the stored credentials are gone, and there is no
 * recovery that does not reintroduce the problem. That is a real cost, and it
 * is the user's to accept rather than ours to impose.
 */

/**
 * OWASP's floor for PBKDF2-HMAC-SHA256 is 600,000 iterations. It costs a few
 * hundred milliseconds once per browser session, which is the right place to
 * spend time — an attacker with the profile gets the same cost per guess.
 */
const ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12

const SESSION_KEY = 'waVaultKey'

/** What `storage.local` holds instead of the plaintext, when this is on. */
export interface Sealed {
  /** Marks the value as ciphertext rather than a credential map. */
  sealed: true
  salt: string
  iv: string
  data: string
}

export function isSealed(value: unknown): value is Sealed {
  return typeof value === 'object' && value !== null && (value as Sealed).sealed === true
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  return salt
}

/**
 * PBKDF2 → AES-GCM.
 *
 * Marked extractable because the derived bytes have to be handed to
 * `storage.session`, and W1 established that non-extractability buys nothing at
 * rest anyway. Here it would buy nothing at all: the value it protects is the
 * passphrase-derived key, and the thing it would protect it from is the
 * memory-only store it needs to live in.
 */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function seal(key: CryptoKey, salt: Uint8Array, plaintext: string): Promise<Sealed> {
  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { sealed: true, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }
}

/**
 * Throws on a wrong passphrase rather than returning nonsense.
 *
 * AES-GCM authenticates, so a wrong key fails the tag check instead of
 * producing plausible-looking garbage. That is the property that lets the
 * unlock step verify a passphrase without storing anything to compare against.
 */
export async function unseal(key: CryptoKey, sealed: Sealed): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv) as BufferSource },
    key,
    fromBase64(sealed.data) as BufferSource,
  )
  return new TextDecoder().decode(plaintext)
}

/* ------------------------------------------------------------------ */
/* The session-held key                                                */
/* ------------------------------------------------------------------ */

/**
 * Remembers the derived key for as long as the browser is open.
 *
 * Raw bytes rather than the `CryptoKey` itself: `storage.session` structured-
 * clones, a `CryptoKey` is cloneable, and storing one would work — but it would
 * also be the one place in this file where what is stored cannot be inspected
 * or reasoned about from the value alone. The bytes are equivalent in every way
 * that matters, since the store is memory-only either way.
 */
export async function rememberKey(key: CryptoKey): Promise<void> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  await browser.storage.session.set({ [SESSION_KEY]: toBase64(raw) })
}

export async function recallKey(): Promise<CryptoKey | null> {
  const stored = await browser.storage.session.get(SESSION_KEY)
  const raw = stored[SESSION_KEY] as string | undefined
  if (!raw) return null
  return crypto.subtle.importKey('raw', fromBase64(raw) as BufferSource, 'AES-GCM', true, [
    'encrypt',
    'decrypt',
  ])
}

export async function forgetKey(): Promise<void> {
  await browser.storage.session.remove(SESSION_KEY)
}

export function saltOf(sealed: Sealed): Uint8Array {
  return fromBase64(sealed.salt)
}

/** Raised when credentials are sealed and no key is in the session. */
export class LockedError extends Error {
  constructor() {
    super('Web Alchemist is locked. Enter your passphrase in settings to unlock it.')
    this.name = 'LockedError'
  }
}
