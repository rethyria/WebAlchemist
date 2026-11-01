import type { Credential, Provider } from '@shared/types'
import { CredentialOriginError, readCredentialForRequest, withCredentialForRequest } from '../storage'
import { ProviderError } from './types'

/**
 * Reads the credential for a request and reports an origin mismatch as a
 * credential problem the sidebar already knows how to show. Any other error,
 * such as a locked vault, passes through with its own kind.
 */
export async function readCredentialOrProviderError(
  provider: Provider,
): Promise<Credential | null> {
  try {
    return await readCredentialForRequest(provider)
  } catch (error) {
    if (error instanceof CredentialOriginError) {
      throw new ProviderError(error.message, 'no-credential', false, { cause: error })
    }
    throw error
  }
}

/** The locked read-and-store of storage.ts, with the same error conversion. */
export async function withCredentialOrProviderError<T>(
  provider: Provider,
  step: Parameters<typeof withCredentialForRequest<T>>[1],
): Promise<T> {
  try {
    return await withCredentialForRequest(provider, step)
  } catch (error) {
    if (error instanceof CredentialOriginError) {
      throw new ProviderError(error.message, 'no-credential', false, { cause: error })
    }
    throw error
  }
}
