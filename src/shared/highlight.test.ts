import { describe, expect, test } from 'vitest'
import { highlight, type Token } from './highlight'

const kindsOf = (tokens: Token[], text: string): string[] =>
  tokens.filter((t) => t.text === text).map((t) => t.kind)

/**
 * The property every case depends on. The coloured runs are laid under a
 * transparent textarea, so losing or adding a single character anywhere would
 * slide the two out of alignment for the rest of the document.
 */
const roundTrips = (code: string, kind: 'css' | 'js'): boolean =>
  highlight(code, kind)
    .map((t) => t.text)
    .join('') === code

describe('highlight, both languages', () => {
  const samples: [string, 'css' | 'js'][] = [
    ['.a { color: red }', 'css'],
    ['const x = 1 // hi\n', 'js'],
    ['', 'css'],
    ['   \n\t  ', 'js'],
    ['/* unterminated', 'css'],
    ['"unterminated', 'js'],
    ['const s = `a ${b} c`', 'js'],
    ['@media (min-width: 600px) { .a { color: #fff } }', 'css'],
    ['🎨 const emoji = "→"', 'js'],
    ['a{b:c}d{e:f}', 'css'],
  ]

  for (const [code, kind] of samples) {
    test(`puts every character back: ${kind} ${JSON.stringify(code.slice(0, 24))}`, () => {
      expect(roundTrips(code, kind)).toBe(true)
    })
  }

  /* Half-typed input is the normal state of an editor, not an edge case. */
  test('survives code that is not valid at all', () => {
    for (const partial of ['const x = {', 'function f(', '.a { color:', '@med', '}}}']) {
      expect(roundTrips(partial, 'js')).toBe(true)
      expect(roundTrips(partial, 'css')).toBe(true)
    }
  })
})

describe('highlight, javascript', () => {
  test('marks keywords, and only real ones', () => {
    const tokens = highlight('const alpha = function () { return 1 }', 'js')
    expect(kindsOf(tokens, 'const')).toEqual(['keyword'])
    expect(kindsOf(tokens, 'function')).toEqual(['keyword'])
    expect(kindsOf(tokens, 'return')).toEqual(['keyword'])
    // An identifier that merely looks wordy is not a keyword.
    expect(kindsOf(tokens, 'alpha')).toEqual(['text'])
  })

  test('does not colour keywords inside strings or comments', () => {
    const tokens = highlight('// const a\nconst b = "const c"', 'js')
    expect(kindsOf(tokens, 'const')).toEqual(['keyword'])
    expect(tokens.some((t) => t.kind === 'comment' && t.text.includes('const a'))).toBe(true)
    expect(tokens.some((t) => t.kind === 'string' && t.text === '"const c"')).toBe(true)
  })

  test('reads numbers in the forms code actually uses', () => {
    const tokens = highlight('0xFF + 1.5e3 + .5 + 10n', 'js')
    const numbers = tokens.filter((t) => t.kind === 'number').map((t) => t.text)
    expect(numbers).toEqual(['0xFF', '1.5e3', '.5', '10n'])
  })
})

describe('highlight, css', () => {
  test('tells a property from a value by where it sits', () => {
    const tokens = highlight('.card { color: red }', 'css')
    expect(kindsOf(tokens, 'color')).toEqual(['property'])
    expect(kindsOf(tokens, 'red')).toEqual(['text'])
  })

  test('the same word is a selector outside a block', () => {
    const tokens = highlight('color { color: color }', 'css')
    expect(kindsOf(tokens, 'color')).toEqual(['selector', 'property', 'text'])
  })

  test('marks at-rules and !important', () => {
    const tokens = highlight('@media print { a { color: red !important } }', 'css')
    expect(kindsOf(tokens, '@media')).toEqual(['keyword'])
    expect(kindsOf(tokens, '!important')).toEqual(['keyword'])
  })

  test('reads colours and dimensions as numbers', () => {
    const tokens = highlight('a { margin: 10px; color: #ff0000 }', 'css')
    const numbers = tokens.filter((t) => t.kind === 'number').map((t) => t.text)
    expect(numbers).toEqual(['10px', '#ff0000'])
  })
})
