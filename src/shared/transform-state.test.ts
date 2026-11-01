import { describe, expect, it } from 'vitest'
import { needsRegenerating, toggleOutcome } from './transform-state'

describe('a transform with no code', () => {
  it('needs regenerating', () => {
    expect(needsRegenerating({ code: '' })).toBe(true)
  })

  it('does not once it has code (control)', () => {
    expect(needsRegenerating({ code: 'a{}' })).toBe(false)
  })

  it('explains instead of turning on', () => {
    expect(toggleOutcome({ code: '' }, true)).toBe('explain')
  })

  it('can still be turned off, and a transform with code turns on (controls)', () => {
    expect(toggleOutcome({ code: '' }, false)).toBe('send')
    expect(toggleOutcome({ code: 'a{}' }, true)).toBe('send')
  })
})
