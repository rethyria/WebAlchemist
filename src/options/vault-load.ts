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
): Promise<{ vault: VaultState; statuses: CredentialStatus[] }> {
  const vault = await call<VaultState>({ type: 'vault-state' })
  const locked = vault.sealed && !vault.unlocked
  if (locked) return { vault, statuses: [] }
  try {
    return { vault, statuses: await call<CredentialStatus[]>({ type: 'get-credential-statuses' }) }
  } catch {
    /*
     * The state said the credentials were readable, and the request failed
     * anyway. The usual cause is another tab locking the vault in between, and
     * the state read at the start is then out of date. It is read again so the
     * page shows the state that is true now, and no statuses are shown. The
     * error itself is not shown: it carries no information the state does not.
     */
    return { vault: await call<VaultState>({ type: 'vault-state' }), statuses: [] }
  }
}
