import { describe, expect, it } from 'vitest'
import { changedFields } from './settings-fields'
import { DEFAULT_SETTINGS } from './types'

describe('changedFields', () => {
  it('contains only the field that changed', () => {
    expect(changedFields(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, accent: 'green' })).toEqual({
      accent: 'green',
    })
  })

  it('does not carry along fields that were stale in the copy that was edited', () => {
    // The panel loaded the kill switch as false. Another page turned it on.
    // The panel then changes the accent: the patch must not say the switch is false.
    const loaded = { ...DEFAULT_SETTINGS }
    const edited = { ...loaded, accent: 'green' as const }
    expect('aiJsKillSwitch' in changedFields(loaded, edited)).toBe(false)
  })

  it('contains the kill switch when that is what changed (control)', () => {
    expect(changedFields(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, aiJsKillSwitch: true })).toEqual({
      aiJsKillSwitch: true,
    })
  })

  it('is empty when nothing changed', () => {
    expect(changedFields(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toEqual({})
  })

  it('ignores the providers, which have their own changes', () => {
    expect(changedFields(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, providers: [] })).toEqual({})
  })
})
