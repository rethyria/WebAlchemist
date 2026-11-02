import { describe, expect, it } from 'vitest'
import {
  CONFIG_LIMITS,
  checkValueSet,
  configReferences,
  cssValueText,
  cssWithConfig,
  effectiveValues,
  parseConfigFields,
  reconcileValues,
  scriptLiteral,
  validateValue,
} from './config'
import type { ConfigField } from './types'

const text = (key: string, def = ''): ConfigField => ({ key, label: key, type: 'text', default: def })
const table: ConfigField = {
  key: 'words',
  label: 'Words',
  type: 'table',
  columns: [
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' },
  ],
  default: [{ from: 'a', to: 'b' }],
}
const number: ConfigField = { key: 'size', label: 'Size', type: 'number', default: 10, min: 1, max: 20, unit: 'px' }
const choice: ConfigField = {
  key: 'mode',
  label: 'Mode',
  type: 'choice',
  options: [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ],
  default: 'dark',
}
const colour: ConfigField = { key: 'tint', label: 'Tint', type: 'colour', default: '#ffcc00' }

describe('parseConfigFields', () => {
  it('accepts valid fields of every type and copies only known properties', () => {
    const raw = [text('a', 'x'), table, number, choice, colour, { key: 'on', label: 'On', type: 'yes-no', default: true }, { key: 'l', label: 'L', type: 'list', default: ['a'] }]
    const { fields, problems } = parseConfigFields(raw.map((f) => ({ ...f, extra: 'x' })))
    expect(problems).toEqual([])
    expect(fields).toEqual(raw)
    expect(fields[0]).not.toHaveProperty('extra')
  })

  it.each(['__proto__', 'constructor', 'Upper', '1a', 'a-b', '', 'a'.repeat(33), 'prototype ', 'a.b', 'toString', 'valueOf', 'hasOwnProperty'])(
    'drops the key %j',
    (key) => {
      const { fields, problems } = parseConfigFields([{ ...text('x'), key }])
      expect(fields).toEqual([])
      expect(problems).toHaveLength(1)
    },
  )

  it('drops a duplicate key and keeps the first', () => {
    const { fields, problems } = parseConfigFields([text('a', '1'), text('a', '2')])
    expect(fields.map((f) => f.default)).toEqual(['1'])
    expect(problems).toHaveLength(1)
  })

  it('keeps at most 20 fields', () => {
    const many = Array.from({ length: 25 }, (_, i) => text(`k${i}`))
    expect(parseConfigFields(many).fields).toHaveLength(20)
  })

  it('enforces label, help, option, column and range limits', () => {
    const cases: unknown[] = [
      { ...text('a'), label: '' },
      { ...text('a'), label: 'x'.repeat(61) },
      { ...text('a'), help: 'x'.repeat(201) },
      { ...choice, options: [{ value: 'a', label: 'A' }] },
      { ...choice, options: Array.from({ length: 21 }, (_, i) => ({ value: `v${i}`, label: 'x' })) },
      { ...choice, options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] },
      { ...choice, default: 'other' },
      { ...table, columns: [] },
      { ...table, columns: Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, label: 'x' })), default: [] },
      { ...table, columns: [{ key: 'Bad', label: 'x' }], default: [] },
      { ...number, min: 5, max: 1 },
      { ...number, step: 0 },
      { ...number, unit: 'cm' },
      { ...number, default: 99 },
      { ...text('a'), type: 'other' },
    ]
    for (const bad of cases) expect(parseConfigFields([bad]).fields).toEqual([])
  })

  it('applies the value limits to defaults', () => {
    expect(parseConfigFields([text('a', 'x'.repeat(2001))]).fields).toEqual([])
    expect(parseConfigFields([text('a', 'a\nb')]).fields).toEqual([])
    expect(parseConfigFields([{ key: 'l', label: 'L', type: 'list', default: Array(1001).fill('x') }]).fields).toEqual([])
  })

  it('drops a field whose default would take the defaults over 64 KB', () => {
    const big = (key: string): ConfigField => ({ key, label: key, type: 'list', default: Array(1000).fill('y'.repeat(30)) })
    const { fields } = parseConfigFields([big('a'), big('b')])
    expect(fields.map((f) => f.key)).toEqual(['a'])
  })

  it('treats a missing list as no fields', () => {
    expect(parseConfigFields(undefined)).toEqual({ fields: [], problems: [] })
    expect(parseConfigFields('x').fields).toEqual([])
  })
})

