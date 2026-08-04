/**
 * URL matching for transform records.
 *
 * Patterns are stored without a scheme and are matched against http and https
 * only. Users never write these by hand in the common case — the save flow
 * derives concrete choices from the current URL (this domain / with subdomains
 * / this path prefix / this exact page) and stores the result.
 */

export interface MatchPreset {
  label: string
  pattern: string
  /** Preselected in the save UI. */
  recommended?: boolean
}

/** Builds the choices offered at save time for a given page URL. */
export function matchPresetsFor(rawUrl: string): MatchPreset[] {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return []
  }

  const host = url.hostname
  const registrable = host.replace(/^www\./, '')
  const presets: MatchPreset[] = []

  /*
   * `*.` covers the domain itself as well as its subdomains, so this matches
   * youtube.com and www.youtube.com alike.
   *
   * The bare `registrable/*` that used to be recommended here did not match
   * its own page on any www host: saving on www.youtube.com produced a
   * transform that could never apply and never appeared in the list.
   */
  presets.push({
    label: `${registrable} and its subdomains`,
    pattern: `*.${registrable}/*`,
    recommended: true,
  })

  presets.push({ label: `${host} only`, pattern: `${host}/*` })

  // First meaningful path segment, e.g. reddit.com/r/programming*
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length >= 1) {
    const depth = Math.min(segments.length, 2)
    const prefix = segments.slice(0, depth).join('/')
    presets.push({
      // No slash before the wildcard, so this covers /watch as well as
      // /watch/anything — the prefix page itself is part of the prefix.
      label: `${host}/${prefix}`,
      pattern: `${host}/${prefix}*`,
    })
  }

  presets.push({ label: 'This exact page', pattern: `${host}${url.pathname}` })

  return presets
}

/** Escapes regex metacharacters except `*`, which becomes a wildcard. */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/**
 * Host matching, following WebExtension match-pattern semantics.
 *
 * A leading `*.` means the domain itself *or* any subdomain of it, which is
 * what `*://*.example.com/*` means to the browser. Treating it as a literal
 * wildcard would exclude the bare domain, and the same string is handed to
 * permissions.request — the two must agree on what they cover.
 */
function hostMatches(pattern: string, hostname: string): boolean {
  if (pattern.startsWith('*.')) {
    const domain = pattern.slice(2)
    return hostname === domain || hostname.endsWith(`.${domain}`)
  }
  return patternToRegExp(pattern).test(hostname)
}

export function matchesUrl(pattern: string, rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const slash = pattern.indexOf('/')
  const hostPattern = slash === -1 ? pattern : pattern.slice(0, slash)
  const pathPattern = slash === -1 ? '/*' : pattern.slice(slash)

  if (!hostMatches(hostPattern, url.hostname)) return false

  const regex = patternToRegExp(pathPattern)
  // Trailing slashes are not meaningful here: /watch and /watch/ are the page.
  return regex.test(url.pathname) || regex.test(url.pathname.replace(/\/$/, ''))
}

/** The origin permission a pattern requires, for permissions.request(). */
export function originPermissionFor(pattern: string): string {
  const host = pattern.split('/')[0] ?? pattern
  return `*://${host}/*`
}

/**
 * The same, from a full URL rather than a stored pattern.
 *
 * These are separate on purpose. Passing a URL to originPermissionFor yields
 * `*://https:/*`, because it splits on the first slash and a URL's first
 * segment is the scheme — a silent wrong answer rather than an error.
 */
export function originPermissionForUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `*://${url.hostname}/*`
  } catch {
    return null
  }
}
