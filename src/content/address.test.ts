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

describe('where the address is used', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8')

  it('is the only form extractContext puts in the context', () => {
    const source = read('content/context.ts')
    expect(source).toMatch(/url: addressForModel\(location\.href\)/)
    expect(source).not.toMatch(/url: location\.href/)
  })

  it('is shown in the describing panel from the context that will be sent', () => {
    expect(read('sidebar/App.svelte')).toMatch(/sentAddress=\{flow\.picked\.context\.url\}/)
    expect(read('sidebar/components/Describing.svelte')).toMatch(/\{sentAddress\}/)
  })
})
