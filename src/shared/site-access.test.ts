import { describe, expect, it } from 'vitest'
import { hasAccess, originCovers, siteGrants } from './site-access'

const t = (match: string) => ({ match })

describe('originCovers', () => {
  it('covers an identical origin', () => {
    expect(originCovers('*://example.com/*', '*://example.com/*')).toBe(true)
  })

  it('covers subdomains and the bare domain from a wildcard host', () => {
    expect(originCovers('*://*.example.com/*', '*://www.example.com/*')).toBe(true)
    expect(originCovers('*://*.example.com/*', '*://example.com/*')).toBe(true)
    expect(originCovers('*://*.example.com/*', '*://*.example.com/*')).toBe(true)
    expect(originCovers('*://*.example.com/*', '*://*.shop.example.com/*')).toBe(true)
  })

  it('covers everything from an all-sites grant', () => {
    expect(originCovers('<all_urls>', '*://example.com/*')).toBe(true)
    expect(originCovers('*://*/*', '*://example.com/*')).toBe(true)
  })

  // Controls: each of these must be false, or the function would report
  // access that is not held.
  it('does not cover a different domain', () => {
    expect(originCovers('*://example.com/*', '*://other.com/*')).toBe(false)
  })

  it('does not cover a lookalike host that only ends in the same letters', () => {
    expect(originCovers('*://*.example.com/*', '*://badexample.com/*')).toBe(false)
  })

  it('does not widen an exact host to its subdomains or the reverse', () => {
    expect(originCovers('*://www.example.com/*', '*://*.example.com/*')).toBe(false)
    expect(originCovers('*://example.com/*', '*://www.example.com/*')).toBe(false)
  })

  it('does not cover an origin in an unrecognised form unless identical', () => {
    expect(originCovers('http://localhost/*', '*://localhost/*')).toBe(false)
  })
})

describe('hasAccess', () => {
  it('is true when a held origin covers the transform pattern', () => {
    expect(hasAccess(['*://*.example.com/*'], t('*.example.com/*'))).toBe(true)
  })

  it('is false when no held origin covers it', () => {
    expect(hasAccess(['*://other.com/*'], t('*.example.com/*'))).toBe(false)
    expect(hasAccess([], t('example.com/*'))).toBe(false)
  })

  it('is false when only the exact host is held for a subdomain pattern', () => {
    expect(hasAccess(['*://www.example.com/*'], t('*.example.com/*'))).toBe(false)
  })
})

describe('siteGrants', () => {
  it('counts the transforms each grant covers and sorts by origin', () => {
    const grants = siteGrants(
      ['*://b.com/*', '*://*.a.com/*'],
      [t('www.a.com/*'), t('a.com/x*'), t('b.com/*'), t('c.com/*')],
    )
    expect(grants).toEqual([
      { origin: '*://*.a.com/*', transforms: 2 },
      { origin: '*://b.com/*', transforms: 1 },
    ])
  })

  it('lists a grant that no transform uses with a count of zero', () => {
    expect(siteGrants(['*://unused.com/*'], [t('a.com/*')])).toEqual([
      { origin: '*://unused.com/*', transforms: 0 },
    ])
  })

  it('lists each origin once', () => {
    expect(siteGrants(['*://a.com/*', '*://a.com/*'], [])).toHaveLength(1)
  })

  it('returns nothing when no origin is held', () => {
    expect(siteGrants([], [t('a.com/*')])).toEqual([])
  })
})
