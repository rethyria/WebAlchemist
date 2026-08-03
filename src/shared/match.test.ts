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
  it('recommends the whole site by default', () => {
    const presets = matchPresetsFor('https://news.ycombinator.com/item?id=1')
    expect(presets.find((p) => p.recommended)?.pattern).toBe('news.ycombinator.com/*')
  })

  it('offers a path-prefix option for nested URLs', () => {
    const presets = matchPresetsFor('https://reddit.com/r/programming/comments/abc')
    expect(presets.map((p) => p.pattern)).toContain('reddit.com/r/programming/*')
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
