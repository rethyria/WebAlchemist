/**
 * Showing the page for a pick and the panel afterwards, in tab mode (#128).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  endsPick,
  isPageOfPanel,
  showPageForPick,
  showPanelAfterPick,
  type TabFocusDeps,
} from './panel-tab'

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

describe('the panel runs showPanelAfterPick only for an event the flow accepted (#128)', () => {
  // App.svelte cannot be mounted here, so this reads its source. It fails if
  // the call goes back to running for every event from any tab.
  it('guards the call with the result of Flow.receive', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../App.svelte', import.meta.url),
      'utf8',
    )
    expect(source).toContain('else if (flow.receive(message, sender)) void showPanelAfterPick(')
    expect(source.match(/showPanelAfterPick\(/g)).toHaveLength(1)
  })
})

describe('which tab updates reload the panel (#128)', () => {
  it('follows the bound tab even when it is not the active one', () => {
    expect(isPageOfPanel(7, 7, false)).toBe(true)
  })
  it('ignores another tab, even the active one, when bound', () => {
    expect(isPageOfPanel(7, 8, true)).toBe(false)
  })
  it('follows the active tab in the docked sidebar', () => {
    expect(isPageOfPanel(null, 8, true)).toBe(true)
    expect(isPageOfPanel(null, 8, false)).toBe(false)
  })

  it('is what App.svelte uses in its tab update listener', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../App.svelte', import.meta.url),
      'utf8',
    )
    expect(source).toContain('if (change.url && isPageOfPanel(boundTab(), id, tab.active)) void load()')
  })
})
