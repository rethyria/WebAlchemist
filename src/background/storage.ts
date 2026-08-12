/**
 * Persistence. Runs in the background script only.
 *
 * storage.sync is deliberately unused: Firefox caps it at roughly 100KB total
 * with per-item limits, and transforms carry anchor snapshots plus generated
 * code. Portability is served by explicit JSON export/import instead.
 *
 * CREDENTIALS — WHAT THIS DOES AND DOES NOT GUARANTEE
 * ---------------------------------------------------
 * Credentials live under their own storage key, never inside settings, and no
 * message returns one. The sidebar can set a credential, clear it, and ask
 * whether one is configured; it has no way to ask for the value.
 *
 * That is a discipline, NOT a boundary, and the difference matters.
 * storage.local is shared by every context in the extension, so any of our own
 * pages could call browser.storage.local.get('credentials') and read the key in
 * plaintext. This was verified against a running Firefox rather than assumed.
 * WebExtensions offers no partitioned storage that would make it otherwise.
 *
 * What the discipline buys is real but narrower than it looks: the value never
 * travels over message passing, never lands in a component's state, and cannot
 * be logged or rendered by accident, because no UI code ever holds it. It
 * rules out the mistakes we would otherwise make. It does not stop code that
 * goes looking.
 *
 * The outer limit is lower still. Browser extensions have no equivalent of
 * Electron's safeStorage or an OS keychain, so by default storage.local is
 * plaintext in the profile directory, protected by file permissions and nothing
 * else. The settings UI says so rather than implying protection we are not
 * providing.
 *
 * Passphrase mode changes the last paragraph and only the last paragraph. When
 * it is on, what sits in the profile is AES-GCM ciphertext and nothing on disk
 * decrypts it — see vault.ts, including the measurements that ruled out the
 * design #46 proposed first. It changes nothing above: an extension page can
 * still read the plaintext while unlocked, because it can ask this module for
 * it. The two paragraphs describe different attackers.
 */

import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type Credential,
  type CredentialStatus,
  type Settings,
  type Transform,
} from '@shared/types'
import {
  LockedError,
  deriveKey,
  forgetKey,
  isSealed,
  randomSalt,
  recallKey,
  rememberKey,
  saltOf,
  seal,
  unseal,
} from './vault'

const KEY_SETTINGS = 'settings'
const KEY_TRANSFORMS = 'transforms'
const KEY_CREDENTIALS = 'credentials'

type CredentialMap = Record<string, Credential>

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY_SETTINGS)
  const raw = stored[KEY_SETTINGS] as Partial<Settings> | undefined
  if (!raw) return { ...DEFAULT_SETTINGS }
  return migrateSettings(raw)
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEY_SETTINGS]: settings })
}

function migrateSettings(raw: Partial<Settings>): Settings {
  // Only one schema version exists so far. Future migrations chain from here,
  // each one bumping schemaVersion, so a stale profile upgrades in order.
  const merged: Settings = { ...DEFAULT_SETTINGS, ...raw, schemaVersion: SCHEMA_VERSION }
  return merged
}

/* ------------------------------------------------------------------ */
/* Transforms                                                          */
/* ------------------------------------------------------------------ */

export async function getAllTransforms(): Promise<Transform[]> {
  const stored = await browser.storage.local.get(KEY_TRANSFORMS)
  const list = (stored[KEY_TRANSFORMS] as Transform[] | undefined) ?? []
  return list.sort((a, b) => a.order - b.order)
}

export async function saveTransform(transform: Transform): Promise<void> {
  const all = await getAllTransforms()
  const index = all.findIndex((t) => t.id === transform.id)
  const next = { ...transform, updatedAt: Date.now() }
  if (index === -1) all.push(next)
  else all[index] = next
  await browser.storage.local.set({ [KEY_TRANSFORMS]: all })
}

export async function deleteTransform(id: string): Promise<void> {
  const all = await getAllTransforms()
  await browser.storage.local.set({
    [KEY_TRANSFORMS]: all.filter((t) => t.id !== id),
  })
}

