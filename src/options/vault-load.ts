import type { CredentialStatus } from '@shared/types'

export interface VaultState {
  sealed: boolean
  unlocked: boolean
}

type Call = <T>(message: { type: string }) => Promise<T>

/**
 * Reads the vault state and, only when the credentials can be read, their
 * statuses.
 *
 * The vault state is requested first because the statuses request fails with a
 * locked-vault error while the vault is sealed and locked, which is the state
 * after every browser start. When that rejection was left uncaught, the vault
 * state was never read, and the page described a sealed vault as unencrypted.
 * Asking for the state first and skipping the statuses call while locked means
 * the page always has the state, and never makes a request that is certain to
 * fail.
 */
export async function loadVaultAndStatuses(
  call: Call,
): Promise<{ vault: VaultState; statuses: CredentialStatus[]; error?: string }> {
  const vault = await call<VaultState>({ type: 'vault-state' })
  const locked = vault.sealed && !vault.unlocked
  if (locked) return { vault, statuses: [] }
  try {
    return { vault, statuses: await call<CredentialStatus[]>({ type: 'get-credential-statuses' }) }
  } catch (error) {
    /*
     * The state said the credentials were readable, and the request failed
     * anyway. The usual cause is another tab locking the vault in between, and
     * the state read at the start is then out of date. It is read again so the
     * page shows the state that is true now, and no statuses are shown.
     *
     * The error is dropped only when the state now says locked, because the
     * lock explains it. When the state still says the credentials are
     * readable, nothing explains the failure; the stored data may be corrupt.
     * Dropping the error then showed an unlocked vault with no keys and no
     * message, so the error is returned for the page to show.
     */
    const again = await call<VaultState>({ type: 'vault-state' })
    const explainedByLock = again.sealed && !again.unlocked
    return {
      vault: again,
      statuses: [],
      ...(explainedByLock
        ? {}
        : { error: error instanceof Error ? error.message : String(error) }),
    }
  }
}