describe('validateValue', () => {
  it('checks each type', () => {
    expect(validateValue(text('a'), 'ok').ok).toBe(true)
    expect(validateValue(text('a'), 5).ok).toBe(false)
    expect(validateValue(text('a'), 'x'.repeat(2001)).ok).toBe(false)
    for (const c of ['\n', '\t', '\u0000', '\u2028', '\u007f']) expect(validateValue(text('a'), `a${c}b`).ok).toBe(false)
    expect(validateValue(number, 5).ok).toBe(true)
    expect(validateValue(number, 0).ok).toBe(false)
    expect(validateValue(number, 21).ok).toBe(false)
    expect(validateValue(number, NaN).ok).toBe(false)
    expect(validateValue(number, '5').ok).toBe(false)
    expect(validateValue(choice, 'light').ok).toBe(true)
    expect(validateValue(choice, 'blue').ok).toBe(false)
    expect(validateValue(colour, '#FFCC00')).toEqual({ ok: true, value: '#ffcc00' })
    expect(validateValue(colour, 'red').ok).toBe(false)
    expect(validateValue(colour, '#ffcc0').ok).toBe(false)
    expect(validateValue({ key: 'o', label: 'o', type: 'yes-no', default: false }, 'yes').ok).toBe(false)
  })

  it('checks list items and table rows', () => {
    const list: ConfigField = { key: 'l', label: 'l', type: 'list', default: [] }
    expect(validateValue(list, ['a', 'b']).ok).toBe(true)
    expect(validateValue(list, ['x'.repeat(501)]).ok).toBe(false)
    expect(validateValue(list, Array(1001).fill('a')).ok).toBe(false)
    expect(validateValue(table, [{ from: 'a', to: 'b' }]).ok).toBe(true)
    expect(validateValue(table, [{ from: 'a' }]).ok).toBe(false)
    expect(validateValue(table, [{ from: 'a', to: 'b', extra: 'c' }]).ok).toBe(false)
    expect(validateValue(table, [{ from: 'a', to: 5 }]).ok).toBe(false)
    expect(validateValue(table, [{ from: 'a', to: 'x'.repeat(501) }]).ok).toBe(false)
    expect(validateValue(table, JSON.parse('[{"__proto__": "x", "to": "y"}]')).ok).toBe(false)
    expect(validateValue(table, Array(1001).fill({ from: 'a', to: 'b' })).ok).toBe(false)
  })
})

describe('effectiveValues', () => {
  it('uses a default when there is no override or the override is invalid', () => {
    const fields = [text('a', 'dflt'), number]
    expect(effectiveValues(fields, {})).toEqual({ a: 'dflt', size: 10 })
    expect(effectiveValues(fields, { a: 'mine', size: 15 })).toEqual({ a: 'mine', size: 15 })
    expect(effectiveValues(fields, { a: 5, size: 999 })).toEqual({ a: 'dflt', size: 10 })
  })
  it('ignores overrides for keys that are not fields and inherited properties', () => {
    expect(effectiveValues([text('a', 'd')], { b: 'x', toString: 'y' })).toEqual({ a: 'd' })
    expect(effectiveValues([text('title', 'd')], { title: 'x' })).toEqual({ title: 'x' })
  })
})

describe('checkValueSet', () => {
  it('separates applied, skipped and unknown keys and keeps only valid values', () => {
    const set = checkValueSet([text('a'), number], { a: 'x', size: 99, nope: 1 })
    expect(set.values).toEqual({ a: 'x' })
    expect(set.applied).toEqual(['a'])
    expect(set.skipped.map((s) => s.key)).toEqual(['size'])
    expect(set.unknown).toEqual(['nope'])
  })
  it('refuses values over 64 KB in total', () => {
    const list: ConfigField = { key: 'l', label: 'l', type: 'list', default: [] }
    const set = checkValueSet([list, { ...list, key: 'm' }], { l: Array(1000).fill('x'.repeat(40)), m: Array(1000).fill('x'.repeat(40)) })
    expect(set.applied).toEqual([])
    expect(set.skipped).toHaveLength(1)
  })
})

