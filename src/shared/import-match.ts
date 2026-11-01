/**
 * Checks of the match patterns in an imported file, and a description of the
 * sites a pattern covers in plain words (#56).
 *
 * A pattern in a file written by someone else decides where the importer's
 * browser runs the transform, and the permission prompt for the import asks
 * for those sites. A pattern for every site would put an unknown stylesheet or
 * script on every page the extension can read, so patterns that cover more than
 * one site are refused, as are patterns for the user's own computer and
 * network, and the rest are described so that the user can read
 * which sites they are about to give the transform.
 */

import { parsePattern } from './match'
import { t } from './i18n'

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
/** Name endings that are used for the user's own computer or network, not for sites on the internet. */
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'intranet', 'home.arpa', 'corp', 'home']

/** True for the loopback range and the private, link-local and shared address ranges of IPv4. */
function isPrivateIpv4(name: string): boolean {
  const [a, b] = name.split('.').map(Number) as [number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

export type MatchAssessment =
  | { ok: true; /** The sites the pattern covers, in words. */ sites: string }
  | { ok: false; reason: string }

/**
 * Whether an imported pattern may be kept, and if so which sites it covers.
 *
 * Refused: an empty pattern, `<all_urls>`, a host that is `*`, every host that
 * starts with `*.` (a list of the suffixes that unrelated people share cannot
 * be complete, so no wildcard host is taken), a wildcard anywhere else in the
 * host, a host with a port or an IPv6 address, a loopback, private-network or
 * link-local address or a name that ends in `.local` or `.localhost`, and a
 * scheme other than http, https or `*`.
 */
export function assessMatch(pattern: string): MatchAssessment {
  const trimmed = pattern.trim()
  if (trimmed === '') return { ok: false, reason: t('importMatchEmpty') }
  if (trimmed === '<all_urls>' || /^[a-z*]+:\/\/\*\/\*$/i.test(trimmed)) {
    return { ok: false, reason: t('importMatchAllSites') }
  }
  const scheme = /^([a-z][a-z0-9+.-]*|\*):\/\//i.exec(trimmed)?.[1]
  if (scheme !== undefined && scheme !== '*' && scheme !== 'http' && scheme !== 'https') {
    return { ok: false, reason: t('importMatchScheme', scheme) }
  }

  const parsed = parsePattern(trimmed)
  const path = parsed.path
  // Compared in lower case, because host names are not case sensitive.
  const host = parsed.host.toLowerCase()
  if (host === '' || host === '*') {
    return { ok: false, reason: t('importMatchAllSites') }
  }
  if (host.startsWith('*.')) {
    return {
      ok: false,
      reason: t('importMatchSubdomains', parsed.host, host.slice(2)),
    }
  }
  const labels = host.split('.')
  const isIp = IPV4.test(host)
  if (!isIp && !labels.every((label) => HOST_LABEL.test(label))) {
    return { ok: false, reason: t('importMatchNotPlainHost', parsed.host) }
  }
  // A last label made of digits, or written in hexadecimal, makes the browser
  // read the host as an address in a form this check does not parse.
  const last = labels[labels.length - 1]!
  if (!isIp && /^(\d+|0x[0-9a-f]*)$/.test(last)) {
    return { ok: false, reason: t('importMatchNotPlainHost', parsed.host) }
  }
  if (isIp && labels.some((label) => Number(label) > 255 || (label.length > 1 && label.startsWith('0')))) {
    return { ok: false, reason: t('importMatchNotPlainAddress', parsed.host) }
  }
  if (isIp ? isPrivateIpv4(host) : LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return {
      ok: false,
      reason: t('importMatchPrivate', parsed.host),
    }
  }
  if (!isIp && labels.length < 2) return { ok: false, reason: t('importMatchNotSite', host) }
  if (!path.startsWith('/')) return { ok: false, reason: t('importMatchNoPath') }

  const key =
    scheme === 'https'
      ? 'importMatchSitesHttps'
      : scheme === 'http'
        ? 'importMatchSitesHttp'
        : 'importMatchSitesBoth'
  return { ok: true, sites: t(key, describePath(path), host) }
}

function describePath(path: string): string {
  if (path === '/*') return t('importPagesAll')
  if (path.endsWith('*') && !path.slice(0, -1).includes('*')) {
    return t('importPagesPrefix', path.slice(0, -1))
  }
  if (path.includes('*')) return t('importPagesMatch', path)
  return t('importPageOne', path)
}
