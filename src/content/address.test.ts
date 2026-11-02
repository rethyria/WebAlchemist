/**
 * The page address sent to the model provider (#65).
 *
 * It used to be `location.href`, so query strings and fragments carrying access
 * tokens, reset codes and session identifiers were sent along.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addressForModel } from './context'

describe('the address sent to the provider', () => {
  it('keeps the origin and the path', () => {
    expect(addressForModel('https://example.com/docs/page')).toBe('https://example.com/docs/page')
  })

  it('drops the fragment, including one that carries a token', () => {
    const sent = addressForModel('https://app.example.com/cb#access_token=SECRET-TOKEN&type=bearer')
    expect(sent).toBe('https://app.example.com/cb')
    expect(sent).not.toContain('SECRET')
  })

  it('keeps query keys and replaces every value', () => {
    const sent = addressForModel('https://example.com/reset?token=SECRET-TOKEN&tab=billing&token=SECOND')
    expect(sent).toBe('https://example.com/reset?token=[removed]&tab=[removed]')
    expect(sent).not.toContain('SECRET')
    expect(sent).not.toContain('billing')
    expect(sent).not.toContain('SECOND')
  })

  it('drops a user name and password', () => {
    expect(addressForModel('https://user:PASS@example.com/a')).toBe('https://example.com/a')
  })

  it('keeps a port, which is part of the origin', () => {
    expect(addressForModel('http://localhost:8080/x?a=1')).toBe('http://localhost:8080/x?a=[removed]')
  })

  it('does not send the contents of a data address', () => {
    expect(addressForModel('data:text/html,SECRET')).toBe('data:')
  })

  it('sends nothing for text that is not an address', () => {
    expect(addressForModel('not a url')).toBe('')
  })

  it('control: a key containing characters that need escaping stays one key', () => {
    expect(addressForModel('https://e.com/?a%26b=1')).toBe('https://e.com/?a%26b=[removed]')
  })
})

/*
 * A query with no "=" is a bare string, and the whole string used to be sent as
 * a key (#65). Path parameters and long identifiers in the path were sent too.
 */
describe('tokens that are not query values', () => {
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9SECRETTOKEN'

  it('drops a bare query string instead of sending it as a key', () => {
    const sent = addressForModel(`https://example.com/cb?${TOKEN}`)
    expect(sent).toBe('https://example.com/cb')
    expect(sent).not.toContain('SECRET')
  })

  it('drops a bare key among keyed ones and keeps the rest', () => {
    expect(addressForModel('https://example.com/s?q=1&flag&page=2')).toBe(
      'https://example.com/s?q=[removed]&page=[removed]',
    )
  })

  it('drops a key longer than 32 characters', () => {
    const long = 'k'.repeat(33)
    expect(addressForModel(`https://example.com/?${long}=1&tab=2`)).toBe('https://example.com/?tab=[removed]')
  })

  it('drops a key that looks like a token even when it is short enough', () => {
    const key = 'a1b2c3d4e5f6a7b8c9d0e1f2'
    expect(addressForModel(`https://example.com/?${key}=1`)).toBe('https://example.com/')
  })

  it('control: a key of exactly 32 characters and an ordinary key are kept', () => {
    const edge = 'k'.repeat(32)
    expect(addressForModel(`https://example.com/?${edge}=1&sort_order=2`)).toBe(
      `https://example.com/?${edge}=[removed]&sort_order=[removed]`,
    )
  })
})

