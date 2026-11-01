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
  type ProviderEditableField,
  type SettingsChange,
  type TokenUsage,
  type Transform,
  type UsageStore,
} from '@shared/types'
import { NOT_SAVED_USAGE_ID, addCall, addTotals, monthOf } from '@shared/usage'
import {
  LockedError,
  deriveKey,
  IDLE_ALARM,
  forgetKey,
  isSealed,
  randomSalt,
  recallKey,
  rememberKey,
  saltOf,
  seal,
  unseal,
} from './vault'
import { MIN_PASSPHRASE_LENGTH } from '@shared/vault-policy'
import { assertEndpoint, endpointsOf } from '@shared/endpoint-policy'
import { destinationOf, sameBinding } from '@shared/credential-binding'
import type { Provider } from '@shared/types'

const KEY_SETTINGS = 'settings'
const KEY_TRANSFORMS = 'transforms'
const KEY_CREDENTIALS = 'credentials'
const KEY_USAGE = 'usage'
/** Set to true once bindStoredCredentials has finished a pass. */
const KEY_BINDING_PASS = 'credentialBindingPassDone'

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

async function writeSettings(settings: Settings): Promise<void> {
  const idle = settings.vaultIdleLockMinutes
  if (!Number.isInteger(idle) || idle < 0) {
    throw new Error('The vault lock period must be a whole number of minutes, or 0 for never.')
  }
  const previous = (await browser.storage.local.get(KEY_SETTINGS))[KEY_SETTINGS] as
    | Partial<Settings>
    | undefined
  // Checked here and not only in the settings page: this is reached by a
  // message that any extension context can send.
  //
  // Only endpoints that are new or differ from the stored ones are checked.
  // Checking every provider made one stored provider whose endpoint breaks a
  // rule added later (for example a plain http address saved by an older
  // version) fail every settings save, including the switch that stops
  // AI-written JavaScript. An unchanged endpoint is compared against what is
  // stored, not against what the message claims, so this cannot be used to
  // smuggle in a new one. The request paths check the endpoint again before
  // anything is sent.
  const storedEndpoints = new Map<string, string>()
  for (const stored of previous?.providers ?? []) {
    for (const [what, url] of endpointsOf(stored)) storedEndpoints.set(`${stored.id}\n${what}`, url)
  }
  for (const provider of settings.providers) {
    for (const [what, url] of endpointsOf(provider)) {
      if (storedEndpoints.get(`${provider.id}\n${what}`) === url) continue
      assertEndpoint(url, `${what} of ${provider.label}`)
    }
  }
  for (const provider of settings.providers) {
    const price = provider.price
    if (price === undefined) continue
    const valid = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
    if (!valid(price.input) || !valid(price.output)) {
      throw new Error(`The price for ${provider.label} must be two numbers of 0 or more.`)
    }
  }
  await browser.storage.local.set({ [KEY_SETTINGS]: settings })

  // A changed period applies to the vault that is open now, not only to the
  // next unlock. Other settings changes leave the running timer alone, so
  // that picking an accent colour does not count as using the vault.
  const before = previous?.vaultIdleLockMinutes ?? DEFAULT_SETTINGS.vaultIdleLockMinutes
  if (before !== idle && (await recallKey())) await armIdleLock()
}

/**
 * Settings writes run one after another. A change is a read, a change and a
 * write, and two that overlapped would each start from the same stored value
 * so that one of them was lost. Same reasoning as the transform queue.
 */
let settingsQueue: Promise<unknown> = Promise.resolve()

function mutateSettings<T>(work: () => Promise<T>): Promise<T> {
  const result = settingsQueue.then(work, work)
  settingsQueue = result.catch(() => undefined)
  return result
}

/**
 * Replaces the stored settings with the ones given. A caller that holds a copy
 * from when it loaded should use changeSettings, which does not write back
 * fields it did not mean to change.
 */
export function saveSettings(settings: Settings): Promise<void> {
  return mutateSettings(() => writeSettings(settings))
}

const SETTINGS_FIELDS = [
  'activeProviderId',
  'healthCheckMode',
  'accent',
  'keepScreenshotPermission',
  'aiJsKillSwitch',
  'vaultIdleLockMinutes',
] as const satisfies readonly (keyof Settings)[]

const PROVIDER_FIELDS = [
  'generateModel',
  'reviewModel',
  'supportsVision',
  'price',
  'oauth',
] as const satisfies readonly ProviderEditableField[]

const UNSETTABLE_PROVIDER_FIELDS: readonly string[] = ['price', 'oauth']

/**
 * Applies one change to the settings as they are stored now, inside the
 * settings queue, and returns what was saved. Throws when the change is
 * refused, and then writes nothing.
 */
