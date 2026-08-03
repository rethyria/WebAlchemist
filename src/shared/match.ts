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

  presets.push({
    label: `${registrable} (whole site)`,
    pattern: `${registrable}/*`,
    recommended: true,
  })

  if (host !== registrable || host.split('.').length > 2) {
    presets.push({ label: `${host} only`, pattern: `${host}/*` })
  }
  presets.push({ label: `All subdomains of ${registrable}`, pattern: `*.${registrable}/*` })

  // First meaningful path segment, e.g. reddit.com/r/programming/*
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length >= 1) {
    const depth = Math.min(segments.length, 2)
    const prefix = segments.slice(0, depth).join('/')
    presets.push({
      label: `${host}/${prefix}/`,
      pattern: `${host}/${prefix}/*`,
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

export function matchesUrl(pattern: string, rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const subject = `${url.hostname}${url.pathname}`
  const withoutTrailingSlash = subject.replace(/\/$/, '')

  const regex = patternToRegExp(pattern)
  return regex.test(subject) || regex.test(withoutTrailingSlash)
}

/** The origin permission a pattern requires, for permissions.request(). */
export function originPermissionFor(pattern: string): string {
  const host = pattern.split('/')[0] ?? pattern
  return `*://${host}/*`
}
