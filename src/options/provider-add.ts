import type { CredentialStatus, Provider, Settings } from '@shared/types'

type Call = <T>(message: { type: string; [field: string]: unknown }) => Promise<T>

/**
 * Stores a key and then refreshes the statuses.
 *
 * Only a failure of `set-credential` is an error. When the key is stored and
 * the status read fails afterwards, for example because another tab locked the
 * vault in between, the key is still saved. Reporting that as a failed save made
 * the caller roll back the provider and left an orphaned key. Returns null in
 * that case, and the page keeps the statuses it already has.
 */
export async function storeKey(
  call: Call,
  providerId: string,
  key: string,
): Promise<CredentialStatus[] | null> {
  await call({
    type: 'set-credential',
    providerId,
    credential: { kind: 'api_key', value: key },
  })
  try {
    return await call<CredentialStatus[]>({ type: 'get-credential-statuses' })
  } catch {
    return null
  }
}

/** The settings with one provider removed and the active choice repaired. */
export function withoutProvider(settings: Settings, providerId: string): Settings {
  const remaining = settings.providers.filter((p) => p.id !== providerId)
  return {
    ...settings,
    providers: remaining,
    activeProviderId:
      settings.activeProviderId === providerId
        ? (remaining[0]?.id ?? null)
        : settings.activeProviderId,
  }
}

/**
 * Saves a new provider and then its key, and takes the provider back out if
 * the key cannot be stored.
 *
 * The provider goes first because the background binds a key to the saved
 * provider's address and refuses a key for one it does not know. The rollback
 * removes only this provider from the settings as they are now, read again,
 * and does not write back the snapshot from before the add. Another page may
 * have saved a change in between, such as the switch that stops AI-written
 * JavaScript, and writing the old snapshot would undo it.
 */
export async function addProviderWithKey(
  deps: {
    current: () => Settings
    readSettings: () => Promise<Settings>
    save: (settings: Settings) => Promise<void>
    setKey: (providerId: string, key: string) => Promise<void>
  },
  provider: Provider,
  key: string,
): Promise<void> {
  const settings = deps.current()
  await deps.save({
    ...settings,
    providers: [...settings.providers, provider],
    activeProviderId: settings.activeProviderId ?? provider.id,
  })
  try {
    await deps.setKey(provider.id, key)
  } catch (error) {
    await deps.save(withoutProvider(await deps.readSettings(), provider.id))
    throw error
  }
}
