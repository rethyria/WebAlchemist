/**
 * Navigation details that decide what is kept or skipped (#80, #83).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, sidebarPort, type Harness } from './test-browser'

const TAB = 3
const app = cssTransform({ match: 'example.com/*' })
const PAGE = 'https://example.com/app'

let h: Harness
beforeEach(async () => {
  h = createHarness()
  h.local.set('transforms', [app])
  h.tabUrls.set(TAB, PAGE)
  h.contentReply = (message) =>
    message.type === 'ping' ? true : { type: 'health-check-result', states: [] }
  await h.boot()
})

const commit = (qualifiers?: string[]) =>
  h.listeners.get('browser.webNavigation.onCommitted')!({
    frameId: 0,
    tabId: TAB,
    url: PAGE,
    ...(qualifiers ? { transitionQualifiers: qualifiers } : {}),
  })

describe('a preview when the page is shown again from the back-forward cache (#80)', () => {
  const OTHER = 'https://example.com/elsewhere'
  const commitUrl = (url: string, qualifiers?: string[]) =>
    h.listeners.get('browser.webNavigation.onCommitted')!({
      frameId: 0,
      tabId: TAB,
      url,
      ...(qualifiers ? { transitionQualifiers: qualifiers } : {}),
    })
  const preview = () => h.onMessage({ type: 'preview-css', tabId: TAB, css: 'a { color: red }' })
  const stored = () => h.session.get(`wa-css-preview-${TAB}`)

  // The preview's window is 1, which is where tabs are unless a test says so.
  let sidebar: ReturnType<typeof sidebarPort>
  beforeEach(() => {
    sidebar = sidebarPort(1)
    h.listeners.get('browser.runtime.onConnect')!(sidebar)
  })

  it('gives the preview back to the document that had it, so it can still be removed', async () => {
    await commitUrl(PAGE)
    await preview()
    await commitUrl(OTHER) // the tab leaves the page; its document goes to the cache
    expect(stored()).toBeUndefined()
    await commitUrl(PAGE, ['forward_back'])
    expect(stored()).toBe('a { color: red }')
    await h.onMessage({ type: 'clear-preview-css', tabId: TAB })
    // The restored page also has the stylesheet applied from the stored
    // transform, which is removed as well (#50); this test is about the preview's.
    expect(h.calls.removeCSS.filter((c) => c.css === 'a { color: red }')).toEqual([
      { tabId: TAB, css: 'a { color: red }' },
    ])
  })

  it('does not give a preview made on one document to a different one that is restored', async () => {
    // The page A has no preview. B has one. Going back to A must not leave B's
    // string as the tab's preview: A's document does not hold that stylesheet.
    await commitUrl(PAGE)
    await commitUrl(OTHER)
    await preview()
    await commitUrl(PAGE, ['forward_back'])
    expect(stored()).toBeUndefined()
  })

  it('gives B its preview again when the tab goes forward to it', async () => {
    await commitUrl(PAGE)
    await commitUrl(OTHER)
    await preview()
    await commitUrl(PAGE, ['forward_back'])
    await commitUrl(OTHER, ['forward_back'])
    expect(stored()).toBe('a { color: red }')
  })

  it('keeps the string when the same document is committed again from the cache', async () => {
    await commitUrl(PAGE)
    await preview()
    await commitUrl(PAGE, ['forward_back'])
    expect(stored()).toBe('a { color: red }')
  })

  it('control: an ordinary load of the same URL does not restore it', async () => {
    await commitUrl(PAGE)
    await preview()
    await commitUrl(OTHER)
    await commitUrl(PAGE)
    expect(stored()).toBeUndefined()
  })

  it('removes the stylesheet at once when the owner window has no sidebar connected', async () => {
    await commitUrl(PAGE)
    await preview()
    await commitUrl(OTHER) // the document with the preview goes to the cache
    sidebar.drop() // the sidebar of window 1 closes while it is cached
    await new Promise((resolve) => setTimeout(resolve, 20))
    h.calls.removeCSS.length = 0
    await commitUrl(PAGE, ['forward_back'])
    expect(stored()).toBeUndefined()
    // The restored page also has the stylesheet applied from the stored
    // transform, which is removed as well (#50); this test is about the preview's.
    expect(h.calls.removeCSS.filter((c) => c.css === 'a { color: red }')).toEqual([
      { tabId: TAB, css: 'a { color: red }' },
    ])
  })

  it('discards the filed strings when the tab closes', async () => {
    await commitUrl(PAGE)
    await preview()
    await commitUrl(OTHER)
    expect(h.session.get(`wa-preview-archive-${TAB}`)).toBeDefined()
    await h.listeners.get('browser.tabs.onRemoved')!(TAB)
    expect(h.session.get(`wa-preview-archive-${TAB}`)).toBeUndefined()
  })

  it('still forgets the applied string, so the CSS is inserted again', async () => {
    await commit()
    expect(h.calls.insertCSS.filter((c) => c.css.includes('Dark'))).toHaveLength(1)
    await commit(['forward_back'])
    expect(h.calls.insertCSS.filter((c) => c.css.includes('Dark'))).toHaveLength(2)
  })
})

describe('a history event that leaves the URL unchanged (#83)', () => {
  const route = (url: string) =>
    h.listeners.get('browser.webNavigation.onHistoryStateUpdated')!({ frameId: 0, tabId: TAB, url })
  const checks = () => h.calls.sendMessage.filter((c) => c.message.type === 'run-health-check')
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('does not run another health check', async () => {
    await commit()
    await settle()
    expect(checks()).toHaveLength(1)
    await route(PAGE)
    await route(PAGE)
    await settle()
    expect(checks()).toHaveLength(1)
  })

  it('still evaluates a real route change', async () => {
    // Control: the skip depends on the URL being the same, not on every
    // history event being ignored.
    await commit()
    await route('https://example.com/app/two')
    await settle()
    expect(checks()).toHaveLength(2)
  })

  it('skips an unchanged URL after a suspension too', async () => {
    await commit()
    await settle()
    await h.boot()
    await route(PAGE)
    await settle()
    expect(checks()).toHaveLength(1)
  })
})

describe('a transform paused for an edit preview (#83)', () => {
  const route = (url: string) =>
    h.listeners.get('browser.webNavigation.onHistoryStateUpdated')!({ frameId: 0, tabId: TAB, url })
  const stamped = `/* ${app.name} */\n${app.code}`

  beforeEach(async () => {
    await commit()
    expect(h.calls.insertCSS.at(-1)?.css).toBe(stamped)
    await h.onMessage({ type: 'suspend-transform', tabId: TAB, id: app.id })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: stamped }])
  })

  it('stays out of the page when the route changes', async () => {
    await route('https://example.com/app/two')
    expect(h.calls.insertCSS).toHaveLength(1)
  })

  it('stays out of the page when the tab is reapplied after a suspension', async () => {
    await h.boot()
    await h.onMessage({ type: 'reorder-transforms', orderedIds: [app.id], tabId: TAB })
    expect(h.calls.insertCSS).toHaveLength(1)
  })

  it('comes back when the sidebar resumes it', async () => {
    // Control: the record is what keeps it out, and clearing it restores it.
    await h.onMessage({ type: 'suspend-transform', tabId: TAB, id: null })
    expect(h.calls.insertCSS).toHaveLength(2)
    await route('https://example.com/app/two')
    expect(h.calls.insertCSS).toHaveLength(2)
    expect(h.calls.removeCSS).toHaveLength(1)
  })
})

describe('the URL recorded for a page that calls replaceState while loading (#83)', () => {
  const OTHER = 'https://example.com/app/other'
  const route = (url: string) =>
    h.listeners.get('browser.webNavigation.onHistoryStateUpdated')!({ frameId: 0, tabId: TAB, url })
  const checks = () => h.calls.sendMessage.filter((c) => c.message.type === 'run-health-check')
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  /**
   * A commit whose queued steps wait behind a slow task, with a replaceState
   * arriving while it waits. The held `insertCSS` is the slow task: a preview
   * being inserted ahead of the commit in the tab's queue.
   */
  async function replaceStateWhileCommitWaits() {
    const release = h.hold('browser.scripting.insertCSS')
    const preview = h.onMessage({ type: 'preview-css', tabId: TAB, css: 'a { color: red }' })
    await settle()
    const committed = commit()
    const routed = route(OTHER)
    await settle()
    release()
    await Promise.all([preview, committed, routed])
    await settle()
  }

  it('is the URL the page replaced it with, not the commit URL', async () => {
    await replaceStateWhileCommitWaits()
    expect(h.session.get(`wa-last-url-${TAB}`)).toBe(OTHER)
  })

  it('lets a later route back to the commit URL be evaluated', async () => {
    await replaceStateWhileCommitWaits()
    const before = checks().length
    await route(PAGE)
    await settle()
    expect(checks()).toHaveLength(before + 1)
  })

  it('control: with no replaceState the commit URL is recorded and a route to it is skipped', async () => {
    // Shows the two tests above fail because of the replaceState ordering and
    // not because the commit stopped recording its URL.
    await commit()
    await settle()
    expect(h.session.get(`wa-last-url-${TAB}`)).toBe(PAGE)
    const before = checks().length
    await route(PAGE)
    await settle()
    expect(checks()).toHaveLength(before)
  })
})
