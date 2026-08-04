import { describe, expect, it } from 'vitest'
import { matchPresetsFor, matchesUrl, originPermissionFor } from './match'

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
  it('recommends the whole site, including subdomains', () => {
    const presets = matchPresetsFor('https://news.ycombinator.com/item?id=1')
    expect(presets.find((p) => p.recommended)?.pattern).toBe('*.news.ycombinator.com/*')
  })

  it('offers a path-prefix option for nested URLs', () => {
    const presets = matchPresetsFor('https://reddit.com/r/programming/comments/abc')
    expect(presets.map((p) => p.pattern)).toContain('reddit.com/r/programming*')
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
    expect(presets.map((p) => p.pattern)).toContain('example.com/some/page')
  })

  it('returns nothing for an unparseable URL', () => {
    expect(matchPresetsFor('not a url')).toEqual([])
  })
})

describe('originPermissionFor', () => {
  it('derives the origin permission a pattern requires', () => {
    expect(originPermissionFor('reddit.com/r/programming/*')).toBe('*://reddit.com/*')
    expect(originPermissionFor('*.example.com/*')).toBe('*://*.example.com/*')
  })
})