/** Persists a new ordering. Order decides which transform wins a conflict. */
export async function reorderTransforms(orderedIds: string[]): Promise<void> {
  const all = await getAllTransforms()
  const position = new Map(orderedIds.map((id, index) => [id, index]))
  const next = all.map((t) => ({ ...t, order: position.get(t.id) ?? t.order }))
  await browser.storage.local.set({ [KEY_TRANSFORMS]: next })
}

/* ------------------------------------------------------------------ */
/* Credentials — background-only                                       */
/* ------------------------------------------------------------------ */

/**
 * Reads the credential map, decrypting it when passphrase mode is on.
 *
 * The stored value is either a plain map or a `Sealed` blob, and which it is
 * decides everything — so the mode is read from the data rather than from a
 * settings flag. A flag can disagree with the bytes; the bytes cannot disagree
 * with themselves.
 */
async function readCredentialMap(): Promise<CredentialMap> {
  const stored = await browser.storage.local.get(KEY_CREDENTIALS)
  const value = stored[KEY_CREDENTIALS]
  if (value === undefined) return {}
  if (!isSealed(value)) return value as CredentialMap

  const key = await recallKey()
  if (!key) throw new LockedError()
  return JSON.parse(await unseal(key, value)) as CredentialMap
}

/** Writes the map back in whichever form it is currently kept. */
async function writeCredentialMap(map: CredentialMap): Promise<void> {
  const stored = await browser.storage.local.get(KEY_CREDENTIALS)
  const existing = stored[KEY_CREDENTIALS]

  if (!isSealed(existing)) {
    await browser.storage.local.set({ [KEY_CREDENTIALS]: map })
    return
  }

  const key = await recallKey()
  if (!key) throw new LockedError()
  await browser.storage.local.set({
    [KEY_CREDENTIALS]: await seal(key, saltOf(existing), JSON.stringify(map)),
  })
}

/** Whether credentials are stored sealed, and whether they can be read now. */
export async function vaultState(): Promise<{ sealed: boolean; unlocked: boolean }> {
  const stored = await browser.storage.local.get(KEY_CREDENTIALS)
  const sealedNow = isSealed(stored[KEY_CREDENTIALS])
  if (!sealedNow) return { sealed: false, unlocked: true }
  return { sealed: true, unlocked: (await recallKey()) !== null }
}

/**
 * Turns passphrase mode on, sealing whatever is already stored.
 *
 * The key is remembered for this session immediately, so enabling does not
 * lock the user out of the thing they just set up.
 */
export async function enableVault(passphrase: string): Promise<void> {
  const stored = await browser.storage.local.get(KEY_CREDENTIALS)
  if (isSealed(stored[KEY_CREDENTIALS])) return

  const map = (stored[KEY_CREDENTIALS] as CredentialMap | undefined) ?? {}
  const salt = randomSalt()
  const key = await deriveKey(passphrase, salt)
  await browser.storage.local.set({ [KEY_CREDENTIALS]: await seal(key, salt, JSON.stringify(map)) })
  await rememberKey(key)
}

/**
 * Turns it off, writing the credentials back as plaintext.
 *
 * Requires the passphrase rather than the session key. Someone walking up to an
 * unlocked browser should not be able to strip the protection without knowing
 * what set it — and since a wrong passphrase fails the AES-GCM tag check, this
 * verifies without anything to compare against.
 */
export async function disableVault(passphrase: string): Promise<void> {
  const stored = await browser.storage.local.get(KEY_CREDENTIALS)
  const existing = stored[KEY_CREDENTIALS]
  if (!isSealed(existing)) return

  const key = await deriveKey(passphrase, saltOf(existing))
  const map = JSON.parse(await unseal(key, existing)) as CredentialMap
  await browser.storage.local.set({ [KEY_CREDENTIALS]: map })
  await forgetKey()
}

