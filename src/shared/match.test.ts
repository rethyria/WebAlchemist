import { describe, expect, it } from 'vitest'
import { matchPresetsFor, matchesUrl, originPermissionFor, parsePattern } from './match'

describe('matchesUrl', () => {
  it('matches a whole-site pattern against any path', () => {
    expect(matchesUrl('reddit.com/*', 'https://reddit.com/r/programming')).toBe(true)
    expect(matchesUrl('reddit.com/*', 'https://reddit.com/')).toBe(true)
  })

  it('scopes a path-prefix pattern to that prefix', () => {
    const pattern = 'reddit.com/r/programming/*'
    expect(matchesUrl(pattern, 'https://reddit.com/r/programming/comments/1')).toBe(true)
    expect(matchesUrl(pattern, 'https://reddit.com/r/aww')).toBe(false)
  })

  it('matches subdomain wildcards', () => {
    expect(matchesUrl('*.example.com/*', 'https://docs.example.com/page')).toBe(true)
    expect(matchesUrl('*.example.com/*', 'https://example.com.evil.tld/x')).toBe(false)
  })

  it('does not match non-http schemes', () => {
    expect(matchesUrl('example.com/*', 'file:///home/deck/example.com/x')).toBe(false)
    expect(matchesUrl('example.com/*', 'about:config')).toBe(false)
  })

  it('treats a trailing slash as equivalent', () => {
    expect(matchesUrl('example.com/docs', 'https://example.com/docs/')).toBe(true)
    expect(matchesUrl('example.com/docs', 'https://example.com/docs')).toBe(true)
  })

  it('does not let a dot in the pattern match an arbitrary character', () => {
    // Without escaping, "example.com" would also match "exampleXcom".
    expect(matchesUrl('example.com/*', 'https://exampleXcom/x')).toBe(false)
  })
})

describe('matchPresetsFor', () => {
  it('recommends the exact host the page is on', () => {
    const presets = matchPresetsFor('https://news.ycombinator.com/item?id=1')
    expect(presets.find((p) => p.recommended)?.pattern).toBe('https://news.ycombinator.com/*')
  })

  describe('on a www host (#58)', () => {
    const presets = matchPresetsFor('https://www.google.com/search?q=x')
    const recommended = presets.find((p) => p.recommended)!.pattern

    it('recommends www.google.com and no other host', () => {
      expect(recommended).toBe('https://www.google.com/*')
      expect(matchesUrl(recommended, 'https://www.google.com/maps')).toBe(true)
      expect(matchesUrl(recommended, 'https://accounts.google.com/signin')).toBe(false)
      expect(matchesUrl(recommended, 'https://mail.google.com/')).toBe(false)
    })

    it('is the first preset, which is the one the authoring flow starts from', () => {
      expect(presets[0]?.pattern).toBe(recommended)
    })

    it('control: the subdomain preset is still offered, is not recommended, and does cover them', () => {
      // Shows the assertions above are about which preset is recommended, since
      // the wider pattern genuinely reaches the sibling hosts.
      const wide = presets.find((p) => p.pattern === 'https://*.google.com/*')!
      expect(wide.recommended).toBeUndefined()
      expect(matchesUrl(wide.pattern, 'https://accounts.google.com/signin')).toBe(true)
    })
  })

  it('offers a path-prefix option for nested URLs', () => {
    const presets = matchPresetsFor('https://reddit.com/r/programming/comments/abc')
    expect(presets.map((p) => p.pattern)).toContain('https://reddit.com/r/programming*')
  })

  /*
   * The invariant that was broken in the field. On www.youtube.com the
   * recommended preset was youtube.com/*, which does not match a www host —
   * so saving produced a transform that could never apply and never appeared
   * in the list. A preset that excludes the page it was offered on is never
   * correct, whatever else it does.
   */
  describe('every preset matches the page it was generated from', () => {
    const urls = [
      'https://www.youtube.com/watch?v=abc',
      'https://youtube.com/watch?v=abc',
      'https://example.com/',
      'https://example.com/some/page',
      'https://news.ycombinator.com/item?id=1',
      'https://reddit.com/r/programming/comments/abc',
      'https://a.b.deeply.nested.example.co.uk/x/y',
      'http://localhost:3000/app',
    ]

    for (const url of urls) {
      it(url, () => {
        const presets = matchPresetsFor(url)
        expect(presets.length).toBeGreaterThan(0)
        for (const preset of presets) {
          expect(matchesUrl(preset.pattern, url), preset.pattern).toBe(true)
        }
      })
    }
  })

  it('treats a leading *. as the domain or any subdomain of it', () => {
    expect(matchesUrl('*.youtube.com/*', 'https://www.youtube.com/watch')).toBe(true)
    expect(matchesUrl('*.youtube.com/*', 'https://youtube.com/watch')).toBe(true)
    expect(matchesUrl('*.youtube.com/*', 'https://m.youtube.com/watch')).toBe(true)
    // Not a suffix match on the raw string: this is a different domain.
    expect(matchesUrl('*.youtube.com/*', 'https://notyoutube.com/watch')).toBe(false)
    expect(matchesUrl('*.youtube.com/*', 'https://evil-youtube.com/watch')).toBe(false)
  })

  it('keeps a bare host pattern to that host', () => {
    expect(matchesUrl('youtube.com/*', 'https://youtube.com/watch')).toBe(true)
    expect(matchesUrl('youtube.com/*', 'https://www.youtube.com/watch')).toBe(false)
  })

  it('offers an exact-page option', () => {
    const presets = matchPresetsFor('https://example.com/some/page')
    expect(presets.map((p) => p.pattern)).toContain('https://example.com/some/page')
  })

  it('returns nothing for an unparseable URL', () => {
    expect(matchPresetsFor('not a url')).toEqual([])
  })
})

