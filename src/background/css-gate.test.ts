import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { checkCssForPage, checkCssTransform, pageUrlFor } from './css-gate'

describe('pageUrlFor', () => {
  it('uses the tab address when there is one', () => {
    expect(pageUrlFor('https://shop.example.com/*', 'https://shop.example.com/cart')).toBe(
      'https://shop.example.com/cart',
    )
  })

  it('builds the address from a pattern with no scheme', () => {
    expect(pageUrlFor('shop.example.com/*')).toBe('https://shop.example.com/')
    expect(pageUrlFor('*.example.com/*')).toBe('https://example.com/')
  })

  it('builds the address from a pattern with a scheme (#50)', () => {
    // Before the fix both gave https://https:/.
    expect(pageUrlFor('https://shop.example.com/*')).toBe('https://shop.example.com/')
    expect(pageUrlFor('*://*.example.com/*')).toBe('https://example.com/')
  })

  it('gives nothing for a pattern with no fixed host', () => {
    expect(pageUrlFor('https://*/foo')).toBeUndefined()
  })
})

describe('checkCssForPage with a page taken from a scheme-prefixed pattern (#50)', () => {
  const settings = { ...DEFAULT_SETTINGS, cssUrlPolicy: { 'shop.example.com': 'same-origin' as const } }

  it('allows an approved external address when the site lists external addresses', () => {
    const listing = { ...DEFAULT_SETTINGS, cssUrlPolicy: { 'shop.example.com': 'list-external' as const } }
    const page = pageUrlFor('https://shop.example.com/*')
    const css = 'a { background: url(https://cdn.example/x.png) }'
    expect(checkCssForPage(css, listing, page, ['https://cdn.example/x.png']).passed).toBe(true)
    expect(checkCssForPage(css, listing, page, undefined).passed).toBe(false)
  })

  it('allows a same-origin address', () => {
    const page = pageUrlFor('https://shop.example.com/*')
    expect(checkCssForPage('a { background: url(/bg.png) }', settings, page, undefined).passed).toBe(true)
  })

  it('still refuses an address on another origin (control)', () => {
    const page = pageUrlFor('https://shop.example.com/*')
    expect(checkCssForPage('a { background: url(https://evil.example/t) }', settings, page, undefined).passed).toBe(false)
  })
})

describe('checkCssTransform with settings', () => {
  const field = { key: 'u', label: 'U', type: 'text' as const, default: 'data:image/png;base64,AAAA' }
  const base = { code: 'a { background: image-set(var(--setting-u)) }', match: 'shop.example.com/*', configFields: [field] }

  it('checks the CSS with the value put in, so a harmless value passes', () => {
    expect(checkCssTransform(base, DEFAULT_SETTINGS).passed).toBe(true)
  })

  it('refuses the same CSS when the value is an external address', () => {
    const result = checkCssTransform({ ...base, configValues: { u: 'https://evil.example/t.png' } }, DEFAULT_SETTINGS)
    expect(result.passed).toBe(false)
    expect(result.static.some((finding) => finding.severity === 'block')).toBe(true)
  })

  it('does not take a value that fails its field into account', () => {
    expect(checkCssTransform({ ...base, configValues: { u: 5 as never } }, DEFAULT_SETTINGS).passed).toBe(true)
  })
})
