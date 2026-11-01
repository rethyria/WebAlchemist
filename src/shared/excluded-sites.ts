/**
 * The user's list of sites on which picking and generation are refused (#131).
 *
 * An entry is a host name. It covers that host and every subdomain of it, so
 * that one entry for a bank's domain also covers its login and account
 * subdomains. The list starts empty: a built-in list of banking domains would
 * depend on the country and go out of date.
 */

import { hostOfUrl } from './site-off'

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
