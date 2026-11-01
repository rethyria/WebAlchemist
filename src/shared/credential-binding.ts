/**
 * Where a provider sends its requests, in the form a credential is bound to.
 *
 * A provider id stays the same when its base URL or type is edited, so the id
 * alone cannot say whether a stored key is still being sent where it was
 * entered. This is the value compared instead.
 */

import type { CredentialBinding, Provider } from './types'

/** The Anthropic adapter uses the SDK's default host and ignores `baseUrl`. */
export const ANTHROPIC_ORIGIN = 'https://api.anthropic.com'

/** Returns null when an OpenAI-compatible provider has no usable base URL. */
export function destinationOf(provider: Provider): CredentialBinding | null {
  if (provider.type === 'anthropic') return { type: 'anthropic', origin: ANTHROPIC_ORIGIN }
  try {
    // `URL.origin` lowercases the host and drops a default port, so
    // https://API.example.com:443/v1 and https://api.example.com/v2 compare equal.
    return { type: provider.type, origin: new URL(provider.baseUrl ?? '').origin }
  } catch {
    return null
  }
}

export function sameBinding(a: CredentialBinding, b: CredentialBinding): boolean {
  return a.type === b.type && a.origin === b.origin
}
