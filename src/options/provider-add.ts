import type { CredentialStatus, Provider, SettingsChange } from '@shared/types'

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

/**
 * Saves a new provider and then its key, and takes the provider back out if
 * the key cannot be stored.
 *
 * The provider goes first because the background binds a key to the saved
 * provider's address and refuses a key for one it does not know. Both the add
 * and the rollback are changes that the background applies to the settings as
 * they are stored at that moment. The page does not write back the settings it
 * loaded, because another page may have saved a change since then, such as the
 * switch that stops AI-written JavaScript, and writing the loaded copy would
 * undo it.
 */
export async function addProviderWithKey(
  deps: {
    change: (change: SettingsChange) => Promise<void>
    setKey: (providerId: string, key: string) => Promise<void>
  },
  provider: Provider,
  key: string,
): Promise<void> {
  await deps.change({ kind: 'add-provider', provider })
  try {
    await deps.setKey(provider.id, key)
  } catch (error) {
    await deps.change({ kind: 'remove-provider', providerId: provider.id })
    throw error
  }
}
