import { describe, expect, it } from 'vitest'
import { excludedHostFor, normalizeExcludedEntry } from './excluded-sites'

describe('normalizeExcludedEntry', () => {
  it('accepts a host name, an address and a wildcard host, and returns the host', () => {
    expect(normalizeExcludedEntry('Example.COM')).toBe('example.com')
    expect(normalizeExcludedEntry('https://www.bank.example/login?x=1')).toBe('www.bank.example')
    expect(normalizeExcludedEntry('*.bank.example')).toBe('bank.example')
    expect(normalizeExcludedEntry('  mail.test  ')).toBe('mail.test')
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
