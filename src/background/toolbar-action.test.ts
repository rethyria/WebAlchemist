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

  it('calls sidebarAction.open before the listener returns, as the user-action rule requires (#128)', async () => {
    h.os = 'linux'
    await h.boot()
    await settle()
    // No await between the call and the check: an await in the handler before
    // sidebarAction.open() would leave the count at 0 here.
    click({ id: 3 })
    expect(h.calls.sidebarOpen).toBe(1)
  })

  it('calls sidebarAction.open before the listener returns while the platform is unknown (#128)', async () => {
    h.os = 'linux'
    await h.boot()
    // No settle: the start-up platform read may not have finished.
    click({ id: 3 })
    expect(h.calls.sidebarOpen).toBe(1)
  })

  it('opens the panel in a tab bound to the clicked tab on Android, and not the sidebar', async () => {
    h.os = 'android'
    await h.boot()
    click({ id: 3 })
    await settle()
    expect(h.calls.tabsCreate).toEqual([`${ORIGIN}src/sidebar/index.html?tab=3`])
    expect(h.calls.sidebarOpen).toBe(0)
  })

  it('records the panel tab and its page tab in storage.session (#128)', async () => {
    h.os = 'android'
    await h.boot()
    click({ id: 3 })
    await settle()
    // The harness creates every tab with id 500.
    expect(h.session.get('wa-panel-page-500')).toBe(3)
  })

  it('shows the panel tab that is already open for that page', async () => {
    h.os = 'android'
    h.tabUrls.set(8, `${ORIGIN}src/sidebar/index.html?tab=3`)
    await h.boot()
    click({ id: 3 })
    await settle()
    expect(h.calls.tabsUpdate).toEqual([8])
    expect(h.calls.tabsCreate).toEqual([])
    expect(h.session.get('wa-panel-page-8')).toBe(3)
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

  it('asks for touch picking on Android even when the platform read has not finished (#128)', async () => {
    h.os = 'android'
    h.tabUrls.set(3, 'https://example.com/')
    h.contentReply = (message) => (message.type === 'ping' ? true : undefined)
    const release = h.hold('browser.runtime.getPlatformInfo')
    await h.boot()
    const pending = h.onMessage({ type: 'start-picking', tabId: 3 })
    await settle()
    release()
    expect((await pending).error?.message).toBeUndefined()
    const sent = h.calls.sendMessage.find((c) => c.message.type === 'start-picking')!.message
    expect(sent.touch).toBe(true)
  })

  it('asks for touch picking on Android', async () => {
    h.os = 'android'
    expect((await startPicking()).touch).toBe(true)
  })

  it('does not ask for touch picking on desktop', async () => {
    h.os = 'linux'
    expect((await startPicking()).touch).toBe(false)
  })
})
