/**
 * The picker's input decisions (#118).
 *
 * The handlers in index.ts act on the page and cannot be loaded here, so the
 * decisions they make are in picker-input.ts. These tests cover those
 * decisions and, by reading the source, that the handler calls them. They do
 * not exercise the handlers' calls into the DOM.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { relayPickerKey } from './picker-input'

describe('a key forwarded by the sidebar', () => {
  it('does nothing when no pick is running', () => {
    const apply = vi.fn(() => true)
    for (const action of ['parent', 'child', 'previous', 'next', 'confirm', 'cancel'] as const) {
      expect(relayPickerKey({ picking: false }, action, apply)).toBe('ignore')
    }
    expect(apply).not.toHaveBeenCalled()
  })

  it('runs the action while a pick is running (control)', () => {
    const apply = vi.fn(() => true)
    expect(relayPickerKey({ picking: true }, 'child', apply)).toBe('apply')
    expect(apply).toHaveBeenCalledWith('child')
  })

  it('is what the content script calls for a picker-key message', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(source).toContain('relayPickerKey({ picking }, message.action, applyPickerAction)')
  })
})