describe('reconcileValues', () => {
  it('keeps a value for the same key and type that is still valid', () => {
    const r = reconcileValues([text('a')], [text('a', 'new')], { a: 'mine' })
    expect(r).toEqual({ values: { a: 'mine' }, notKept: [] })
  })
  it('drops a value when the type changes', () => {
    const r = reconcileValues([text('size')], [number], { size: 'big' })
    expect(r.values).toEqual({})
    expect(r.notKept).toEqual([{ key: 'size', label: 'size', reason: 'type' }])
  })
  it('drops a number that is out of the new range and a removed choice option', () => {
    expect(reconcileValues([number], [{ ...number, max: 5 }], { size: 15 }).notKept[0]?.reason).toBe('invalid')
    const fewer = { ...choice, options: [{ value: 'dark', label: 'D' }, { value: 'sepia', label: 'S' }] }
    expect(reconcileValues([choice], [fewer], { mode: 'light' }).notKept[0]?.reason).toBe('invalid')
  })
  it('drops a value whose field is removed', () => {
    const r = reconcileValues([text('a'), text('b')], [text('a')], { a: '1', b: '2' })
    expect(r.values).toEqual({ a: '1' })
    expect(r.notKept[0]).toMatchObject({ key: 'b', reason: 'removed' })
  })
  it('matches table cells by column key', () => {
    const next: ConfigField = {
      ...table,
      columns: [
        { key: 'to', label: 'To' },
        { key: 'note', label: 'Note' },
      ],
      default: [],
    }
    const r = reconcileValues([table], [next], { words: [{ from: 'a', to: 'b' }, { from: 'only', to: '' }] })
    expect(r.values).toEqual({ words: [{ to: 'b', note: '' }] })
  })
  it('does not keep a value for a key that was renamed', () => {
    const r = reconcileValues([text('a')], [text('b')], { a: 'x' })
    expect(r.values).toEqual({})
    expect(r.notKept[0]?.reason).toBe('removed')
  })
})

describe('scriptLiteral', () => {
  const evaluate = (fields: ConfigField[], overrides: unknown): Record<string, unknown> =>
    new Function(`return ${scriptLiteral(fields, overrides)}`)() as Record<string, unknown>

  it('builds a deeply frozen object', () => {
    const config = evaluate([table, text('t', 'x'), number], {})
    expect(Object.isFrozen(config)).toBe(true)
    const rows = config.words as Record<string, string>[]
    expect(Object.isFrozen(rows)).toBe(true)
    expect(Object.isFrozen(rows[0])).toBe(true)
    expect(config.size).toBe(10)
  })
  it('has no members for an elixir without fields', () => {
    expect(scriptLiteral([], {})).toBe('Object.freeze({})')
  })
  it('keeps hostile text inside the literal', () => {
    const hostile = ['"; throw 1; //', '\\', '*/ alert(1) /*', '\u2028\u2029', '</script><script>x()</script>', "'}); evil(); ({a:'", '${1+1}', '`']
    for (const value of hostile) {
      const config = evaluate([text('t')], { t: value.replace(/[\u2028\u2029]/g, 'x') })
      expect(config.t).toBe(value.replace(/[\u2028\u2029]/g, 'x'))
    }
    // U+2028 is refused as a value, and the literal falls back to the default.
    expect(evaluate([text('t', 'd')], { t: '\u2028' }).t).toBe('d')
    expect(scriptLiteral([text('t')], { t: '</script>' })).not.toContain('</script>')
  })
  it('keeps hostile cells inside the rows and writes no prototype key', () => {
    const config = evaluate([table], { words: [{ from: '"}, {from: "', to: '\\' }] })
    expect(config.words).toEqual([{ from: '"}, {from: "', to: '\\' }])
    expect(Object.getPrototypeOf(config)).toBe(Object.prototype)
    expect(Object.keys(config)).toEqual(['words'])
  })
  it('replaces an invalid stored value with the default', () => {
    expect(evaluate([number], { size: 'x" , evil: "' }).size).toBe(10)
  })
})

