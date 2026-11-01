/**
 * Showing the page for a pick and the panel afterwards, in tab mode (#128).
 */

import { describe, expect, it, vi } from 'vitest'
import { endsPick, showPageForPick, showPanelAfterPick, type TabFocusDeps } from './panel-tab'

function deps(bound: number | null): TabFocusDeps & { activate: ReturnType<typeof vi.fn> } {
  return {
    boundTab: () => bound,
    ownTab: async () => ({ id: 99 }),
    activate: vi.fn(async () => ({})),
  }
}

describe('showPageForPick', () => {
  it('brings the bound page tab forward', async () => {
    const d = deps(42)
    await showPageForPick(d)
    expect(d.activate).toHaveBeenCalledWith(42)
  })
  it('does nothing in the docked sidebar', async () => {
    const d = deps(null)
    await showPageForPick(d)
    expect(d.activate).not.toHaveBeenCalled()
  })
})

describe('showPanelAfterPick', () => {
  it.each(['element-picked', 'region-selected', 'element-referenced', 'picking-cancelled'])(
    'brings the panel tab forward on %s',
    async (type) => {
      const d = deps(42)
      await showPanelAfterPick(type, d)
      expect(d.activate).toHaveBeenCalledWith(99)
    },
  )
  it('stays put on a hover, which does not end the pick', async () => {
    const d = deps(42)
    await showPanelAfterPick('element-hovered', d)
    expect(d.activate).not.toHaveBeenCalled()
    expect(endsPick('element-hovered')).toBe(false)
  })
  it('does nothing in the docked sidebar', async () => {
    const d = deps(null)
    await showPanelAfterPick('element-picked', d)
    expect(d.activate).not.toHaveBeenCalled()
  })
})
