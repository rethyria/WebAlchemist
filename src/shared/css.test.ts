import { describe, expect, test } from 'vitest'
import { parseRules, propertiesIn } from './css'

describe('parseRules', () => {
  test('reads selectors and properties from an ordinary rule', () => {
    const rules = parseRules('.comment { color: red; background: blue }')
    expect(rules).toHaveLength(1)
    expect(rules[0]?.selectors).toEqual(['.comment'])
    expect(rules[0]?.declarations.map((d) => d.property)).toEqual(['color', 'background'])
  })

  test('splits a selector list', () => {
    const rules = parseRules('a, b.c , d > e { color: red }')
    expect(rules[0]?.selectors).toEqual(['a', 'b.c', 'd > e'])
  })

  test('does not split commas inside :is() or an attribute selector', () => {
    const rules = parseRules(':is(a, b) [title="x,y"] { color: red }')
    expect(rules[0]?.selectors).toEqual([':is(a, b) [title="x,y"]'])
  })

  test('collapses whitespace in a selector so two spellings compare equal', () => {
    const a = parseRules('div   >   p { color: red }')
    const b = parseRules('div > p { color: red }')
    expect(a[0]?.selectors).toEqual(b[0]?.selectors)
  })

  test('notices !important, which decides who actually wins', () => {
    const rules = parseRules('a { color: red !important; background: blue }')
    expect(rules[0]?.declarations).toEqual([
      { property: 'color', important: true },
      { property: 'background', important: false },
    ])
  })

  test('drops comments, including ones inside a block', () => {
    const rules = parseRules('/* hi */ a { color: red; /* nope: green */ }')
    expect(rules[0]?.declarations.map((d) => d.property)).toEqual(['color'])
  })

  /*
   * The cases a naive split on ';' and ':' gets wrong. All three appear in
   * real stylesheets, and each would otherwise produce a phantom property.
   */
  test('survives semicolons and colons inside values', () => {
    const rules = parseRules(
      'a { background: url(data:image/svg+xml;base64,AAA); content: ";"; color: red }',
    )
    expect(rules[0]?.declarations.map((d) => d.property)).toEqual([
      'background',
      'content',
      'color',
    ])
  })

  test('descends into @media rather than ignoring what is inside it', () => {
    const rules = parseRules('@media (min-width: 600px) { .a { color: red } }')
    expect(rules).toHaveLength(1)
    expect(rules[0]?.selectors).toEqual(['.a'])
  })

  test('drops @keyframes, whose inner blocks are not element rules', () => {
    const rules = parseRules('@keyframes spin { from { opacity: 0 } to { opacity: 1 } }')
    expect(rules).toEqual([])
  })

  test('ignores a statement at-rule', () => {
    const rules = parseRules('@import url(x.css); .a { color: red }')
    expect(rules).toHaveLength(1)
    expect(rules[0]?.selectors).toEqual(['.a'])
  })

  test('keeps custom properties, which cascade like any other', () => {
    const rules = parseRules(':root { --accent: red }')
    expect(rules[0]?.declarations[0]?.property).toBe('--accent')
  })

  test('returns nothing for an empty or unreadable sheet', () => {
    expect(parseRules('')).toEqual([])
    expect(parseRules('this is not css')).toEqual([])
    expect(parseRules('.a { }')).toEqual([])
  })
})

describe('propertiesIn', () => {
  test('collects every property set anywhere in the sheet', () => {
    expect(propertiesIn('.a { color: red } @media print { .b { color: blue; margin: 0 } }')).toEqual(
      new Set(['color', 'margin']),
    )
  })
})

describe('a comment marker inside a string or an unquoted url (#97)', () => {
  const sheet = 'a { content: "/*"; color: red } b { margin: 0 } /* x */'

  test('does not hide the rules after it', () => {
    const rules = parseRules(sheet)
    expect(rules.map((r) => r.selectors[0])).toEqual(['a', 'b'])
    expect(rules[0]?.declarations.map((d) => d.property)).toEqual(['content', 'color'])
    expect(rules[1]?.declarations.map((d) => d.property)).toEqual(['margin'])
  })

  test('works with single quotes and an escaped quote before the marker', () => {
    const rules = parseRules(`a { content: '/*'; color: red } b { margin: 0 } /* x */`)
    expect(rules.map((r) => r.selectors[0])).toEqual(['a', 'b'])
    const escaped = parseRules('a { content: "\\"/*"; color: red } b { margin: 0 } /* x */')
    expect(escaped.map((r) => r.selectors[0])).toEqual(['a', 'b'])
  })

  test('does not read a comment marker in an unquoted url', () => {
    const rules = parseRules('a { background: url(a/*b); color: red } b { margin: 0 } /* x */')
    expect(rules.map((r) => r.selectors[0])).toEqual(['a', 'b'])
  })

  test('still removes real comments, including one that follows a string', () => {
    const rules = parseRules('a { content: "x" /* gone: green */; color: red }')
    expect(rules[0]?.declarations.map((d) => d.property)).toEqual(['content', 'color'])
  })

  test('control: a comment marker outside any string still starts a comment', () => {
    // Shows the fix did not stop comments from being removed: this rule is
    // inside a comment and must not be read.
    const rules = parseRules('/* a { color: red } */ b { margin: 0 }')
    expect(rules.map((r) => r.selectors[0])).toEqual(['b'])
  })

  test('treats an unterminated comment as running to the end', () => {
    const rules = parseRules('a { color: red } /* b { margin: 0 }')
    expect(rules.map((r) => r.selectors[0])).toEqual(['a'])
  })
})
