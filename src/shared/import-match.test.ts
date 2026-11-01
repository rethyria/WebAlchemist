import { describe, expect, it } from 'vitest'
import { assessMatch } from './import-match'

describe('match patterns in an imported file (#56)', () => {
  it.each([
    ['empty', ''],
    ['a pattern for every site', '<all_urls>'],
    ['a bare wildcard scheme, host and path', '*://*/*'],
    ['a wildcard host with a scheme', 'https://*/*'],
    ['a wildcard host with no scheme', '*/*'],
    ['a top-level domain wildcard', '*://*.com/*'],
    ['a two-label public suffix wildcard', '*://*.co.uk/*'],
    ['a hosting suffix wildcard', '*://*.github.io/*'],
    ['a scheme the extension does not run on', 'ftp://example.com/*'],
    ['a wildcard inside the host', '*://shop*.example.com/*'],
    ['a host with a port', '*://localhost:3000/*'],
    ['a wildcard in front of an address', '*://*.10.0.0.1/*'],
    ['a single label that is not localhost', '*://intranet/*'],
  ])('refuses %s', (_label, pattern) => {
    expect(assessMatch(pattern).ok).toBe(false)
  })

  it.each([
    ['https://example.com/*', 'Every page on example.com, over https only'],
    ['*://*.example.com/*', 'Every page on example.com and all its subdomains, over http and https'],
    ['example.com/*', 'Every page on example.com, over http and https'],
    ['http://example.com/news*', 'Pages whose address starts with /news on example.com, over plain http only'],
    ['https://example.com/watch?v=1', 'The page /watch?v=1 on example.com, over https only'],
    ['*://localhost/*', 'Every page on localhost, over http and https'],
    ['*://*.example.co.uk/*', 'Every page on example.co.uk and all its subdomains, over http and https'],
    ['*://192.168.0.1/*', 'Every page on 192.168.0.1, over http and https'],
  ])('accepts %s and describes its sites (control)', (pattern, sites) => {
    expect(assessMatch(pattern)).toEqual({ ok: true, sites })
  })
})
