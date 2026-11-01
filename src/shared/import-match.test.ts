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
    ['the same suffix in capitals', '*://*.CO.UK/*'],
    ['a hosting suffix wildcard', '*://*.github.io/*'],
    ['a suffix that is on no list, as a wildcard', '*://*.example.com.au.zz/*'],
    ['a wildcard in front of an ordinary site', '*://*.example.com/*'],
    ['localhost', '*://localhost/*'],
    ['localhost in capitals', '*://LOCALHOST/*'],
    ['a subdomain of localhost', '*://app.localhost/*'],
    ['a .local name', '*://printer.local/*'],
    ['an .internal name', '*://wiki.internal/*'],
    ['a loopback address', '*://127.0.0.1/*'],
    ['another loopback address', '*://127.1.2.3/*'],
    ['an address in 10.0.0.0/8', '*://10.1.2.3/*'],
    ['an address in 172.16.0.0/12', '*://172.20.0.1/*'],
    ['an address in 192.168.0.0/16', '*://192.168.0.1/*'],
    ['a link-local address', '*://169.254.169.254/*'],
    ['an address in the shared range 100.64.0.0/10', '*://100.64.0.1/*'],
    ['the address 0.0.0.0', '*://0.0.0.0/*'],
    ['a loopback address in octal form', '*://0177.0.0.1/*'],
    ['a loopback address as one decimal number', '*://2130706433/*'],
    ['a loopback address in hexadecimal', '*://0x7f.0.0.1/*'],
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
    ['example.com/*', 'Every page on example.com, over http and https'],
    ['http://example.com/news*', 'Pages whose address starts with /news on example.com, over plain http only'],
    ['https://example.com/watch?v=1', 'The page /watch?v=1 on example.com, over https only'],
    ['https://Example.COM/*', 'Every page on example.com, over https only'],
    ['*://example.co.uk/*', 'Every page on example.co.uk, over http and https'],
    ['*://8.8.8.8/*', 'Every page on 8.8.8.8, over http and https'],
    ['*://172.32.0.1/*', 'Every page on 172.32.0.1, over http and https'],
    ['*://172.15.0.1/*', 'Every page on 172.15.0.1, over http and https'],
    ['*://100.63.0.1/*', 'Every page on 100.63.0.1, over http and https'],
  ])('accepts %s and describes its sites (control)', (pattern, sites) => {
    expect(assessMatch(pattern)).toEqual({ ok: true, sites })
  })
})
