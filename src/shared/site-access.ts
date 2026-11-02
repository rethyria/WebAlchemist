import { originPermissionFor } from './match'
import type { Transform } from './types'
import { t } from './i18n'

/**
 * Helpers for showing which sites the extension can read, and which
 * transforms depend on each grant (#122). These are pure so that the rules for
 * what counts as covered can be tested without a browser.
 */

/** The origin permission a transform needs, in match-pattern form. */
export function requiredOrigin(transform: Pick<Transform, 'match'>): string {
  return originPermissionFor(transform.match)
}

/** The scheme and host of a `scheme://host/*` pattern, or null for any other shape. */
function partsOf(origin: string): { scheme: string; host: string } | null {
  const found = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]+)\/\*$/.exec(origin)
  return found ? { scheme: found[1]!, host: found[2]! } : null
}

/**
 * Whether a held scheme covers a required one. The `*` scheme covers http,
 * https, ws and wss, as it does in Firefox match patterns; any other scheme
 * covers only itself, and so never covers a required `*`.
 */
function schemeCovers(held: string, required: string): boolean {
  if (held === required) return true
  return held === '*' && ['http', 'https', 'ws', 'wss'].includes(required)
}

/**
 * Whether a held origin permission covers a required one.
 *
 * Both are compared by scheme and host, following match-pattern rules: a leading `*.`
 * covers the domain itself and every subdomain, and `*` covers every host. A
 * grant for `*://www.example.com/*` does not cover `*://*.example.com/*`,
 * because the pattern also names hosts the grant does not include. That is the
 * case a transform saved with the default pattern was in before #102.
 *
 * The scheme may be `*`, `http`, `https` or another one: a held `*` covers a
 * required http or https, and a held `https` covers only a required `https`.
 * Patterns that are not in `scheme://host/*` form cover only an identical
 * string, which is conservative: it can report a missing grant, never an
 * invented one.
 */
export function originCovers(held: string, required: string): boolean {
  if (held === required || held === '<all_urls>') return true
  const heldParts = partsOf(held)
  const requiredParts = partsOf(required)
  if (heldParts === null || requiredParts === null) return false
  if (!schemeCovers(heldParts.scheme, requiredParts.scheme)) return false
  const heldHost = heldParts.host
  const requiredHost = requiredParts.host
  if (heldHost === '*' || heldHost === requiredHost) return true
  if (heldHost.startsWith('*.')) {
    const domain = heldHost.slice(2)
    const bare = requiredHost.startsWith('*.') ? requiredHost.slice(2) : requiredHost
    return bare === domain || bare.endsWith(`.${domain}`)
  }
  return false
}

/** Whether the held origins let this transform run on the sites it names. */
export function hasAccess(held: string[], transform: Pick<Transform, 'match'>): boolean {
  const needed = requiredOrigin(transform)
  return held.some((origin) => originCovers(origin, needed))
}

export interface SiteGrant {
  origin: string
  /** Transforms whose required origin this grant covers. */
  transforms: number
}

/**
 * One entry per held origin, with the number of transforms it covers, sorted by
 * origin so the order does not change between reads. An all-sites grant is
 * listed like any other: it is the broadest access the extension can hold, and
 * hiding it would defeat the purpose of the list.
 */
export function siteGrants(held: string[], transforms: Pick<Transform, 'match'>[]): SiteGrant[] {
  return [...new Set(held)].sort().map((origin) => ({
    origin,
    transforms: transforms.filter((t) => originCovers(origin, requiredOrigin(t))).length,
  }))
}

/**
 * The question to ask before removing a grant, or null when no transform
 * depends on it and the grant can be removed without asking.
 */
export function removeAccessQuestion(grant: SiteGrant): string | null {
  if (grant.transforms === 0) return null
  return grant.transforms === 1
    ? t('removeAccessQuestionOne', grant.origin)
    : t('removeAccessQuestionMany', grant.transforms, grant.origin)
}
