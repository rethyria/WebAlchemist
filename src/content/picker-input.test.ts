/**
 * The picker's input decisions (#118).
 *
 * The handlers in index.ts act on the page and cannot be loaded here, so the
 * decisions they make are in picker-input.ts. These tests cover those
 * decisions. They do not exercise the handlers' calls into the DOM; that is
 * not verified by any test in this project.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { decideKey, relayPickerKey } from './picker-input'

describe('a key forwarded by the sidebar', () => {
  it('does nothing when no pick is running', () => {
    const apply = vi.fn(() => true)
    for (const action of ['parent', 'child', 'previous', 'next', 'confirm', 'cancel'] as const) {
      expect(relayPickerKey({ picking: false, atSeed: false }, action, apply)).toBe('ignore')
    }
    expect(apply).not.toHaveBeenCalled()
  })

  it('runs the action while a pick is running (control)', () => {
    const apply = vi.fn(() => true)
    expect(relayPickerKey({ picking: true, atSeed: false }, 'child', apply)).toBe('apply')
    expect(apply).toHaveBeenCalledWith('child')
  })
})

describe('Enter', () => {
  const moved = { picking: true, atSeed: false }

  it('confirms when the selection has been moved', () => {
    expect(decideKey(moved, 'confirm', false)).toBe('apply')
  })

  it('does not confirm while it is held down', () => {
    expect(decideKey(moved, 'confirm', true)).toBe('consume')
  })

  it('does not confirm while the selection is still the element the picker started on', () => {
    expect(decideKey({ picking: true, atSeed: true }, 'confirm', false)).toBe('consume')
  })

  it('does not stop the other keys from moving the selection at the start (control)', () => {
    expect(decideKey({ picking: true, atSeed: true }, 'child', false)).toBe('apply')
    expect(decideKey({ picking: true, atSeed: true }, 'cancel', false)).toBe('apply')
  })

  it('lets arrow keys repeat (control)', () => {
    expect(decideKey(moved, 'next', true)).toBe('apply')
  })
})

describe('the handlers in index.ts use these decisions', () => {
  // The handlers cannot be run here, so this reads their source. It fails if a
  // handler stops asking for the decision, which the tests above cannot see.
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

  it('decides a forwarded key with relayPickerKey and a page key with decideKey, both told where the selection started', () => {
    expect(source).toContain('relayPickerKey({ picking, atSeed }, message.action, applyPickerAction)')
    expect(source).toContain('decideKey({ picking, atSeed }, action, event.repeat)')
  })
})
