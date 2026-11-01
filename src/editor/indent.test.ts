import { describe, expect, it } from 'vitest'
import { indentEdit } from './indent'

/** Applies an edit the way the editor does, so tests read as before and after. */
function apply(value: string, start: number, end: number, outdent = false) {
  const edit = indentEdit(value, start, end, outdent)
  return {
    value: value.slice(0, edit.from) + edit.text + value.slice(edit.to),
    selection: [edit.selectionStart, edit.selectionEnd],
  }
}

describe('indentEdit', () => {
  it('inserts two spaces at the caret', () => {
    expect(apply('ab', 1, 1)).toEqual({ value: 'a  b', selection: [3, 3] })
  })

  it('replaces a selection inside one line, as a text field does', () => {
    expect(apply('abcd', 1, 3)).toEqual({ value: 'a  d', selection: [3, 3] })
  })

  it('indents every line of a selection that spans lines, and keeps it selected', () => {
    // Control: the previous behaviour replaced the selected text with two
    // spaces, giving 'a  c'.
    const result = apply('a\nb\nc', 0, 5)
    expect(result.value).toBe('  a\n  b\n  c')
    expect(result.selection).toEqual([2, 11])
  })

  it('indents the whole of the first and last lines when the selection starts and ends inside them', () => {
    const result = apply('aaa\nbbb', 2, 5)
    expect(result.value).toBe('  aaa\n  bbb')
    expect(result.selection).toEqual([4, 9])
  })

  it('does not indent the line after a selection that ends at its start', () => {
    expect(apply('a\nb\nc', 0, 4).value).toBe('  a\n  b\nc')
  })

  it('leaves empty lines empty', () => {
    expect(apply('a\n\nb', 0, 4).value).toBe('  a\n\n  b')
  })

  it('outdents the lines of a selection, by at most two spaces', () => {
    const result = apply('  a\n b\nc', 0, 8, true)
    expect(result.value).toBe('a\nb\nc')
  })

  it('outdents the current line for Shift+Tab with a caret', () => {
    expect(apply('  ab', 3, 3, true)).toEqual({ value: 'ab', selection: [1, 1] })
  })

  it('starts at the first line when the text begins with an empty line and the selection starts at 0', () => {
    const result = apply('\na\nb', 0, 4)
    expect(result.value).toBe('\n  a\n  b')
    // Control: starting the edit on the second line moved the start of the
    // selection to 2.
    expect(result.selection).toEqual([0, 8])
    expect(indentEdit('\na\nb', 0, 4, false).from).toBe(0)
  })

  it('still finds the start of the line for a selection that does not start at 0 (control)', () => {
    expect(indentEdit('\naa\nb', 2, 5, false).from).toBe(1)
  })
})
