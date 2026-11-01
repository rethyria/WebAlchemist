import { describe, expect, it } from 'vitest'
import { excludedHostFor, excludedHostForPattern, normalizeExcludedEntry } from './excluded-sites'

describe('normalizeExcludedEntry', () => {
  it('accepts a host name, an address and a wildcard host, and returns the host', () => {
    expect(normalizeExcludedEntry('Example.COM')).toBe('example.com')
    expect(normalizeExcludedEntry('https://www.bank.example/login?x=1')).toBe('www.bank.example')
    expect(normalizeExcludedEntry('*.bank.example')).toBe('bank.example')
    expect(normalizeExcludedEntry('  mail.test  ')).toBe('mail.test')
  })

  it('drops one trailing dot, so a fully qualified name is the same entry', () => {
    expect(normalizeExcludedEntry('bank.example.')).toBe('bank.example')
    expect(normalizeExcludedEntry('https://bank.example./login')).toBe('bank.example')
  })

  it('refuses text that is not a site name', () => {
    expect(normalizeExcludedEntry('')).toBeNull()
    expect(normalizeExcludedEntry('   ')).toBeNull()
    expect(normalizeExcludedEntry('not a site')).toBeNull()
    expect(normalizeExcludedEntry('bank')).toBeNull()
    expect(normalizeExcludedEntry('about:blank')).toBeNull()
  })
})

describe('excludedHostFor', () => {
  const list = ['bank.example']
  it('covers the host and its subdomains', () => {
    expect(excludedHostFor(list, 'https://bank.example/')).toBe('bank.example')
    expect(excludedHostFor(list, 'https://login.bank.example/a')).toBe('login.bank.example')
  })
  it('covers a host written with a trailing dot, and its subdomains', () => {
    expect(excludedHostFor(list, 'https://bank.example./')).toBe('bank.example')
    expect(excludedHostFor(list, 'https://login.bank.example./a')).toBe('login.bank.example')
  })
  it('does not cover another host that ends with the same letters (control)', () => {
    expect(excludedHostFor(list, 'https://notbank.example/')).toBeNull()
    expect(excludedHostFor(list, 'https://bank.example.evil.test/')).toBeNull()
  })
  it('covers nothing when the list is empty, which is how it starts', () => {
    expect(excludedHostFor([], 'https://bank.example/')).toBeNull()
  })
  it('ignores addresses that are not websites', () => {
    expect(excludedHostFor(list, 'about:blank')).toBeNull()
  })
})

describe('excludedHostForPattern', () => {
  const list = ['bank.example']
  it('refuses the host itself and a subdomain', () => {
    expect(excludedHostForPattern(list, 'bank.example/*')).toBe('bank.example')
    expect(excludedHostForPattern(list, 'https://login.bank.example/a*')).toBe('bank.example')
  })
  it('refuses a parent-domain pattern that covers the host', () => {
    expect(excludedHostForPattern(list, '*.bank.example/*')).toBe('bank.example')
    expect(excludedHostForPattern(list, '*://*.bank.example/*')).toBe('bank.example')
  })
  it('refuses a wider pattern that reaches an entry from above', () => {
    expect(excludedHostForPattern(['login.bank.example'], '*.bank.example/*')).toBe('login.bank.example')
  })
  it('refuses a pattern for every host while the list has entries', () => {
    expect(excludedHostForPattern(list, '*/*')).toBe('bank.example')
    expect(excludedHostForPattern(list, '<all_urls>')).toBe('bank.example')
  })
  it('handles a port and a trailing dot', () => {
    expect(excludedHostForPattern(list, 'bank.example:8443/*')).toBe('bank.example')
    expect(excludedHostForPattern(list, 'bank.example./*')).toBe('bank.example')
  })
  it('allows other sites, including one that only ends with the same letters (control)', () => {
    expect(excludedHostForPattern(list, 'news.example/*')).toBeNull()
    expect(excludedHostForPattern(list, 'notbank.example/*')).toBeNull()
    expect(excludedHostForPattern(list, '*.notbank.example/*')).toBeNull()
    expect(excludedHostForPattern(list, 'bank.example.evil.test/*')).toBeNull()
  })
  it('allows everything when the list is empty (control)', () => {
    expect(excludedHostForPattern([], '*/*')).toBeNull()
    expect(excludedHostForPattern([], 'bank.example/*')).toBeNull()
  })
})
