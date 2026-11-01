import { t } from './i18n'
/**
 * Which URLs the extension may send a credential to.
 *
 * One rule, shared by the settings page and the background script. The page
 * applies it so the person typing gets an answer at once; the background
 * applies it because a message can reach it from any extension context without
 * passing through the page, and an API key, an authorization code or a refresh
 * token sent to an http address on another host crosses the network unprotected.
 *
 * The rule is https for every host, plus plain http for the machine itself,
 * because local model servers (Ollama, LM Studio, llama.cpp) do not serve TLS.
 * Loopback traffic does not leave the machine.
 *
 * Loopback is defined here once. Before this module the adapter accepted
 * 127.0.0.1 and [::1] while the page accepted only localhost, so an address the
 * adapter would have used could not be entered.
 */

/** `URL.hostname` keeps the brackets on an IPv6 address. */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  return octets !== null && octets.slice(1).every((part) => Number(part) <= 255)
}

/** Returns why the endpoint is refused, or null when it is allowed. */
export function endpointProblem(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return t('endpointInvalid')
  }
  if (url.protocol === 'https:') return null
  if (url.protocol === 'http:') {
    if (isLoopbackHostname(url.hostname)) return null
    return t('endpointNeedsHttps')
  }
  return t('endpointNeedsScheme')
}

/** Throws with the reason and the name of the setting, for the background. */
export function assertEndpoint(value: string, what: string, providerLabel?: string): void {
  const problem = endpointProblem(value)
  if (!problem) return
  const name = t(what === 'base URL' ? 'endpointNameBase' : what === 'token endpoint' ? 'endpointNameToken' : 'endpointNameAuthorization')
  throw new Error(
    providerLabel === undefined
      ? t('endpointNotAllowed', name, problem)
      : t('endpointNotAllowedFor', name, providerLabel, problem),
  )
}

/** The endpoint fields of a provider, as [label, value] pairs. */
export function endpointsOf(provider: {
  type: string
  baseUrl?: string
  oauth?: { authorizationEndpoint: string; tokenEndpoint: string }
}): [string, string][] {
  const out: [string, string][] = []
  // The base URL of an Anthropic provider is ignored, so it is not checked.
  if (provider.type === 'openai-compatible' && provider.baseUrl !== undefined) {
    out.push(['base URL', provider.baseUrl])
  }
  if (provider.oauth) {
    out.push(['authorization endpoint', provider.oauth.authorizationEndpoint])
    out.push(['token endpoint', provider.oauth.tokenEndpoint])
  }
  return out
}
