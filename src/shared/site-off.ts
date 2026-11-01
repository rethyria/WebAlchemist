/**
 * Helpers for the per-site off switch: a host for which no transform runs.
 *
 * The switch is by host name, not by match pattern, because the panel offers
 * it for the page the user is looking at. A transform whose match pattern
 * covers several subdomains is turned off only on the subdomain that was
 * chosen; the other subdomains keep running it.
 */

/** The lower-case host of an http or https address, or null for any other address. */
export function hostOfUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

/** True when the address is on one of the hosts. */
export function isUrlOnHosts(hosts: readonly string[], rawUrl: string): boolean {
  const host = hostOfUrl(rawUrl)
  return host !== null && hosts.includes(host)
}

/**
 * Match patterns for `excludeMatches` of a registered user script. They name
 * both schemes because a script registered for https only is also registered
 * for http by registry.ts.
 */
export function excludePatternsFor(hosts: readonly string[]): string[] {
  return [...new Set(hosts)].sort().map((host) => `*://${host}/*`)
}