describe('path parameters and identifiers in the path', () => {
  it('removes a ;name=value path parameter', () => {
    const sent = addressForModel('https://example.com/app;jsessionid=ABC123/home')
    expect(sent).toBe('https://example.com/app/home')
    expect(sent).not.toContain('ABC')
  })

  it('removes a path parameter on the last segment', () => {
    expect(addressForModel('https://example.com/a/b;v=1;w=2')).toBe('https://example.com/a/b')
  })

  it('replaces a segment longer than 32 characters', () => {
    expect(addressForModel(`https://example.com/u/${'x'.repeat(33)}/edit`)).toBe(
      'https://example.com/u/[removed]/edit',
    )
  })

  it('replaces a segment with a long run of digits', () => {
    expect(addressForModel('https://example.com/orders/84736251946/view')).toBe(
      'https://example.com/orders/[removed]/view',
    )
  })

  it('replaces a segment that looks like a base64 or hex token', () => {
    expect(addressForModel('https://example.com/reset/Zm9vYmFyMTIzNDU2Nzg5MA/x')).toBe(
      'https://example.com/reset/[removed]/x',
    )
    expect(addressForModel('https://example.com/f/9f86d081884c7d659a2f/x')).toBe(
      'https://example.com/f/[removed]/x',
    )
  })

  it('control: ordinary segments, a year, a short number and a long word slug are kept', () => {
    expect(addressForModel('https://example.com/blog/2024/10/how-to-make-a-good-cup-of-tea')).toBe(
      'https://example.com/blog/2024/10/how-to-make-a-good-cup-of-tea',
    )
    expect(addressForModel('https://example.com/item/12345/')).toBe('https://example.com/item/12345/')
    expect(addressForModel(`https://example.com/${'y'.repeat(32)}`)).toBe(
      `https://example.com/${'y'.repeat(32)}`,
    )
  })
})

describe('addresses that are not http or https', () => {
  it('sends only the scheme for a file address', () => {
    const sent = addressForModel('file:///home/alice/secret-project/notes.html?x=1')
    expect(sent).toBe('file:')
    expect(sent).not.toContain('alice')
  })

  it('sends only the scheme for a blob address, with no garbled origin or path', () => {
    expect(addressForModel('blob:https://example.com/3b1d6c0e-1111-2222-3333-444455556666')).toBe('blob:')
  })

  it.each(['ftp://host/pub/a.txt', 'about:blank', 'moz-extension://abc/page.html'])(
    'sends only the scheme for %s',
    (href) => {
      expect(addressForModel(href)).toMatch(/^[a-z-]+:$/)
    },
  )

  it('control: http and https keep their origin and path', () => {
    expect(addressForModel('http://example.com/a')).toBe('http://example.com/a')
    expect(addressForModel('https://example.com/a')).toBe('https://example.com/a')
  })
})

describe('the panel says what is removed', () => {
  it('lists every removal the function makes, with the same limit', async () => {
    const { ADDRESS_REMOVAL_NOTE } = await import('@shared/address-policy')
    for (const phrase of [
      'the part after #',
      'user name and password',
      'query values',
      'query keys with no value',
      'longer than 32 characters',
      'anything after a semicolon in the path',
      'path parts',
      'only the type of address',
    ]) {
      expect(ADDRESS_REMOVAL_NOTE).toContain(phrase)
    }
  })

  it('is rendered by the component the describing panel uses', () => {
    const component = readFileSync(
      resolve(__dirname, '..', 'sidebar/components/AddressNote.svelte'),
      'utf8',
    )
    expect(component).toContain('ADDRESS_REMOVAL_NOTE')
  })
})

describe('where the address is used', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8')

  it('is the only form extractContext puts in the context', () => {
    const source = read('content/context.ts')
    expect(source).toMatch(/url: addressForModel\(location\.href\)/)
    expect(source).not.toMatch(/url: location\.href/)
  })

  it('is shown on the generating and refining panels, which cover Repair and Edit with AI', () => {
    const app = read('sidebar/App.svelte')
    expect(app).toMatch(/<Generating[\s\S]*?sentAddress=\{flow\.sentAddress\}[\s\S]*?\/>/)
    expect(app).toMatch(/<Refining[\s\S]*?sentAddress=\{flow\.sentAddress\}[\s\S]*?\/>/)
    expect(read('sidebar/components/Generating.svelte')).toMatch(/<AddressNote address=\{sentAddress\}/)
    expect(read('sidebar/components/Refining.svelte')).toMatch(/<AddressNote address=\{sentAddress\}/)
  })

  it('is shown in the describing panel from the context that will be sent', () => {
    expect(read('sidebar/App.svelte')).toMatch(/sentAddress=\{flow\.sentAddress\}/)
    expect(read('sidebar/components/Describing.svelte')).toMatch(/<AddressNote address=\{sentAddress\}/)
    expect(read('sidebar/components/AddressNote.svelte')).toMatch(/addressSentSummary', address\)/)
  })
})
