import { describe, expect, it } from 'vitest'
import { excludePatternsFor, hostOfUrl, isUrlOnHosts } from './site-off'

describe('hostOfUrl', () => {
  it('returns the lower-case host without port, path or query', () => {
    expect(hostOfUrl('https://WWW.Example.com:8443/a?b=1#c')).toBe('www.example.com')
  })
  it('drops one trailing dot', () => {
    expect(hostOfUrl('https://www.example.com./a')).toBe('www.example.com')
  })
  it('returns null for addresses that are not websites', () => {
    expect(hostOfUrl('about:blank')).toBeNull()
    expect(hostOfUrl('moz-extension://abc/page.html')).toBeNull()
    expect(hostOfUrl('not a url')).toBeNull()
  })
})

describe('isUrlOnHosts', () => {
  it('matches the exact host only, not a subdomain or the parent domain', () => {
    const hosts = ['www.example.com']
    expect(isUrlOnHosts(hosts, 'https://www.example.com/x')).toBe(true)
    expect(isUrlOnHosts(hosts, 'https://example.com/x')).toBe(false)
    expect(isUrlOnHosts(hosts, 'https://a.www.example.com/x')).toBe(false)
  })
})

describe('excludePatternsFor', () => {
  it('names every scheme, sorted and without duplicates', () => {
    expect(excludePatternsFor(['b.test', 'a.test', 'b.test'])).toEqual(['*://a.test/*', '*://b.test/*'])
  })
  it('is empty for no hosts', () => {
    expect(excludePatternsFor([])).toEqual([])
  })
})
