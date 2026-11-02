import { describe, expect, it } from 'vitest'
import { describeValue, notKeptText, summaryOf, typeName } from './config-text'
import type { ConfigField } from './types'

const table: ConfigField = { key: 'w', label: 'Words', type: 'table', columns: [{ key: 'a', label: 'A' }], default: [] }

describe('the wording of settings', () => {
  it('names every type', () => {
    expect(['text', 'number', 'yes-no', 'choice', 'colour', 'list', 'table'].map((x) => typeName(x as never))).toEqual([
      'text', 'number', 'yes or no', 'choice', 'colour', 'list', 'table',
    ])
  })

  it('describes values briefly', () => {
    expect(describeValue({ key: 'a', label: 'A', type: 'text', default: '' }, '')).toBe('empty')
    expect(describeValue({ key: 'a', label: 'A', type: 'text', default: '' }, 'x'.repeat(100))).toBe(`${'x'.repeat(60)}...`)
    expect(describeValue({ key: 'a', label: 'A', type: 'number', default: 1, unit: 'px' }, 12)).toBe('12px')
    expect(describeValue({ key: 'a', label: 'A', type: 'yes-no', default: true }, false)).toBe('no')
    expect(describeValue({ key: 'a', label: 'A', type: 'choice', default: 'a', options: [{ value: 'a', label: 'Dark' }, { value: 'b', label: 'B' }] }, 'a')).toBe('Dark')
    expect(describeValue(table, [{ a: '1' }, { a: '2' }])).toBe('2 rows')
    expect(describeValue({ key: 'l', label: 'L', type: 'list', default: [] }, ['a'])).toBe('1 items')
  })

  it('summarises fields and says which value is not kept', () => {
    expect(summaryOf([table, { key: 'a', label: 'A', type: 'text', default: '' }])).toBe('Words (table), A (text)')
    expect(notKeptText({ key: 'w', label: 'Words to replace', reason: 'removed' })).toBe(
      'Your value for Words to replace is not kept: the new version has no such setting.',
    )
  })
})
