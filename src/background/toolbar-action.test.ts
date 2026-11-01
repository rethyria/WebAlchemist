/**
 * The toolbar action as wired in the real index.ts (#128).
 *
 * Desktop opens the sidebar. Android, which has no sidebar, opens the panel in
 * a tab bound to the tab that was clicked.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, ORIGIN, type Harness } from './test-browser'

let h: Harness
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const click = (tab: { id?: number } | undefined) => h.listeners.get('browser.action.onClicked')!(tab)

beforeEach(() => {
  h = createHarness()
})

describe('toolbar action', () => {
  it('opens the sidebar on desktop and no tab', async () => {
    h.os = 'linux'
    await h.boot()
    click({ id: 3 })
    await settle()
    expect(h.calls.sidebarOpen).toBe(1)
    expect(h.calls.tabsCreate).toEqual([])
  })

  it('opens the panel in a tab bound to the clicked tab on Android, and not the sidebar', async () => {
    h.os = 'android'
    await h.boot()
    click({ id: 3 })
    await settle()
    expect(h.calls.tabsCreate).toEqual([`${ORIGIN}src/sidebar/index.html?tab=3`])
    expect(h.calls.sidebarOpen).toBe(0)
  })

  it('shows the panel tab that is already open for that page', async () => {
    h.os = 'android'
    h.tabUrls.set(8, `${ORIGIN}src/sidebar/index.html?tab=3`)
    await h.boot()
    click({ id: 3 })
    await settle()
    expect(h.calls.tabsUpdate).toEqual([8])
    expect(h.calls.tabsCreate).toEqual([])
  })
})
