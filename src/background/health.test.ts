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

describe('a manual check that finishes after the tab navigated (#88)', () => {
  it('does not mark the new page broken', async () => {
    h.tabUrls.set(TAB, OLD_PAGE)
    const manual = h.onMessage({ type: 'check-now', tabId: TAB, url: OLD_PAGE })
    await checkAsked
    await commit(NEW_PAGE)
    finishCheck({ type: 'health-check-result', states: brokenState })
    await manual
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(badgeText()).toBe('')
  })

  it('control: the same result with no navigation in between marks the page broken', async () => {
    // Shows the manual check does paint "!" when its page is still current, so
    // the empty badge above comes from the navigation.
    h.tabUrls.set(TAB, OLD_PAGE)
    const manual = h.onMessage({ type: 'check-now', tabId: TAB, url: OLD_PAGE })
    await checkAsked
    finishCheck({ type: 'health-check-result', states: brokenState })
    await manual
    expect(badgeText()).toBe('!')
  })
})

describe('a result that becomes out of date between its steps (#86)', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('is not written to the badge when the tab changed after the check returned', async () => {
    await commit(OLD_PAGE)
    await checkAsked
    // The result has arrived and is being recorded when the tab moves on.
    const release = h.hold('browser.storage.session.set')
    finishCheck({ type: 'health-check-result', states: brokenState })
    await settle()
    h.tabUrls.set(TAB, NEW_PAGE)
    void h.onMessage({ type: 'check-now', tabId: TAB, url: NEW_PAGE })
    await settle()
    release()
    await settle()
    expect(badgeText()).not.toBe('!')
    expect(h.calls.runtimeMessages).toEqual([])
  })

  it('is not broadcast when the tab changed while the badge was written', async () => {
    await commit(OLD_PAGE)
    await checkAsked
    const release = h.hold('browser.action.setBadgeText')
    finishCheck({ type: 'health-check-result', states: brokenState })
    await settle()
    // The badge write for the old page is in flight; a new document commits.
    void commit(NEW_PAGE)
    await settle()
    release()
    await settle()
    expect(h.calls.runtimeMessages).toEqual([])
  })

  it('control: with no change in between the result reaches the badge and the sidebar', async () => {
    // Same sequence and the same held calls, released without a navigation, so
    // the empty results above come from the tab moving on.
    await commit(OLD_PAGE)
    await checkAsked
    const release = h.hold('browser.storage.session.set')
    finishCheck({ type: 'health-check-result', states: brokenState })
    await settle()
    release()
    await settle()
    expect(badgeText()).toBe('!')
    expect(h.calls.runtimeMessages).toHaveLength(1)
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

  describe('on a tab whose badge facts were lost in a suspension', () => {
    const OTHER_TAB = 8
    const OTHER_PAGE = 'https://example.com/other'
    const elsewhere = 'https://unrelated.example/'
    const bothBroken = async () => {
      h.tabUrls.set(OTHER_TAB, OTHER_PAGE)
      currentStates = brokenState
      await commit(OLD_PAGE)
      await h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId: OTHER_TAB, url: OTHER_PAGE })
      await settle()
      await settle()
    }
    const textOf = (tabId: number) => h.calls.setBadgeText.filter((c) => c.tabId === tabId).at(-1)?.text

    it('clears "!" on another tab when the transform is saved', async () => {
      await bothBroken()
      expect(textOf(OTHER_TAB)).toBe('!')
      await h.boot() // suspension: the badge facts are gone, the drawn "!" stays
      await h.onMessage({ type: 'save-transform', transform: app, tabId: TAB })
      expect(textOf(OTHER_TAB)).toBe('1')
    })

    it('clears "!" on another tab when the transform is deleted', async () => {
      await bothBroken()
      await h.boot()
      await h.onMessage({ type: 'delete-transform', id: app.id, tabId: TAB })
      expect(textOf(OTHER_TAB)).toBe('')
    })

    it('does not touch a tab the transform does not match', async () => {
      await bothBroken()
      h.tabUrls.set(11, elsewhere)
      await h.boot()
      await h.onMessage({ type: 'save-transform', transform: app, tabId: TAB })
      expect(h.calls.setBadgeText.filter((c) => c.tabId === 11)).toEqual([])
    })

    it('control: a reorder, which does not repaint other tabs, leaves "!" in place', async () => {
      // A reorder reapplies only the tab it came from, so the "!" staying shows
      // the clears above come from the repaint and not from the stub or the
      // reapply reaching the other tab.
      await bothBroken()
      await h.boot()
      await h.onMessage({ type: 'reorder-transforms', orderedIds: [app.id], tabId: TAB })
      expect(textOf(OTHER_TAB)).toBe('!')
    })
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

  it('checks the site again after one of its transforms is saved', async () => {
    await commit('https://example.com/a1')
    await settle()
    expect(checks()).toHaveLength(1)
    await h.onMessage({ type: 'save-transform', transform: pathA })
    await commit('https://example.com/a1')
    await settle()
    expect(checks()).toHaveLength(2)
  })

  it('keeps the record of a site whose transforms were not saved', async () => {
    // Control: saving a transform that this site's check did not include leaves
    // the record in place, so the re-check above comes from the saved id.
    await commit('https://example.com/a1')
    await settle()
    await h.onMessage({ type: 'save-transform', transform: pathB })
    await commit('https://example.com/a1')
    await settle()
    expect(checks()).toHaveLength(1)
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

describe('changing a match pattern in the editor (#89)', () => {
  const OTHER_TAB = 9

  it('takes the CSS off a tab the new pattern no longer matches', async () => {
    h.tabUrls.set(TAB, OLD_PAGE)
    h.tabUrls.set(OTHER_TAB, 'https://other.example/')
    h.contentReply = (message) => (message.type === 'ping' ? true : { type: 'health-check-result', states: [] })
    await commit(OLD_PAGE)
    expect(h.calls.insertCSS).toHaveLength(1)

    // The editor saves the record with a new pattern, then asks for a reapply.
    await h.onMessage({ type: 'save-transform', transform: { ...app, match: 'other.example/*' } })
    await h.onMessage({ type: 'reapply-everywhere', id: app.id })

    expect(h.calls.removeCSS.map((c) => c.tabId)).toEqual([TAB])
    expect(h.calls.insertCSS.map((c) => c.tabId)).toEqual([TAB, OTHER_TAB])
    expect(h.calls.setBadgeText.filter((c) => c.tabId === TAB).at(-1)?.text).toBe('')
    expect(h.calls.setBadgeText.filter((c) => c.tabId === OTHER_TAB).at(-1)?.text).toBe('1')
  })

  it('control: an unchanged pattern leaves the matching tab applied', async () => {
    // Shows the removal above comes from the pattern change: the same
    // sequence with the pattern unchanged removes nothing.
    h.tabUrls.set(TAB, OLD_PAGE)
    h.contentReply = (message) => (message.type === 'ping' ? true : { type: 'health-check-result', states: [] })
    await commit(OLD_PAGE)
    await h.onMessage({ type: 'save-transform', transform: app })
    await h.onMessage({ type: 'reapply-everywhere', id: app.id })
    expect(h.calls.removeCSS).toEqual([])
    expect(h.calls.setBadgeText.filter((c) => c.tabId === TAB).at(-1)?.text).toBe('1')
  })
})
