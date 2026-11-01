/**
 * Health checks that outlive the page they were started for (#86).
 *
 * These load the real index.ts and hold the content script's answer to
 * `run-health-check` open, so the test can navigate the tab while a check is
 * still running.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 4
const app = cssTransform({ match: 'example.com/*' })
const OLD_PAGE = 'https://example.com/page'
const NEW_PAGE = 'https://other.example/'

const brokenState = [{ id: app.id, status: 'broken' }]

let h: Harness
let finishCheck: (reply: unknown) => void
let checkAsked: Promise<void>

beforeEach(async () => {
  h = createHarness()
  h.local.set('transforms', [app])
  let announce: () => void
  checkAsked = new Promise((resolve) => (announce = resolve))
  h.contentReply = (message) => {
    if (message.type === 'ping') return true
    // The content script is still checking when the test navigates the tab.
    return new Promise((resolve) => {
      finishCheck = resolve
      announce()
    })
  }
  await h.boot()
})

const commit = (url: string) =>
  h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId: TAB, url })
const badgeText = () => h.calls.setBadgeText.filter((c) => c.tabId === TAB).at(-1)?.text
describe('a health check that finishes after the tab navigated', () => {
  it('does not mark the new page broken', async () => {
    await commit(OLD_PAGE)
    await checkAsked
    await commit(NEW_PAGE)
    finishCheck({ type: 'health-check-result', states: brokenState })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(badgeText()).toBe('')
  })

  it('control: the same result on the page it was started for marks it broken', async () => {
    // Shows the assertion above is about the navigation: with no navigation in
    // between, the identical reply does reach the badge.
    await commit(OLD_PAGE)
    await checkAsked
    finishCheck({ type: 'health-check-result', states: brokenState })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(badgeText()).toBe('!')
  })
})

describe('the result broadcast to extension pages (#87)', () => {
  it('names the tab it was run in', async () => {
    // Several tabs finish loading while one sidebar is open; the sidebar can
    // only ignore another tab's result if the message says which tab it is.
    await commit(OLD_PAGE)
    await checkAsked
    finishCheck({ type: 'health-check-result', states: brokenState })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.calls.runtimeMessages).toEqual([
      { type: 'health-check-result', tabId: TAB, states: brokenState },
    ])
  })
})

describe('the broken badge after a repair, a delete or a manual check (#88)', () => {

  beforeEach(() => {
    h.tabUrls.set(TAB, OLD_PAGE)
    // Every check answers immediately in these tests.
    h.contentReply = (message) =>
      message.type === 'ping' ? true : { type: 'health-check-result', states: currentStates }
  })

  let currentStates: unknown[] = []
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  async function loadBroken() {
    currentStates = brokenState
    await commit(OLD_PAGE)
    await settle()
    expect(badgeText()).toBe('!')
  }

  it('shows the count again after the broken transform is saved', async () => {
    await loadBroken()
    await h.onMessage({ type: 'save-transform', transform: app, tabId: TAB })
    expect(badgeText()).toBe('1')
  })

  it('clears the marker on other tabs that showed the saved transform as broken', async () => {
    await loadBroken()
    // The edit comes from the editor page, which has no tab of its own.
    await h.onMessage({ type: 'save-transform', transform: app })
    expect(badgeText()).toBe('1')
  })

  it('clears the marker after the broken transform is deleted', async () => {
    await loadBroken()
    await h.onMessage({ type: 'delete-transform', id: app.id, tabId: TAB })
    expect(badgeText()).toBe('')
  })

  it('clears the marker when the broken transform is disabled', async () => {
    await loadBroken()
    await h.onMessage({ type: 'set-enabled', id: app.id, enabled: false, tabId: TAB })
    expect(badgeText()).toBe('')
  })

  it('shows "!" when a manual check finds a broken transform', async () => {
    currentStates = []
    await commit(OLD_PAGE)
    await settle()
    expect(badgeText()).toBe('1')
    currentStates = brokenState
    await h.onMessage({ type: 'check-now', tabId: TAB, url: OLD_PAGE })
    expect(badgeText()).toBe('!')
  })

  it('clears "!" when a manual check finds everything working', async () => {
    await loadBroken()
    currentStates = [{ id: app.id, status: 'working' }]
    await h.onMessage({ type: 'check-now', tabId: TAB, url: OLD_PAGE })
    expect(badgeText()).toBe('1')
  })

  it('control: a transform that stays broken keeps the marker after an unrelated reapply', async () => {
    // Shows the tests above clear the marker because of the edit and not
    // because any reapply clears it: reordering reapplies the tab and changes
    // nothing about this transform.
    await loadBroken()
    await h.onMessage({ type: 'reorder-transforms', orderedIds: [app.id], tabId: TAB })
    expect(badgeText()).toBe('!')
  })
})

describe('once-per-session checks (#94)', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const checks = () => h.calls.sendMessage.filter((c) => c.message.type === 'run-health-check')
  const pathA = cssTransform({ id: 'a', match: 'example.com/a*' })
  const pathB = cssTransform({ id: 'b', match: 'example.com/b*' })

  beforeEach(async () => {
    h.local.set('transforms', [pathA, pathB])
    h.local.set('settings', { ...(await h.onMessage({ type: 'get-settings' })).data, healthCheckMode: 'once-per-session' })
    h.contentReply = (message) =>
      message.type === 'ping' ? true : { type: 'health-check-result', states: [] }
    await h.boot()
  })

  it('does not check a site again after a suspension', async () => {
    await commit('https://example.com/a1')
    await settle()
    expect(checks()).toHaveLength(1)
    await h.boot() // suspension: module state is lost, storage.session is kept
    await commit('https://example.com/a1')
    await settle()
    expect(checks()).toHaveLength(1)
  })

  it('checks a host again when no result arrived the first time', async () => {
    h.contentReply = (message) => (message.type === 'ping' ? true : undefined)
    await commit('https://example.com/a1')
    await settle()
    expect(checks()).toHaveLength(1)
    h.contentReply = (message) =>
      message.type === 'ping' ? true : { type: 'health-check-result', states: [] }
    await commit('https://example.com/a1')
    await settle()
    expect(checks()).toHaveLength(2)
  })

  it('checks each path that has different transforms', async () => {
    await commit('https://example.com/a1')
    await settle()
    await commit('https://example.com/b1')
    await settle()
    expect(checks()).toHaveLength(2)
  })

  it('control: a second page with the same transforms is not checked', async () => {
    // Shows the tests above count checks that happen and not checks that are
    // always skipped: the case once-per-session exists for still skips.
    await commit('https://example.com/a1')
    await settle()
    await commit('https://example.com/a2')
    await settle()
    expect(checks()).toHaveLength(1)
  })
})