describe('the scheme in a pattern (#59)', () => {
  it('is the scheme of the page the presets were made on', () => {
    expect(matchPresetsFor('https://example.com/a').map((p) => p.pattern)).toEqual(
      expect.arrayContaining(['https://example.com/*', 'https://*.example.com/*']),
    )
    expect(matchPresetsFor('http://localhost:3000/app').find((p) => p.recommended)?.pattern).toBe(
      'http://localhost/*',
    )
  })

  it('limits an https pattern to https pages', () => {
    expect(matchesUrl('https://example.com/*', 'https://example.com/x')).toBe(true)
    expect(matchesUrl('https://example.com/*', 'http://example.com/x')).toBe(false)
  })

  it('limits an http pattern to http pages', () => {
    expect(matchesUrl('http://example.com/*', 'http://example.com/x')).toBe(true)
    expect(matchesUrl('http://example.com/*', 'https://example.com/x')).toBe(false)
  })

  it('lets *:// and a pattern with no scheme match both', () => {
    for (const pattern of ['*://example.com/*', 'example.com/*']) {
      expect(matchesUrl(pattern, 'https://example.com/x'), pattern).toBe(true)
      expect(matchesUrl(pattern, 'http://example.com/x'), pattern).toBe(true)
    }
  })

  it('splits a pattern into scheme, host and path', () => {
    expect(parsePattern('https://*.example.com/a*')).toEqual({ scheme: 'https', host: '*.example.com', path: '/a*' })
    expect(parsePattern('example.com/a')).toEqual({ scheme: undefined, host: 'example.com', path: '/a' })
    expect(parsePattern('*://example.com')).toEqual({ scheme: '*', host: 'example.com', path: '/*' })
  })

  it('asks for permission on the scheme the pattern names only', () => {
    expect(originPermissionFor('https://example.com/a*')).toBe('https://example.com/*')
    expect(originPermissionFor('http://*.example.com/*')).toBe('http://*.example.com/*')
    expect(originPermissionFor('*://example.com/*')).toBe('*://example.com/*')
    expect(originPermissionFor('example.com/*')).toBe('*://example.com/*')
  })
})

describe('trailing slashes and query strings (#95)', () => {
  it('treats a trailing slash in the pattern as the page without it', () => {
    expect(matchesUrl('example.com/watch/', 'https://example.com/watch')).toBe(true)
    expect(matchesUrl('example.com/watch/', 'https://example.com/watch/')).toBe(true)
    expect(matchesUrl('example.com/watch', 'https://example.com/watch/')).toBe(true)
  })

  it('matches the exact-page preset of a page with a trailing slash, with or without it', () => {
    const exact = matchPresetsFor('https://www.example.com/watch/').find(
      (p) => p.label === 'This exact page',
    )!.pattern
    expect(matchesUrl(exact, 'https://www.example.com/watch/')).toBe(true)
    expect(matchesUrl(exact, 'https://www.example.com/watch')).toBe(true)
  })

  it('does not let a trailing slash widen a pattern', () => {
    // Control: the slash rule joins /docs and /docs/ and nothing else.
    expect(matchesUrl('example.com/docs/', 'https://example.com/docs/more')).toBe(false)
    expect(matchesUrl('example.com/docs/', 'https://example.com/docsx')).toBe(false)
  })

  describe('the exact-page preset includes the query string', () => {
    const exact = (url: string) =>
      matchPresetsFor(url).find((p) => p.label === 'This exact page')!.pattern

    it('names the video the user was on', () => {
      expect(exact('https://www.youtube.com/watch?v=abc')).toBe('https://www.youtube.com/watch?v=abc')
    })

    it('matches that page and not another video', () => {
      const pattern = exact('https://www.youtube.com/watch?v=abc')
      expect(matchesUrl(pattern, 'https://www.youtube.com/watch?v=abc')).toBe(true)
      expect(matchesUrl(pattern, 'https://www.youtube.com/watch?v=other')).toBe(false)
      expect(matchesUrl(pattern, 'https://www.youtube.com/watch')).toBe(false)
    })

    it('matches the page with a trailing slash before the query', () => {
      const pattern = exact('https://example.com/watch/?v=abc')
      expect(matchesUrl(pattern, 'https://example.com/watch?v=abc')).toBe(true)
    })

    it('is unchanged for a page with no query', () => {
      expect(exact('https://example.com/some/page')).toBe('https://example.com/some/page')
    })
  })

  it('ignores the query when the pattern has none, so patterns saved earlier keep matching', () => {
    expect(matchesUrl('www.youtube.com/watch', 'https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(matchesUrl('example.com/docs*', 'https://example.com/docs?page=2')).toBe(true)
  })
})

describe('presets for an IP address (#96)', () => {
  for (const url of ['http://[::1]:8080/a/b', 'http://192.168.0.10:3000/a', 'http://127.0.0.1/']) {
    it(`offers no subdomain pattern on ${url}`, () => {
      const patterns = matchPresetsFor(url).map((p) => p.pattern)
      expect(patterns.some((p) => p.includes('*.'))).toBe(false)
      expect(patterns.length).toBeGreaterThan(0)
    })
  }

  it('control: a name that only looks like an address still gets the subdomain pattern', () => {
    const patterns = matchPresetsFor('https://192.example.com/').map((p) => p.pattern)
    expect(patterns).toContain('https://*.192.example.com/*')
  })
})

describe('originPermissionFor', () => {
  it('derives the origin permission a pattern requires', () => {
    expect(originPermissionFor('reddit.com/r/programming/*')).toBe('*://reddit.com/*')
    expect(originPermissionFor('*.example.com/*')).toBe('*://*.example.com/*')
  })
})
