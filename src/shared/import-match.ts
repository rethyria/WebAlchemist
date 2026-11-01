/**
 * Checks of the match patterns in an imported file, and a description of the
 * sites a pattern covers in plain words (#56).
 *
 * A pattern in a file written by someone else decides where the importer's
 * browser runs the transform, and the permission prompt for the import asks
 * for those sites. A pattern for every site would put an unknown stylesheet or
 * script on every page the extension can read, so patterns that cover more than
 * one site are refused, and the rest are described so that the user can read
 * which sites they are about to give the transform.
 */

import { parsePattern } from './match'

/**
 * Two-label suffixes under which unrelated people register their own sites, so
 * that a pattern such as `*.co.uk` covers sites of many owners. The list is
 * short: it names the common ones, and a complete list would be the public
 * suffix list, which the extension does not ship. A suffix missing here is a
 * pattern that is wider than one site and still accepted.
 */
const SHARED_SUFFIXES: ReadonlySet<string> = new Set([
  'ac.uk',
  'co.in',
  'co.jp',
  'co.kr',
  'co.nz',
  'co.uk',
  'co.za',
  'com.ar',
  'com.au',
  'com.br',
  'com.cn',
  'com.mx',
  'com.tr',
  'gov.uk',
  'net.au',
  'org.au',
  'org.uk',
  'blogspot.com',
  'github.io',
  'gitlab.io',
  'herokuapp.com',
  'netlify.app',
  'pages.dev',
  'vercel.app',
  'workers.dev',
])

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

export type MatchAssessment =
  | { ok: true; /** The sites the pattern covers, in words. */ sites: string }
  | { ok: false; reason: string }

/**
 * Whether an imported pattern may be kept, and if so which sites it covers.
 *
 * Refused: an empty pattern, `<all_urls>`, a host that is `*` or a bare
 * suffix such as `*.com`, a host with a wildcard anywhere but a leading `*.`,
 * a host with a port or an IPv6 address, and a scheme other than http, https or `*`.
 */
export function assessMatch(pattern: string): MatchAssessment {
  const trimmed = pattern.trim()
  if (trimmed === '') return { ok: false, reason: 'The match pattern is empty.' }
  if (trimmed === '<all_urls>' || /^[a-z*]+:\/\/\*\/\*$/i.test(trimmed)) {
    return { ok: false, reason: 'The match pattern covers every site.' }
  }
  const scheme = /^([a-z][a-z0-9+.-]*|\*):\/\//i.exec(trimmed)?.[1]
  if (scheme !== undefined && scheme !== '*' && scheme !== 'http' && scheme !== 'https') {
    return { ok: false, reason: `The match pattern uses the scheme ${scheme}, which is not supported.` }
  }

  const { host, path } = parsePattern(trimmed)
  if (host === '' || host === '*') {
    return { ok: false, reason: 'The match pattern covers every site.' }
  }
  const wildcard = host.startsWith('*.')
  const name = wildcard ? host.slice(2) : host
  const labels = name.split('.')
  const isIp = IPV4.test(name)
  if (!isIp && !labels.every((label) => HOST_LABEL.test(label))) {
    return { ok: false, reason: `The host "${host}" is not a plain host name.` }
  }
  if (wildcard && isIp) {
    return { ok: false, reason: `The host "${host}" puts a wildcard in front of an address.` }
  }
  if (wildcard && (labels.length < 2 || SHARED_SUFFIXES.has(name.toLowerCase()))) {
    return { ok: false, reason: `The match pattern covers every site under ${name}, not one site.` }
  }
  if (!wildcard && !isIp && labels.length < 2 && name.toLowerCase() !== 'localhost') {
    return { ok: false, reason: `"${name}" is not a site address.` }
  }
  if (!path.startsWith('/')) return { ok: false, reason: 'The match pattern has no valid path.' }

  const how =
    scheme === 'https' ? 'over https only' : scheme === 'http' ? 'over plain http only' : 'over http and https'
  const where = wildcard ? `${name} and all its subdomains` : name
  return { ok: true, sites: `${describePath(path)} on ${where}, ${how}` }
}

function describePath(path: string): string {
  if (path === '/*') return 'Every page'
  if (path.endsWith('*') && !path.slice(0, -1).includes('*')) {
    return `Pages whose address starts with ${path.slice(0, -1)}`
  }
  if (path.includes('*')) return `Pages whose address matches ${path}`
  return `The page ${path}`
}