describe('configReferences', () => {
  it('finds property, string-index and destructured keys in JavaScript', () => {
    const refs = configReferences("const a = CONFIG.one; const b = CONFIG['two']; const { three, four: x } = CONFIG;", 'js')
    expect(refs.keys).toEqual(['one', 'two', 'three', 'four'])
    expect(refs.dynamic).toBe(false)
  })
  it('reports computed use and aliases as dynamic', () => {
    expect(configReferences('CONFIG[k]', 'js').dynamic).toBe(true)
    expect(configReferences('const c = CONFIG; c.x', 'js').dynamic).toBe(true)
    expect(configReferences('f(CONFIG)', 'js').dynamic).toBe(true)
  })
  it('finds var references in CSS and ignores strings and comments', () => {
    const css = `a { color: var(--setting-tint); content: "var(--setting-hidden)"; /* var(--setting-gone) */ margin: var( --setting-size ) }`
    expect(configReferences(css, 'css').keys).toEqual(['tint', 'size'])
  })
  it('reports a fallback', () => {
    const refs = configReferences('a { color: var(--setting-tint, red) }', 'css')
    expect(refs.keys).toEqual(['tint'])
    expect(refs.withFallback).toEqual(['tint'])
  })
})

describe('cssWithConfig', () => {
  const fields = [colour, number, choice, text('label', 'hi')]
  it('replaces exact references with serialised values', () => {
    const css = 'a { color: var(--setting-tint); width: var(--setting-size); display: var(--setting-mode); content: var(--setting-label) }'
    expect(cssWithConfig(css, fields, { tint: '#00FF00', size: 12 })).toBe(
      'a { color: #00ff00; width: 12px; display: dark; content: "hi" }',
    )
  })
  it('keeps hostile text in one string', () => {
    const hostile = '"; } x { background: url(https://e.example) } y { content: "'
    const out = cssWithConfig('a { content: var(--setting-label) }', fields, { label: hostile })
    expect(out).toBe('a { content: "\\22 ; } x { background: url(https://e.example) } y { content: \\22 " }')
    expect(cssValueText(text('t'), 'a\\b"c')).toBe('"a\\5c b\\22 c"')
  })
  it('writes no exponent for a number', () => {
    const tiny: ConfigField = { key: 'n', label: 'n', type: 'number', default: 1e-7 }
    expect(cssValueText(tiny, 1e-7)).toBe('0.0000001')
    expect(cssValueText({ ...tiny, default: 0 }, -0)).toBe('0')
  })
  it('leaves strings, comments, fallbacks and unknown keys alone', () => {
    const css = 'a { content: "var(--setting-tint)"; /* var(--setting-tint) */ color: var(--setting-tint, red); margin: var(--setting-nope) }'
    expect(cssWithConfig(css, fields, {})).toBe(css)
  })
  it('does not replace a list, a table or a yes-no field', () => {
    const css = 'a { content: var(--setting-words) }'
    expect(cssWithConfig(css, [table], {})).toBe(css)
  })
  it('does not write a choice that is not an identifier', () => {
    const odd: ConfigField = { ...choice, options: [{ value: 'a;b', label: 'x' }, { value: 'c', label: 'y' }], default: 'a;b' }
    const css = 'a { display: var(--setting-mode) }'
    expect(cssWithConfig(css, [odd], {})).toBe(css)
  })
  it('replaces an obfuscated reference that the tokenizer reads as var', () => {
    expect(cssWithConfig('a { color: v\\61r(--\\73 etting-tint) }', fields, {})).toBe('a { color: #ffcc00 }')
  })
  it('exposes the limits it enforces', () => {
    expect(CONFIG_LIMITS.bytes).toBe(65536)
  })
})
