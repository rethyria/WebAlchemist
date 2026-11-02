import { describe, expect, it } from 'vitest'
import {
  addItem,
  addRow,
  defaultDraft,
  draftChanges,
  draftProblems,
  draftValue,
  makeDraft,
  removeAt,
} from './config-draft'
import type { ConfigField } from './types'

const words: ConfigField = {
  key: 'words',
  label: 'Words',
  type: 'table',
  columns: [{ key: 'from', label: 'From' }, { key: 'to', label: 'To' }],
  default: [{ from: 'a', to: 'b' }],
}
const size: ConfigField = { key: 'size', label: 'Size', type: 'number', default: 10, min: 1, max: 20 }
const list: ConfigField = { key: 'list', label: 'List', type: 'list', default: ['x'] }
const fields = [words, size, list]

describe('the draft of the settings form', () => {
  it('copies the values and holds a number as text', () => {
    const values = { size: 15, words: [{ from: 'y', to: 'z' }] }
    const draft = makeDraft(fields, values)
    expect(draft.size).toBe('15')
    expect(draft.list).toEqual(['x'])
    draft.words[0].from = 'changed'
    expect(values.words[0]!.from).toBe('y')
  })

  it('adds and removes rows and items', () => {
    const draft = makeDraft(fields, {})
    addRow(words, draft)
    expect(draft.words).toEqual([{ from: 'a', to: 'b' }, { from: '', to: '' }])
    removeAt(draft, 'words', 0)
    expect(draft.words).toEqual([{ from: '', to: '' }])
    addItem(draft, 'list')
    expect(draft.list).toEqual(['x', ''])
    removeAt(draft, 'list', 0)
    expect(draft.list).toEqual([''])
  })

  it('goes back to the defaults', () => {
    const draft = makeDraft(fields, { size: 15, words: [] })
    expect(defaultDraft(fields)).toEqual(makeDraft(fields, {}))
    expect(draft.size).not.toBe(defaultDraft(fields).size)
  })

  it('reads a number from its text, and an empty or bad text as not a number', () => {
    expect(draftValue(size, { size: '12' })).toBe(12)
    expect(draftValue(size, { size: '' })).toBeNaN()
    expect(draftValue(size, { size: 'abc' })).toBeNaN()
  })

  it('reports a problem for each value that is not valid, as the background does', () => {
    const draft = makeDraft(fields, {})
    expect(Object.values(draftProblems(fields, draft))).toEqual([null, null, null])
    draft.size = '99'
    draft.words.push({ from: 'a', to: 'b', extra: 'c' })
    draft.list.push('x'.repeat(501))
    const problems = draftProblems(fields, draft)
    expect(problems.size).toMatch(/at most 20/)
    expect(problems.words).not.toBeNull()
    expect(problems.list).toMatch(/longer than 500/)
  })

  it('returns only the keys changed against the values the form opened with', () => {
    const opened = { size: 15 }
    const draft = makeDraft(fields, opened)
    expect(draftChanges(fields, draft, opened)).toEqual({ set: {}, reset: [] })
    draft.size = '16'
    expect(draftChanges(fields, draft, opened)).toEqual({ set: { size: 16 }, reset: [] })
    draft.size = '10'
    expect(draftChanges(fields, draft, opened)).toEqual({ set: {}, reset: ['size'] })
    draft.size = '15'
    addRow(words, draft)
    draft.words[1].from = 'c'
    expect(draftChanges(fields, draft, opened)?.set.words).toEqual([{ from: 'a', to: 'b' }, { from: 'c', to: '' }])
  })

  it('returns nothing to save while a value is not valid', () => {
    const draft = makeDraft(fields, {})
    draft.size = ''
    expect(draftChanges(fields, draft, {})).toBeNull()
  })
})
