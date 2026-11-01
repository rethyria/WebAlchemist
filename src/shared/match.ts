/**
 * URL matching for transform records.
 *
 * Patterns are matched against http and https only. Users never write these by
 * hand in the common case — the save flow derives concrete choices from the
 * current URL (this host / with subdomains / this path prefix / this exact
 * page) and stores the result.
 *
 * A pattern may start with a scheme: `https://example.com/*` matches only
 * https, `http://example.com/*` only http, and `*://example.com/*` both. The
 * save flow writes the scheme of the page the user was on. A pattern with no
 * scheme is one saved before schemes were stored; it matches both here, and
 * registry.ts decides separately which schemes a script is registered for.
 */

export type PatternScheme = 'http' | 'https' | '*'

export interface ParsedPattern {
  /** Undefined for a pattern saved without a scheme. */
  scheme: PatternScheme | undefined
  host: string
  path: string
}

/** Splits a stored pattern into its optional scheme, host and path. */
export function parsePattern(pattern: string): ParsedPattern {
  const found = /^(https?|\*):\/\//.exec(pattern)
  const rest = found ? pattern.slice(found[0].length) : pattern
  const slash = rest.indexOf('/')
  return {
    scheme: found ? (found[1] as PatternScheme) : undefined,
    host: slash === -1 ? rest : rest.slice(0, slash),
    path: slash === -1 ? '/*' : rest.slice(slash),
  }
}

export interface MatchPreset {
  label: string
  pattern: string
  /** Preselected in the save UI. */
  recommended?: boolean
}

/** An IPv4 address, or an IPv6 address, which `URL.hostname` writes in brackets. */
function isIpAddress(host: string): boolean {
  return host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

/** Builds the choices offered at save time for a given page URL. */
export function matchPresetsFor(rawUrl: string): MatchPreset[] {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return []
  }

  // The scheme of the page is part of every pattern, so a transform saved on an
  // https page is not also registered for the plain-http version of the site.
  const scheme = url.protocol === 'http:' || url.protocol === 'https:' ? `${url.protocol}//` : ''
  const host = url.hostname
  const registrable = host.replace(/^www\./, '')
  const presets: MatchPreset[] = []

  /*
   * The exact host is recommended, not the domain with its subdomains. The
   * wider pattern used to be recommended, with a leading `www.` removed, so
   * saving on www.google.com produced `*.google.com/*`, and the transform then
   * also ran on accounts.google.com and mail.google.com, and the permission
   * prompt asked for every google.com subdomain. A transform is written for
   * the pages the user was looking at; covering sibling services is a choice
   * the user makes, so it is offered below and not preselected.
   */
  presets.push({ label: `${host} only`, pattern: `${scheme}${host}/*`, recommended: true })

  /*
   * `*.` covers the domain itself as well as its subdomains, so this matches
   * youtube.com and www.youtube.com alike. A bare `registrable/*` would not
   * match its own page on a www host, which is why the `*.` form is used.
   */
  // Not offered for an IP address: `*.` in front of one is not a valid match
  // pattern, and a pattern the browser rejects can stop content script
  // registration for an origin.
  if (!isIpAddress(host)) {
    presets.push({
      label: `${registrable} and all its subdomains`,
      pattern: `${scheme}*.${registrable}/*`,
    })
  }

  // First meaningful path segment, e.g. reddit.com/r/programming*
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length >= 1) {
    const depth = Math.min(segments.length, 2)
    const prefix = segments.slice(0, depth).join('/')
    presets.push({
      // No slash before the wildcard, so this covers /watch as well as
      // /watch/anything — the prefix page itself is part of the prefix.
      label: `${host}/${prefix}`,
      pattern: `${scheme}${host}/${prefix}*`,
    })
  }

  // The query string is part of the pattern. Without it, saving on
  // youtube.com/watch?v=abc produced a pattern for /watch, which is every
  // video and not the page the label names. Browser match patterns compare the
  // path together with the query, so the registered script and the CSS agree.
  presets.push({
    label: 'This exact page',
    pattern: `${scheme}${host}${url.pathname}${url.search}`,
  })

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

  const { scheme, host: hostPattern, path: pathPattern } = parsePattern(pattern)
  if ((scheme === 'http' || scheme === 'https') && url.protocol !== `${scheme}:`) return false

  if (!hostMatches(hostPattern, url.hostname)) return false

  const hasQuery = pathPattern.includes('?')
  // The query is compared only when the pattern has one. A pattern written
  // without a query describes a page, and `watch?v=abc` is the page `/watch`.
  const targets = pathForms(url.pathname).map((path) => (hasQuery ? path + url.search : path))
  return pathForms(pathPattern).some((form) => {
    const regex = patternToRegExp(form)
    return targets.some((target) => regex.test(target))
  })
}

/**
 * The path part of matchesUrl as data, for code that has to repeat the check
 * where `matchesUrl` is not available, such as a user script in a page. `forms`
 * are regular expression sources, one per form of the pattern's path, and
 * `hasQuery` says whether the page's query string is part of the compared text.
 */
export function pathMatcherFor(pattern: string): { hasQuery: boolean; forms: string[] } {
  const { path } = parsePattern(pattern)
  return {
    hasQuery: path.includes('?'),
    forms: pathForms(path).map((form) => patternToRegExp(form).source),
  }
}

/**
 * A path as written and with its trailing slash removed, so `/watch` and
 * `/watch/` are the same page whichever of them the pattern or the URL has.
 * A query string stays attached to the end. The root path keeps its slash.
 */
function pathForms(path: string): string[] {
  const query = path.indexOf('?')
  const base = query === -1 ? path : path.slice(0, query)
  const rest = query === -1 ? '' : path.slice(query)
  const trimmed = base.replace(/\/+$/, '') || '/'
  return trimmed === base ? [path] : [path, trimmed + rest]
}

/** The origin permission a pattern requires, for permissions.request(). */
export function originPermissionFor(pattern: string): string {
  const { scheme, host } = parsePattern(pattern)
  // The permission asked for covers the scheme the transform is stored for, and
  // no more. A pattern with no scheme or `*://` keeps the both-schemes form.
  return `${scheme === 'http' || scheme === 'https' ? scheme : '*'}://${host}/*`
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