export function changeSettings(change: SettingsChange): Promise<Settings> {
  return mutateSettings(async () => {
    const current = await getSettings()
    let next: Settings
    switch (change.kind) {
      case 'add-provider':
        if (current.providers.some((p) => p.id === change.provider.id)) {
          throw new Error('A provider with that id already exists.')
        }
        next = {
          ...current,
          providers: [...current.providers, change.provider],
          activeProviderId: current.activeProviderId ?? change.provider.id,
        }
        break
      case 'remove-provider': {
        const remaining = current.providers.filter((p) => p.id !== change.providerId)
        next = {
          ...current,
          providers: remaining,
          activeProviderId:
            current.activeProviderId === change.providerId
              ? (remaining[0]?.id ?? null)
              : current.activeProviderId,
        }
        break
      }
      case 'fields': {
        const fields: Record<string, unknown> = {}
        for (const key of SETTINGS_FIELDS) {
          if (key in change.fields) fields[key] = (change.fields as Record<string, unknown>)[key]
        }
        next = { ...current, ...fields }
        if (
          next.activeProviderId !== null &&
          !next.providers.some((p) => p.id === next.activeProviderId)
        ) {
          throw new Error('The active provider must be one that is configured.')
        }
        break
      }
      case 'update-provider': {
        const found = current.providers.find((p) => p.id === change.providerId)
        if (!found) throw new Error('That provider is no longer configured.')
        // Only the listed fields are taken from the message, so a change cannot
        // alter the id, the type or the address of a provider.
        const updated: Provider = { ...found }
        for (const key of PROVIDER_FIELDS) {
          if (change.set && key in change.set) {
            ;(updated as unknown as Record<string, unknown>)[key] = (change.set as Record<string, unknown>)[key]
          }
        }
        // Only the optional fields may be removed. The list comes from a
        // message, and deleting the id, the type, the address or the label
        // would leave a provider that cannot be used or found.
        for (const key of change.unset ?? []) {
          if (!UNSETTABLE_PROVIDER_FIELDS.includes(key)) {
            throw new Error(`The provider field "${String(key)}" cannot be removed.`)
          }
          delete updated[key]
        }
        next = {
          ...current,
          providers: current.providers.map((p) => (p.id === found.id ? updated : p)),
        }
        break
      }
    }
    await writeSettings(next)
    return next
  })
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * Names the first field of a record that code elsewhere would misread, or
 * returns null when the record is usable.
 *
 * Stored records were never validated, so a hand-edited import with no `match`
 * made matchesUrl throw on every navigation, which stopped every site from
 * being restyled (#90). The check covers what would throw or mis-sort when
 * used: the identifying and matching fields, the kind, the sort key, `intent`,
 * and the nested objects whose fields the health check, the content script and
 * the prompt builder read without checking (the anchor's tag, classes, path and
 * selector, the rationale's assumptions).
 *
 * It does not check the contents of `code` or the rationale's text. A record
 * with odd text in those fields fails inside one transform instead of across
 * all of them. The fields it does check have been in the Transform type since
 * the first version, so records from older versions pass.
 */
function firstProblem(value: unknown): string | null {
  if (!isObject(value)) return 'record'
  const { anchor, rationale } = value
  if (typeof value.id !== 'string' || value.id === '') return 'id'
  if (typeof value.name !== 'string') return 'name'
  if (typeof value.enabled !== 'boolean') return 'enabled'
  if (typeof value.order !== 'number' || !Number.isFinite(value.order)) return 'order'
  if (typeof value.match !== 'string') return 'match'
  if (value.kind !== 'css' && value.kind !== 'js') return 'kind'
  if (typeof value.code !== 'string') return 'code'
  if (typeof value.intent !== 'string') return 'intent'
  if (!Array.isArray(value.capabilities)) return 'capabilities'
  if (!isObject(anchor)) return 'anchor'
  if (typeof anchor.selector !== 'string') return 'anchor.selector'
  if (typeof anchor.tag !== 'string') return 'anchor.tag'
  if (typeof anchor.path !== 'string') return 'anchor.path'
  if (!isStringArray(anchor.classes)) return 'anchor.classes'
  if (!isObject(rationale)) return 'rationale'
  if (!isStringArray(rationale.assumptions)) return 'rationale.assumptions'
  return null
}

export function isValidTransform(value: unknown): value is Transform {
  return firstProblem(value) === null
}

/**
 * Throws a message for the sidebar when a record is not usable. A provider
 * that ignores strict structured output can return a transform with a field
 * missing; storing it would answer ok and then hide it, because reads skip
 * invalid records.
 */
export function assertValidTransform(value: unknown): asserts value is Transform {
  const problem = firstProblem(value)
  if (problem !== null) {
    throw new Error(`This transform has no valid "${problem}" field, so it was not saved.`)
  }
}

/**
 * Splits the stored list into records this version can use and everything
 * else, which is kept exactly as stored.
 *
 * Invalid records are not deleted. One may be a hand-edited import that the
 * user means to fix, or a record from a newer version that this version cannot
 * read; discarding it at the next unrelated save would lose it without a word.
 * Every write puts the invalid entries back unchanged (see writeTransforms).
 */
async function readStored(): Promise<{ valid: Transform[]; invalid: unknown[] }> {
  const stored = await browser.storage.local.get(KEY_TRANSFORMS)
  const raw = stored[KEY_TRANSFORMS]
  const list: unknown[] = Array.isArray(raw) ? raw : []
  return {
    valid: list.filter(isValidTransform),
    invalid: list.filter((record) => !isValidTransform(record)),
  }
}

async function writeTransforms(valid: Transform[], invalid: unknown[]): Promise<void> {
  await browser.storage.local.set({ [KEY_TRANSFORMS]: [...valid, ...invalid] })
}

/**
 * Reads the transform list, leaving out records that fail isValidTransform.
 *
 * Skipping rather than throwing is deliberate: this runs on every navigation,
 * and an error here would disable every other transform for the sake of one.
 * The skipped records stay in storage; see readStored.
 */
export async function getAllTransforms(): Promise<Transform[]> {
  const { valid } = await readStored()
  return valid.sort((a, b) => a.order - b.order)
}

/** How many stored records are skipped on read, for the interface to report. */
export async function countSkippedTransforms(): Promise<number> {
  return (await readStored()).invalid.length
}

/**
 * The tail of the chain of transform mutations. Each mutation waits for the one
 * before it, so a read-modify-write never starts while another is between its
 * read and its write.
 *
 * The transform list is stored as one array, so every change reads the whole
 * array and writes the whole array back. Two handlers running at once both read
 * the same array and the second write discards the first (#84). A lock inside
 * the browser's storage was not an option, since storage.local has no
 * transactions; ordering the calls in this module is the available fix. It
 * covers only this background script, which is the only context that calls
 * these functions.
 *
 * Reads stay outside the queue: a read sees either the state before a write or
 * after it, never a partial one, so it has nothing to wait for.
 */
let transformQueue: Promise<unknown> = Promise.resolve()

function mutateTransforms<T>(work: () => Promise<T>): Promise<T> {
  // A failed mutation must not stop the ones behind it, so the chain continues
  // from the outcome of the previous call whether it succeeded or not.
  const result = transformQueue.then(work, work)
  transformQueue = result.catch(() => undefined)
  return result
}

/**
 * Stores a transform, replacing the record with the same id when there is one.
 *
 * When it replaces a record, the stored `order`, `enabled` and `createdAt` are
 * kept and the caller's values for them are ignored. The sidebar and the editor
 * send a copy of the record from when they loaded it, and nothing refreshes
 * that copy, so a save from either one carried the old order after a reorder
 * and the old enabled flag after a toggle, and undid both (#85). Only
 * `reorderTransforms` and `updateTransform` change those fields. Returns the
 * record as stored, which is what callers should register or apply.
 */
export function saveTransform(transform: Transform): Promise<Transform> {
  return mutateTransforms(async () => {
    const { valid: all, invalid } = await readStored()
    const index = all.findIndex((t) => t.id === transform.id)
    const existing = index === -1 ? undefined : all[index]
    const next = {
      ...transform,
      ...(existing && {
        order: existing.order,
        enabled: existing.enabled,
        createdAt: existing.createdAt,
      }),
      updatedAt: Date.now(),
    }
    assertValidTransform(next)
    if (index === -1) all.push(next)
    else all[index] = next
    await writeTransforms(all, invalid)
    return next
  })
}

/**
 * Changes some fields of one stored transform. The read, the change and the
 * write all happen inside the queue.
 *
 * A caller that reads the transform with getAllTransforms and then calls
 * saveTransform with a changed copy does the read outside the queue. A save
 * that runs between the two is then overwritten by the copy, which still holds
 * the old values of every field the caller did not mean to change. That is how
 * the enable toggle lost a concurrent save of the same transform. Returns the
 * stored record, or null when no transform has that id.
 */
export function updateTransform(
  id: string,
  patch: Partial<Omit<Transform, 'id'>>,
): Promise<Transform | null> {
  return mutateTransforms(async () => {
    const { valid: all, invalid } = await readStored()
    const index = all.findIndex((t) => t.id === id)
    if (index === -1) return null
    const next = { ...all[index]!, ...patch, id, updatedAt: Date.now() }
    assertValidTransform(next)
    all[index] = next
    await writeTransforms(all, invalid)
    return next
  })
}

export async function deleteTransform(id: string): Promise<void> {
  await mutateTransforms(async () => {
    const { valid: all, invalid } = await readStored()
    await writeTransforms(
      all.filter((t) => t.id !== id),
      invalid,
    )
  })
  // The transform is gone, so its usage would otherwise stay in the store
  // forever with no name to show. The provider totals by month keep the cost.
  // The delete has already happened, so a failure here is not reported as a
  // failed delete; the entry is removed by the next start-up sweep instead.
  await pruneTransformUsage(id).catch(() => undefined)
}

/** Persists a new ordering. Order decides which transform wins a conflict. */
export function reorderTransforms(orderedIds: string[]): Promise<void> {
  return mutateTransforms(async () => {
    const { valid: all, invalid } = await readStored()
    const position = new Map(orderedIds.map((id, index) => [id, index]))
    const next = all.map((t) => ({ ...t, order: position.get(t.id) ?? t.order }))
    await writeTransforms(next, invalid)
  })
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
async function readCredentialMap(touch = false): Promise<CredentialMap> {
  const stored = await browser.storage.local.get(KEY_CREDENTIALS)
  const value = stored[KEY_CREDENTIALS]
  if (value === undefined) return {}
  if (!isSealed(value)) return value as CredentialMap

  const key = await recallKey()
  if (!key) throw new LockedError()
  const map = JSON.parse(await unseal(key, value)) as CredentialMap
  if (touch) await armIdleLock()
  return map
}

/**
 * Starts, or restarts, the countdown to the idle lock.
 *
 * An alarm rather than a timer in the page or a `setTimeout`: the background
 * is an event page that the browser stops when it is idle, and a timer stops
 * with it, so the vault would stay unlocked. A named alarm survives the page
 * being stopped and wakes it, and creating one with the same name replaces
 * the earlier one, which is what makes each use restart the countdown.
 *
 * Restarted only by provider calls, so that opening settings or the sidebar,
 * which read credential statuses, does not keep an unattended vault open.
 */
async function armIdleLock(): Promise<void> {
  const minutes = (await getSettings()).vaultIdleLockMinutes
  if (minutes > 0) await browser.alarms.create(IDLE_ALARM, { delayInMinutes: minutes })
  else await browser.alarms.clear(IDLE_ALARM)
}

/** Handles an alarm from the browser; the background registers this at start. */
export async function handleVaultIdleAlarm(alarm: { name: string }): Promise<void> {
  if (alarm.name !== IDLE_ALARM) return
  await lockVault()
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

/**
 * Runs credential read-modify-write steps one at a time.
 *
 * Every change to the credential map reads it, edits it and writes it back, and
 * each of those is an await. Two changes that overlap both read the same
 * starting map and the later write discards the earlier one. That is how a
 * rotated OAuth refresh token was lost when the vault was being enabled, and it
 * also happens between two plain writes, such as two providers refreshing at
 * once.
 *
 * Local to the credential map on purpose. Transform writes have the same
 * problem and get their own queue; sharing one would make a credential write
 * wait behind an unrelated transform write for no reason.
 *
 * A failed step must not stop the queue, so the chain continues from the
 * settled result and the caller still receives its own rejection.
 */
let credentialQueue: Promise<unknown> = Promise.resolve()

function withCredentialLock<T>(step: () => Promise<T>): Promise<T> {
  const run = credentialQueue.then(step, step)
  credentialQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Whether credentials are stored sealed, and whether they can be read now. */
export async function vaultState(): Promise<{ sealed: boolean; unlocked: boolean }> {
  const stored = await browser.storage.local.get(KEY_CREDENTIALS)
  const sealedNow = isSealed(stored[KEY_CREDENTIALS])
  if (!sealedNow) return { sealed: false, unlocked: true }
  return { sealed: true, unlocked: (await recallKey()) !== null }
}

const ALREADY_SEALED =
  'The credentials are already protected by a passphrase. Remove that passphrase first to set a different one.'

/**
 * Turns passphrase mode on, sealing whatever is already stored.
 *
 * The key is remembered for this session immediately, so enabling does not
 * lock the user out of the thing they just set up.
 */
export async function enableVault(passphrase: string): Promise<void> {
  // Checked here as well as in the settings page: this function is reached by
  // a message that any extension context can send, and the page's check is
  // only a convenience for the person typing.
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`)
  }

  // Refused rather than ignored. Returning silently here let the settings page
  // show a sealed vault as unencrypted, accept a new passphrase, and discard
  // it, so the person believed a passphrase was in force that had never been
  // applied. Checked before deriving so the refusal is immediate.
  if (isSealed((await browser.storage.local.get(KEY_CREDENTIALS))[KEY_CREDENTIALS])) {
    throw new Error(ALREADY_SEALED)
  }

  // The key is derived before the credential map is read, and the read, seal
  // and write then happen inside the lock. Derivation takes several hundred
  // milliseconds, and reading the map first meant sealing a copy that was
  // already out of date by the time it was written.
  const salt = randomSalt()
  const key = await deriveKey(passphrase, salt)

  await withCredentialLock(async () => {
    const stored = await browser.storage.local.get(KEY_CREDENTIALS)
    // Checked again: another enable may have finished during the derivation.
    if (isSealed(stored[KEY_CREDENTIALS])) throw new Error(ALREADY_SEALED)

    const map = (stored[KEY_CREDENTIALS] as CredentialMap | undefined) ?? {}
    await browser.storage.local.set({
      [KEY_CREDENTIALS]: await seal(key, salt, JSON.stringify(map)),
    })
    // Still inside the lock: a write queued behind this one must find the key
    // in the session, or it would fail as locked.
    await rememberKey(key)
    await armIdleLock()
  })
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
  await unseal(key, existing)

  // The map is read again inside the lock, because a write may have landed
  // during the derivation and the copy decrypted above would not include it.
  await withCredentialLock(async () => {
    const latest = (await browser.storage.local.get(KEY_CREDENTIALS))[KEY_CREDENTIALS]
    if (!isSealed(latest)) return
    const map = JSON.parse(await unseal(key, latest)) as CredentialMap
    await browser.storage.local.set({ [KEY_CREDENTIALS]: map })
    await forgetKey()
  })
}

/**
 * Derives and remembers the key for this browser session.
 *
 * Returns the message of a failed binding pass, or null. The pass runs after
 * the vault is open, so its failure is not a failed unlock: throwing it made
 * the caller report the unlock as failed while the vault was unlocked. The pass
 * runs again at the next unlock, and until it has recorded that it ran, reads
 * still bind unbound keys.
 */
export async function unlockVault(passphrase: string): Promise<{ bindingError: string | null }> {
  const stored = await browser.storage.local.get(KEY_CREDENTIALS)
  const existing = stored[KEY_CREDENTIALS]
  if (!isSealed(existing)) return { bindingError: null }

  const key = await deriveKey(passphrase, saltOf(existing))
  // Decrypt once before remembering, so a wrong passphrase is refused here
  // rather than accepted and then failing on the next generation.
  await unseal(key, existing)
  await rememberKey(key)
  await armIdleLock()
  // The first moment the map can be written after an upgrade, so this is where
  // keys stored before bindings existed are bound; see bindStoredCredentials.
  try {
    await bindStoredCredentials()
    return { bindingError: null }
  } catch (error) {
    // Only the message is kept. It never holds a credential.
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error('Binding stored credentials failed:', message)
    return { bindingError: message }
  }
}

/**
 * Through the credential lock, so a lock waits for a refresh that is in
 * progress. A provider that rotates refresh tokens has already invalidated the
 * old one when its response arrives; forgetting the key before the new one is
 * stored makes that write fail as locked, and the sign-in is lost.
 */
export async function lockVault(): Promise<void> {
  await withCredentialLock(() => forgetKey())
}

/**
 * The only way out of a forgotten passphrase.
 *
 * There is no recovery — that is the property being bought. Discarding the
 * credentials and starting over is the honest alternative to pretending
 * otherwise, and it is destructive enough that the UI asks twice.
 *
 * Allowed only when the credentials are sealed and locked, the one state a
 * forgotten passphrase produces. Without this check the message deleted
 * plaintext keys when the page's view of the vault was wrong, and deleted
 * readable keys from an unlocked vault, where "Remove the passphrase" is the
 * path that keeps them.
 */
export async function discardVault(): Promise<void> {
  await withCredentialLock(async () => {
    const state = await vaultState()
    if (!state.sealed || state.unlocked) {
      throw new Error('Stored credentials can be discarded only while they are sealed and locked.')
    }
    await browser.storage.local.remove(KEY_CREDENTIALS)
    await forgetKey()
  })
}

/** A stored credential was entered for a different destination than the provider's current one. */
export class CredentialOriginError extends Error {
  constructor(label: string, entered: string | null, current: string | null) {
    super(
      current === null
        ? `The key for ${label} cannot be used because the provider has no valid address. Fix the address in settings and enter the key again.`
        : entered === null
          ? `The key for ${label} has no recorded address, so it was not sent. Enter it again in settings.`
          : `The key for ${label} was entered for ${entered}, but the provider now sends requests to ${current}. The key was not sent. Enter it again in settings.`,
    )
    this.name = 'CredentialOriginError'
  }
}

/**
 * Reads a credential for use in an outbound request, and only if it was
 * entered for the destination this provider currently has. This must never be
 * exposed over the message channel — callers outside the background script get
 * getCredentialStatus() instead.
 *
 * Credentials are keyed by provider id, and an id survives an edit of the base
 * URL or the type. Without this comparison, such an edit sent the stored key to
 * the new address. The refusal is an error rather than a null so that it cannot
 * fall through to the unauthenticated path that loopback providers use.
 *
 * Migration: credentials written before binding existed carry no `boundTo`.
 * bindStoredCredentials binds them in one pass when the extension is updated,
 * or when a sealed vault is first unlocked afterwards, and records that the
 * pass has run. Until it has run, a read still binds an unbound credential to
 * the provider's destination at that moment and saves it, which trusts the
 * current settings. After it has run, an unbound credential is refused, because
 * the pass skipped it for a reason (its provider was removed or had no valid
 * address) and binding it now would attach it to whatever address the settings
 * hold at some later time.
 */
export async function readCredentialForRequest(provider: Provider): Promise<Credential | null> {
  const found = (await readCredentialMap(true))[provider.id]
  if (!found) return null
  if (found.boundTo) return checkedForProvider(provider, found, true)

  return withCredentialLock(async () => {
    const map = await readCredentialMap()
    const current = map[provider.id]
    if (!current) return null
    const passDone = await bindingPassDone()
    const checked = checkedForProvider(provider, current, passDone)
    if (!current.boundTo) {
      map[provider.id] = checked
      await writeCredentialMap(map)
    }
    return checked
  })
}

/** Whether bindStoredCredentials has finished a pass. */
async function bindingPassDone(): Promise<boolean> {
  return (await browser.storage.local.get(KEY_BINDING_PASS))[KEY_BINDING_PASS] === true
}

/**
 * Returns the credential bound to the provider's destination, or throws when
 * the binding names another destination. A credential with no binding is bound
 * to the destination while the binding pass has not run, and refused once it
 * has. Does not write; the caller stores the bound copy when it has a reason to.
 */
function checkedForProvider(
  provider: Provider,
  credential: Credential,
  passDone: boolean,
): Credential {
  const destination = destinationOf(provider)
  const refusedUnbound = passDone && !credential.boundTo
  const bound = credential.boundTo ?? destination ?? undefined
  if (!destination || !bound || refusedUnbound || !sameBinding(bound, destination)) {
    throw new CredentialOriginError(
      provider.label,
      credential.boundTo?.origin ?? null,
      destination?.origin ?? null,
    )
  }
  return credential.boundTo ? credential : { ...credential, boundTo: destination }
}

/**
 * Binds every stored credential that has no binding to its provider's current
 * destination, in one pass, and records that the pass has run.
 *
 * Without this a key stored before bindings existed was bound by whichever
 * request read it first, which could be months after the upgrade and after the
 * base URL had been edited, so the key was bound to an address it was never
 * entered for. Doing it once, at the first point the extension runs after the
 * upgrade (a plaintext store) or the first point the sealed map can be written
 * (unlock), keeps that window short. A credential whose provider has been
 * removed, or has no valid address, is left unbound. Once the pass has run,
 * reads refuse an unbound credential instead of binding it (see
 * readCredentialForRequest). The record is written only when the pass finishes,
 * so a pass that throws, for example on a locked vault, runs again later.
 * Throws LockedError for a sealed vault that is locked.
 */
export async function bindStoredCredentials(): Promise<void> {
  await withCredentialLock(async () => {
    const map = await readCredentialMap()
    const providers = (await getSettings()).providers
    let changed = false
    for (const [providerId, credential] of Object.entries(map)) {
      if (credential.boundTo) continue
      const provider = providers.find((p) => p.id === providerId)
      const destination = provider ? destinationOf(provider) : null
      if (!destination) continue
      map[providerId] = { ...credential, boundTo: destination }
      changed = true
    }
    if (changed) await writeCredentialMap(map)
    await browser.storage.local.set({ [KEY_BINDING_PASS]: true })
  })
}

/**
 * Runs `step` with the provider's credential while holding the credential lock,
 * and gives it a function that stores a replacement.
 *
 * For a refresh, which has to read the credential, wait for the token endpoint
 * and store what comes back as one operation. Done in three separate steps, a
 * credential removed or reconnected while the request was waiting was
 * overwritten by the old grant's refreshed copy. Holding the lock means a
 * removal or reconnection waits until the refresh has stored its token, and
 * then applies on top of it. The cost is that those changes wait as long as
 * the request does, which is why the request has a timeout.
 *
 * The store function writes only if the stored credential is still the same
 * sign-in (same refresh token and token endpoint) as the one the step was
 * given, and returns whether it did. The lock already prevents a change by any
 * code that takes it; this covers a write that does not.
 *
 * Inside `step`, do not call a function that takes the lock itself, such as
 * setCredential, because it would wait for this step to finish.
 */
export function withCredentialForRequest<T>(
  provider: Provider,
  step: (
    credential: Credential | null,
    store: (replacement: Credential) => Promise<boolean>,
  ) => Promise<T>,
): Promise<T> {
  return withCredentialLock(async () => {
    const found = (await readCredentialMap())[provider.id]
    const passDone = await bindingPassDone()
    const credential = found ? checkedForProvider(provider, found, passDone) : null
    const store = async (replacement: Credential): Promise<boolean> => {
      const map = await readCredentialMap()
      const current = map[provider.id]
      if (!credential || !current || !sameSignIn(current, credential)) return false
      map[provider.id] = replacement
      await writeCredentialMap(map)
      return true
    }
    return step(credential, store)
  })
}

function sameSignIn(a: Credential, b: Credential): boolean {
  return (
    a.kind === 'oauth' &&
    b.kind === 'oauth' &&
    a.refreshToken === b.refreshToken &&
    a.tokenEndpoint === b.tokenEndpoint
  )
}

/**
 * Reads a stored credential without checking where it would be sent. For code
 * that needs to inspect or copy a credential, such as tests; never use the
 * result to build a request.
 */
export async function readStoredCredential(providerId: string): Promise<Credential | null> {
  return (await readCredentialMap())[providerId] ?? null
}

/**
 * Saves a credential bound to the provider's current destination. A binding
 * supplied by the caller is replaced, since the sender of a message is not the
 * authority on where the key was entered.
 */
export async function saveCredentialFor(provider: Provider, credential: Credential): Promise<void> {
  const boundTo = destinationOf(provider)
  if (!boundTo) throw new Error(`${provider.label} has no valid address to bind the key to.`)
  await setCredential(provider.id, { ...credential, boundTo })
}

export async function setCredential(
  providerId: string,
  credential: Credential,
): Promise<void> {
  // The refresh token is sent to this address on every refresh, so it is
  // checked where the credential is saved as well as where it is used.
  if (credential.kind === 'oauth') assertEndpoint(credential.tokenEndpoint, 'token endpoint')
  await withCredentialLock(async () => {
    const map = await readCredentialMap()
    map[providerId] = credential
    await writeCredentialMap(map)
  })
}

export async function clearCredential(providerId: string): Promise<void> {
  await withCredentialLock(async () => {
    const map = await readCredentialMap()
    delete map[providerId]
    await writeCredentialMap(map)
  })
}

function oauthStatus(
  providerId: string,
  credential: Extract<Credential, { kind: 'oauth' }>,
): CredentialStatus {
  return {
    providerId,
    configured: true,
    kind: 'oauth',
    ...(credential.expiresAt !== undefined ? { expiresAt: credential.expiresAt } : {}),
    renewable: Boolean(credential.refreshToken),
  }
}

/**
 * True when requests would refuse this credential because of where it was
 * entered. Before the binding pass has run, a credential with no binding is
 * not a mismatch, because a read binds it, so reporting it would flag every
 * key stored before binding existed. After the pass it is refused, and is
 * reported. Uses the same comparison as the request path so the two cannot
 * disagree.
 */
function refusedForProvider(
  provider: Provider | undefined,
  credential: Credential,
  passDone: boolean,
): boolean {
  if (!provider) return false
  try {
    checkedForProvider(provider, credential, passDone)
    return false
  } catch (error) {
    if (error instanceof CredentialOriginError) return true
    throw error
  }
}

function statusFor(
  providerId: string,
  provider: Provider | undefined,
  credential: Credential | undefined,
  passDone: boolean,
): CredentialStatus {
  if (!credential) return { providerId, configured: false }
  const base: CredentialStatus =
    credential.kind === 'oauth'
      ? oauthStatus(providerId, credential)
      : { providerId, configured: true, kind: 'api_key' }
  return refusedForProvider(provider, credential, passDone) ? { ...base, needsReentry: true } : base
}

/** The only credential shape any other context is allowed to see. */
export async function getCredentialStatus(providerId: string): Promise<CredentialStatus> {
  const credential = (await readCredentialMap())[providerId]
  const provider = credential
    ? (await getSettings()).providers.find((p) => p.id === providerId)
    : undefined
  return statusFor(providerId, provider, credential, await bindingPassDone())
}

export async function getAllCredentialStatuses(): Promise<CredentialStatus[]> {
  const map = await readCredentialMap()
  const settings = await getSettings()
  const passDone = await bindingPassDone()
  return settings.providers.map((provider) =>
    statusFor(provider.id, provider, map[provider.id], passDone),
  )
}

/* ------------------------------------------------------------------ */
/* Usage                                                               */
/* ------------------------------------------------------------------ */

/**
 * Calls to recordUsage run one after another. Each is a read, an add and a
 * write of the whole store, and a review that finishes while a generation is
 * being recorded would otherwise read the same starting value and one of the
 * two additions would be lost.
 */
let usageQueue: Promise<unknown> = Promise.resolve()

export async function getUsage(): Promise<UsageStore> {
  const stored = (await browser.storage.local.get(KEY_USAGE))[KEY_USAGE] as
    | Partial<UsageStore>
    | undefined
  return { months: stored?.months ?? {}, transforms: stored?.transforms ?? {} }
}

/**
 * Adds one call to the provider's total for the month and, when the call
 * belongs to a transform, to that transform's total. A call whose response had
 * no usage block still counts as a call, so "not reported" is visible in the
 * totals and is not turned into zero tokens.
 */
export function recordUsage(call: {
  providerId: string
  transformId?: string
  usage: TokenUsage | null
  costUsd: number | null
  at?: number
}): Promise<void> {
  return mutateUsage(async () => {
    const store = await getUsage()
    const month = monthOf(call.at ?? Date.now())
    const byProvider = (store.months[month] ??= {})
    byProvider[call.providerId] = addCall(byProvider[call.providerId], call.usage, call.costUsd)
    if (call.transformId) {
      store.transforms[call.transformId] = addCall(
        store.transforms[call.transformId],
        call.usage,
        call.costUsd,
      )
    }
    await browser.storage.local.set({ [KEY_USAGE]: store })
  })
}

function mutateUsage<T>(work: () => Promise<T>): Promise<T> {
  const next = usageQueue.then(work, work)
  usageQueue = next.catch(() => undefined)
  return next
}

/**
 * Removes one transform's usage entry. Called when the transform is deleted.
 * Runs in the usage queue so it does not overlap a recording.
 */
export function pruneTransformUsage(transformId: string): Promise<void> {
  return mutateUsage(async () => {
    const store = await getUsage()
    if (!(transformId in store.transforms)) return
    delete store.transforms[transformId]
    await browser.storage.local.set({ [KEY_USAGE]: store })
  })
}

/**
 * Moves the usage of every id that is not a saved transform into the single
 * "not saved" entry.
 *
 * A draft gets its id before it is saved, and its model calls are recorded
 * under that id. A draft that is then discarded leaves an entry that nothing
 * else removes, one for each discarded draft. Nothing tells the background
 * that a draft was discarded, so this runs when the browser starts and when
 * the extension is installed or updated, when no sidebar can be holding a
 * draft that is still being worked on. Running it while the sidebar is open
 * would move the cost of a draft that has not been saved yet. Records that are
 * stored but fail validation still count as saved, so their usage is kept.
 */
export function foldUnsavedUsage(): Promise<void> {
  return mutateUsage(async () => {
    const stored = (await browser.storage.local.get(KEY_TRANSFORMS))[KEY_TRANSFORMS]
    const kept = new Set<string>([NOT_SAVED_USAGE_ID])
    for (const record of Array.isArray(stored) ? stored : []) {
      const id = (record as { id?: unknown } | null)?.id
      if (typeof id === 'string') kept.add(id)
    }
    const store = await getUsage()
    let changed = false
    for (const [id, totals] of Object.entries(store.transforms)) {
      if (kept.has(id)) continue
      store.transforms[NOT_SAVED_USAGE_ID] = addTotals(store.transforms[NOT_SAVED_USAGE_ID], totals)
      delete store.transforms[id]
      changed = true
    }
    if (changed) await browser.storage.local.set({ [KEY_USAGE]: store })
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

export interface ImportResult {
  imported: number
  /** Records left out because they failed isValidTransform. */
  skipped: number
  needsRegeneration: string[]
}

/**
 * Imports a bundle. JS transforms arrive without code — a shared JS transform
 * carries only intent and anchor, and the importer's own model regenerates the
 * implementation locally under their own review and capability gates. CSS
 * arrives with code intact, since CSS cannot exfiltrate anything.
 */
export function importTransforms(bundle: ExportBundle): Promise<ImportResult> {
  return mutateTransforms(() => importTransformsNow(bundle))
}

async function importTransformsNow(bundle: ExportBundle): Promise<ImportResult> {
  // `undefined > SCHEMA_VERSION` is false, so a file with no version used to
  // pass the check below. A missing or non-numeric version means the file is
  // not one of ours, or was cut short.
  if (
    !isObject(bundle) ||
    typeof bundle.schemaVersion !== 'number' ||
    !Array.isArray(bundle.transforms)
  ) {
    throw new Error('This file is not a Web Alchemist export.')
  }
  if (bundle.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `This file was made by a newer version of Web Alchemist (schema ${bundle.schemaVersion}). Update the extension to import it.`,
    )
  }

  const { valid: existing, invalid } = await readStored()
  const needsRegeneration: string[] = []
  let nextOrder = existing.length

  let skipped = 0

  for (const incoming of bundle.transforms) {
    if (!isValidTransform(incoming)) {
      skipped++
      continue
    }
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

  await writeTransforms(existing, invalid)
  return { imported: bundle.transforms.length - skipped, skipped, needsRegeneration }
}
