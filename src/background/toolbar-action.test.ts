/**
 * The toolbar action as wired in the real index.ts (#128).
 *
 * Desktop opens the sidebar. Android, which has no sidebar, opens the panel in
 * a tab bound to the tab that was clicked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, ORIGIN, type Harness } from './test-browser'

let h: Harness
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const click = (tab: { id?: number } | undefined) => h.listeners.get('browser.action.onClicked')!(tab)

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
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

describe('start-picking message to the page', () => {
  async function startPicking() {
    h.tabUrls.set(3, 'https://example.com/')
    h.contentReply = (message) => (message.type === 'ping' ? true : undefined)
    await h.boot()
    // The platform is read once at start-up.
    await settle()
    const reply = await h.onMessage({ type: 'start-picking', tabId: 3 })
    expect(reply.error?.message).toBeUndefined()
    return h.calls.sendMessage.find((c) => c.message.type === 'start-picking')!.message
  }

  it('asks for touch picking on Android', async () => {
    h.os = 'android'
    expect((await startPicking()).touch).toBe(true)
  })

  it('does not ask for touch picking on desktop', async () => {
    h.os = 'linux'
    expect((await startPicking()).touch).toBe(false)
  })
})
