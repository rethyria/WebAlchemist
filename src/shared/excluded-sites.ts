/**
 * The user's list of sites on which picking and generation are refused (#131).
 *
 * An entry is a host name. It covers that host and every subdomain of it, so
 * that one entry for a bank's domain also covers its login and account
 * subdomains. The list starts empty: a built-in list of banking domains would
 * depend on the country and go out of date.
 */

import { excludePatternsFor, hostOfUrl } from './site-off'

/**
 * Turns what the user typed into a host name, or null when it is not one. An
 * address pasted from the browser is reduced to its host, and a leading "*."
 * is dropped because an entry already covers subdomains.
 */
export function normalizeExcludedEntry(input: string): string | null {
  let text = input.trim().toLowerCase()
  if (text === '') return null
  if (text.startsWith('*.')) text = text.slice(2)
  const host = text.includes('://') ? hostOfUrl(text) : hostOfUrl(`https://${text}`)
  // A host name has a dot, or is localhost; "https://x y" and bare words that
  // URL parsing accepts are refused so that a typo is not stored as a site.
  if (host === null || !/^[a-z0-9.-]+$/.test(host)) return null
  if (!host.includes('.') && host !== 'localhost') return null
  return host
}

/** The host of the address when the list covers it, otherwise null. */
export function excludedHostFor(entries: readonly string[], rawUrl: string): string | null {
  const host = hostOfUrl(rawUrl)
  if (host === null) return null
  return entries.some((entry) => host === entry || host.endsWith(`.${entry}`)) ? host : null
}

/** What the panel says when it refuses to start on an excluded site. */
export function excludedSiteMessage(host: string): string {
  return `${host} is on your list of excluded sites, so picking and generating are turned off there. Remove it from the list in the settings to use Web Alchemist on it.`
}

/** What the panel says before sending a page that has password or payment fields. */
export const SENSITIVE_PAGE_TITLE = 'This page has password or payment fields'
export const SENSITIVE_PAGE_MESSAGE =
  'Generating sends text from this page to your model provider, and the page may show private information. Send the page content only if that is acceptable.'

/**
 * The excluded host that a match pattern would give access to, or null.
 *
 * Checked before a permission request so that an excluded site is never asked
 * for (#131). A pattern covers a host when its host is that host or a parent of
 * it with a leading "*." (`*.bank.example` covers `login.bank.example`), and it
 * reaches an entry from above when the entry is under the pattern's host. A
 * pattern for every host reaches every entry, so it is refused whenever the
 * list is not empty.
 */
export function excludedHostForPattern(entries: readonly string[], pattern: string): string | null {
  if (entries.length === 0) return null
  const found = /^(?:https?|\*):\/\//.exec(pattern)
  const rest = found ? pattern.slice(found[0].length) : pattern
  const slash = rest.indexOf('/')
  let host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  if (host === '' || host === '*' || pattern === '<all_urls>') return entries[0] ?? null
  const wildcard = host.startsWith('*.')
  if (wildcard) host = host.slice(2)
  for (const entry of entries) {
    if (host === entry || host.endsWith(`.${entry}`)) return entry
    if (wildcard && entry.endsWith(`.${host}`)) return entry
  }
  return null
}

/** What the panel says when it refuses to ask for access to an excluded site. */
export function excludedAccessMessage(host: string): string {
  return `${host} is on your list of excluded sites, so Web Alchemist does not ask for access to it. Remove it from the list in the settings first.`
}

/**
 * Match patterns for `excludeMatches` that cover every excluded host and its
 * subdomains. A pattern with a leading "*." matches the bare host as well as
 * its subdomains, so one pattern per entry is enough.
 */
export function excludedPatternsFor(entries: readonly string[]): string[] {
  return [...new Set(entries)].sort().map((host) => `*://*.${host}/*`)
}

/**
 * The `excludeMatches` of a registration: the sites turned off one by one and
 * the excluded sites, or undefined when there are none.
 */
export function excludeMatchesFor(
  offHosts: readonly string[],
  excluded: readonly string[],
): string[] | undefined {
  const all = [...new Set([...excludePatternsFor(offHosts), ...excludedPatternsFor(excluded)])].sort()
  return all.length > 0 ? all : undefined
}
