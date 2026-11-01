/**
 * The toolbar action opens the sidebar on desktop and a tab on Android (#128).
 */

import { describe, expect, it, vi } from 'vitest'
import { openPanel, opensInTab, type OpenPanelDeps } from './open-panel'

const BASE = 'moz-extension://abc/'

function deps(over: Partial<OpenPanelDeps> = {}) {
  const d = {
    os: vi.fn(() => 'linux' as string | undefined),
    hasSidebar: vi.fn(() => true),
    openSidebar: vi.fn(async () => {}),
    extensionBase: () => BASE,
    listTabs: vi.fn(async () => [] as { id?: number; url?: string }[]),
    createTab: vi.fn(async () => ({})),
    activateTab: vi.fn(async () => ({})),
    ...over,
  }
  return d
}

describe('toolbar action on desktop', () => {
  it('opens the sidebar and creates no tab', async () => {
    const d = deps()
    await openPanel({ id: 4 }, d)
    expect(d.openSidebar).toHaveBeenCalledTimes(1)
    expect(d.createTab).not.toHaveBeenCalled()
  })

  it('calls the sidebar before any await, which the user-action rule requires', () => {
    const d = deps()
    void openPanel({ id: 4 }, d)
    // No microtask has run yet.
    expect(d.openSidebar).toHaveBeenCalledTimes(1)
  })

  it('uses the sidebar while the platform is still unknown', async () => {
    const d = deps({ os: () => undefined })
    await openPanel({ id: 4 }, d)
    expect(d.openSidebar).toHaveBeenCalled()
  })
})

describe('toolbar action on Android', () => {
  it('opens the panel in a tab bound to the clicked tab, and not the sidebar', async () => {
    const d = deps({ os: () => 'android', hasSidebar: () => false })
    await openPanel({ id: 42 }, d)
    expect(d.createTab).toHaveBeenCalledWith(`${BASE}src/sidebar/index.html?tab=42`)
    expect(d.openSidebar).not.toHaveBeenCalled()
  })

  it('does not open the sidebar even if the API appears to exist', async () => {
    const d = deps({ os: () => 'android', hasSidebar: () => true })
    await openPanel({ id: 42 }, d)
    expect(d.openSidebar).not.toHaveBeenCalled()
    expect(d.createTab).toHaveBeenCalledTimes(1)
  })

  it('shows the panel tab already open for that page instead of opening another', async () => {
    const url = `${BASE}src/sidebar/index.html?tab=42`
    const d = deps({
      os: () => 'android',
      listTabs: async () => [{ id: 9, url }, { id: 10, url: `${BASE}src/sidebar/index.html?tab=43` }],
    })
    await openPanel({ id: 42 }, d)
    expect(d.activateTab).toHaveBeenCalledWith(9)
    expect(d.createTab).not.toHaveBeenCalled()
  })

  it('opens nothing when the click names no tab', async () => {
    const d = deps({ os: () => 'android' })
    await openPanel(undefined, d)
    expect(d.createTab).not.toHaveBeenCalled()
  })

  it('opens in a tab where the sidebar API is missing, whatever the platform reports', async () => {
    const d = deps({ hasSidebar: () => false })
    expect(opensInTab(d)).toBe(true)
    await openPanel({ id: 5 }, d)
    expect(d.createTab).toHaveBeenCalled()
  })
})