/** Derives and remembers the key for this browser session. */
export async function unlockVault(passphrase: string): Promise<void> {
  const stored = await browser.storage.local.get(KEY_CREDENTIALS)
  const existing = stored[KEY_CREDENTIALS]
  if (!isSealed(existing)) return

  const key = await deriveKey(passphrase, saltOf(existing))
  // Decrypt once before remembering, so a wrong passphrase is refused here
  // rather than accepted and then failing on the next generation.
  await unseal(key, existing)
  await rememberKey(key)
}

export async function lockVault(): Promise<void> {
  await forgetKey()
}

/**
 * The only way out of a forgotten passphrase.
 *
 * There is no recovery — that is the property being bought. Discarding the
 * credentials and starting over is the honest alternative to pretending
 * otherwise, and it is destructive enough that the UI asks twice.
 */
export async function discardVault(): Promise<void> {
  await browser.storage.local.remove(KEY_CREDENTIALS)
  await forgetKey()
}

/**
 * Reads a credential for use in an outbound request. This must never be
 * exposed over the message channel — callers outside the background script get
 * getCredentialStatus() instead.
 */
export async function readCredentialForRequest(
  providerId: string,
): Promise<Credential | null> {
  const map = await readCredentialMap()
  return map[providerId] ?? null
}

export async function setCredential(
  providerId: string,
  credential: Credential,
): Promise<void> {
  const map = await readCredentialMap()
  map[providerId] = credential
  await writeCredentialMap(map)
}

export async function clearCredential(providerId: string): Promise<void> {
  const map = await readCredentialMap()
  delete map[providerId]
  await writeCredentialMap(map)
}

/** The only credential shape any other context is allowed to see. */
export async function getCredentialStatus(
  providerId: string,
): Promise<CredentialStatus> {
  const credential = (await readCredentialMap())[providerId]
  if (!credential) return { providerId, configured: false }
  return credential.kind === 'oauth'
    ? { providerId, configured: true, kind: 'oauth', expiresAt: credential.expiresAt }
    : { providerId, configured: true, kind: 'api_key' }
}

export async function getAllCredentialStatuses(): Promise<CredentialStatus[]> {
  const map = await readCredentialMap()
  const settings = await getSettings()
  return settings.providers.map((provider) => {
    const credential = map[provider.id]
    if (!credential) return { providerId: provider.id, configured: false }
    return credential.kind === 'oauth'
      ? {
          providerId: provider.id,
          configured: true,
          kind: 'oauth' as const,
          expiresAt: credential.expiresAt,
        }
      : { providerId: provider.id, configured: true, kind: 'api_key' as const }
  })
}

/* ------------------------------------------------------------------ */
/* Export / import                                                     */
/* ------------------------------------------------------------------ */

export interface ExportBundle {
  schemaVersion: number
  exportedAt: number
  transforms: Transform[]
}

/** Credentials and provider config are never included in an export. */
export async function exportTransforms(): Promise<ExportBundle> {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    transforms: await getAllTransforms(),
  }
}

/**
 * Imports a bundle. JS transforms arrive without code — a shared JS transform
 * carries only intent and anchor, and the importer's own model regenerates the
 * implementation locally under their own review and capability gates. CSS
 * arrives with code intact, since CSS cannot exfiltrate anything.
 */
export async function importTransforms(bundle: ExportBundle): Promise<{
  imported: number
  needsRegeneration: string[]
}> {
  if (bundle.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `This file was made by a newer version of Web Alchemist (schema ${bundle.schemaVersion}). Update the extension to import it.`,
    )
  }

  const existing = await getAllTransforms()
  const needsRegeneration: string[] = []
  let nextOrder = existing.length

  for (const incoming of bundle.transforms) {
    const transform: Transform = {
      ...incoming,
      id: crypto.randomUUID(),
      order: nextOrder++,
      updatedAt: Date.now(),
    }

    if (transform.kind === 'js') {
      // Never import third-party JavaScript. Strip it and mark for local
      // regeneration from the intent.
      transform.code = ''
      transform.enabled = false
      needsRegeneration.push(transform.id)
    }

    existing.push(transform)
  }

  await browser.storage.local.set({ [KEY_TRANSFORMS]: existing })
  return { imported: bundle.transforms.length, needsRegeneration }
}
