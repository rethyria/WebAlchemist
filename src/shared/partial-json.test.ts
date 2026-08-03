import { describe, expect, it } from 'vitest'
import { extractPartialString } from './partial-json'

describe('extractPartialString', () => {
  it('returns null before the key has arrived', () => {
    expect(extractPartialString('{"name":"x"', 'code')).toBeNull()
    expect(extractPartialString('', 'code')).toBeNull()
    expect(extractPartialString('{"co', 'code')).toBeNull()
  })

  it('returns null when the value has not started', () => {
    expect(extractPartialString('{"code"', 'code')).toBeNull()
    expect(extractPartialString('{"code":', 'code')).toBeNull()
    expect(extractPartialString('{"code": ', 'code')).toBeNull()
  })

  it('reads a value still being written', () => {
    expect(extractPartialString('{"code":"body {', 'code')).toBe('body {')
  })

  it('reads a complete value and stops at the closing quote', () => {
    expect(extractPartialString('{"code":"a","name":"b"}', 'code')).toBe('a')
  })

  it('tolerates whitespace around the colon', () => {
    expect(extractPartialString('{"code"  :  "x', 'code')).toBe('x')
  })

  it('decodes the escapes that appear in generated code', () => {
    expect(extractPartialString('{"code":"a\\nb', 'code')).toBe('a\nb')
    expect(extractPartialString('{"code":"say \\"hi\\"', 'code')).toBe('say "hi"')
    expect(extractPartialString('{"code":"back\\\\slash', 'code')).toBe('back\\slash')
    expect(extractPartialString('{"code":"tab\\there', 'code')).toBe('tab\there')
  })

  it('decodes unicode escapes', () => {
    expect(extractPartialString('{"code":"\\u00e9t\\u00e9', 'code')).toBe('été')
  })

  /*
   * The cases that matter most: a chunk boundary can land anywhere, including
   * the middle of an escape sequence. Emitting a guess would briefly show a
   * character the model never sent.
   */
  it('drops a trailing incomplete escape rather than guessing', () => {
    expect(extractPartialString('{"code":"a\\', 'code')).toBe('a')
    expect(extractPartialString('{"code":"a\\u', 'code')).toBe('a')
    expect(extractPartialString('{"code":"a\\u00', 'code')).toBe('a')
    expect(extractPartialString('{"code":"a\\u00e', 'code')).toBe('a')
  })

  it('completes that escape once the rest arrives', () => {
    expect(extractPartialString('{"code":"a\\u00e9', 'code')).toBe('aé')
  })

  it('does not confuse a similarly named key', () => {
    const json = '{"encoded":"wrong","code":"right'
    expect(extractPartialString(json, 'code')).toBe('right')
  })

  it('grows monotonically as chunks arrive', () => {
    const full = '{"code":"line one\\nline two"}'
    let previous = ''
    for (let i = 1; i <= full.length; i += 1) {
      const partial = extractPartialString(full.slice(0, i), 'code') ?? ''
      // Never goes backwards, which is what makes it safe to render directly.
      expect(partial.startsWith(previous) || previous.startsWith(partial)).toBe(true)
      if (partial.length >= previous.length) previous = partial
    }
    expect(previous).toBe('line one\nline two')
  })
})
