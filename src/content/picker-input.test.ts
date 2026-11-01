/**
 * The picker's input decisions (#118).
 *
 * The handlers in index.ts act on the page and cannot be loaded here, so the
 * decisions they make are in picker-input.ts. These tests cover those
 * decisions. They do not exercise the handlers' calls into the DOM; that is
 * not verified by any test in this project.
 */

import { describe, expect, it, vi } from 'vitest'
import { decideKey, isUserEvent, relayPickerKey, seedsBody } from './picker-input'

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

describe('which picks start on the body', () => {
  it('starts a target pick there, where the sidebar forwards keys', () => {
    expect(seedsBody('target')).toBe(true)
  })

  it('does not start a reference pick or a region pick there', () => {
    expect(seedsBody('reference')).toBe(false)
    expect(seedsBody('region')).toBe(false)
  })
})

describe('events from a page script', () => {
  it('accepts an event the browser made', () => {
    expect(isUserEvent({ isTrusted: true })).toBe(true)
  })

  it('refuses an event that a script dispatched', () => {
    expect(isUserEvent({ isTrusted: false })).toBe(false)
  })
})

describe('the handlers in index.ts use these decisions', () => {
  // The handlers cannot be run here, so this reads their source. It fails if a
  // handler stops checking the event or the decision, which the tests above
  // cannot see.
  const source = (async () => (await import('node:fs')).readFileSync(new URL('./index.ts', import.meta.url), 'utf8'))()

  it.each(['onMouseMove', 'onMouseDown', 'onMouseUp', 'onKeyDown'])('%s returns early on an untrusted event', async (name) => {
    const text = await source
    const body = new RegExp(`function ${name}\\(event: [A-Za-z]+\\): void \\{([\\s\\S]*?)\\n\\}\\n`).exec(text)?.[1] ?? ''
    expect(body).toContain('isUserEvent(event)')
  })

  it.each(['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel'])(
    '%s returns early on an untrusted event (#128)',
    async (name) => {
      const text = await source
      const body = new RegExp(`function ${name}\\(event: [A-Za-z]+\\): void \\{([\\s\\S]*?)\\n\\}\\n`).exec(text)?.[1] ?? ''
      expect(body.length).toBeGreaterThan(0)
      // The check is the first statement, before any state is changed.
      expect(body.trimStart().startsWith('if (!isUserEvent(event)) return')).toBe(true)
    },
  )

  it('applies a forwarded key through relayPickerKey and a page key through decideKey', async () => {
    const text = await source
    expect(text).toContain('relayPickerKey({ picking, atSeed }, message.action, applyPickerAction)')
    expect(text).toContain('decideKey({ picking, atSeed }, action, event.repeat)')
  })

  it('does not select the body for a mode that seedsBody refuses', async () => {
    const text = await source
    expect(text).toContain('if (seedsBody(pickMode) && document.body)')
  })
})
