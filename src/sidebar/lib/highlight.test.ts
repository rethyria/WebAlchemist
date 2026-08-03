import { describe, expect, it } from 'vitest'
import { highlight, type Token } from './highlight'

const text = (tokens: Token[]) => tokens.map((token) => token.text).join('')

const kindsOf = (tokens: Token[], value: string) =>
  tokens.filter((token) => token.text.includes(value)).map((token) => token.kind)

describe('highlight', () => {
  /*
   * The load-bearing property. This code is shown to someone deciding whether
   * to let it run on their pages; a highlighter that drops or reorders a
   * character would be showing them something other than what executes.
   */
  describe('never alters the text', () => {
    const samples: [string, 'css' | 'js'][] = [
      ['.a { color: red }', 'css'],
      ['/* note */\n.a,\n.b > .c:hover { --x: 1px; content: "}" }', 'css'],
      ['@media (min-width: 40em) { .a { top: 0 } }', 'css'],
      ['.a{}', 'css'],
      ['/* unterminated', 'css'],
      ['const a = "x"; // trailing', 'js'],
      ['if (a === 1) { return `t${b}` }', 'js'],
      ["const s = 'unterminated", 'js'],
      ['const re = 1 / 2 / 3', 'js'],
      ['', 'css'],
      ['', 'js'],
      ['\n\n', 'css'],
      ['}}}{{{', 'css'],
    ]

    for (const [source, kind] of samples) {
      it(`round-trips ${kind}: ${JSON.stringify(source.slice(0, 32))}`, () => {
        expect(text(highlight(source, kind))).toBe(source)
      })
    }

    it('round-trips a realistic generated transform', () => {
      const css = [
        '/* dark background, reply lines kept */',
        '.comment-tree {',
        '  background: #14161a !important;',
        '  color: #e6e8ea;',
        '}',
        '.comment-tree .thread-line { border-color: #3a4048 }',
      ].join('\n')
      expect(text(highlight(css, 'css'))).toBe(css)
    })
  })

  it('separates selector, property, and value in CSS', () => {
    const tokens = highlight('.a { color: red; }', 'css')
    expect(kindsOf(tokens, '.a')).toContain('selector')
    expect(kindsOf(tokens, 'color')).toContain('property')
    expect(kindsOf(tokens, 'red')).toContain('value')
  })

  it('does not treat a value inside a block as a selector', () => {
    const tokens = highlight('.a { background: url(x) }', 'css')
    expect(kindsOf(tokens, 'url(x)')).not.toContain('selector')
  })

  it('marks JS keywords and strings', () => {
    const tokens = highlight('const name = "x"', 'js')
    expect(kindsOf(tokens, 'const')).toContain('keyword')
    expect(kindsOf(tokens, '"x"')).toContain('string')
  })

  it('does not mark an identifier that merely contains a keyword', () => {
    const tokens = highlight('constant', 'js')
    expect(tokens).toEqual([{ text: 'constant', kind: 'plain' }])
  })

  it('collapses runs of the same kind', () => {
    const tokens = highlight('a b c', 'js')
    expect(tokens).toHaveLength(1)
  })
})
