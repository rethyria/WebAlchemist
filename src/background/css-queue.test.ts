/**
 * Overlapping CSS changes for one tab (#83, #80).
 *
 * The tests start two operations without waiting for the first, as two events
 * arriving in the same moment do, and then count which stylesheets are still in
 * the page: every insertCSS call that no removeCSS call matched. Exactly the
 * stylesheet that is stored for the tab may remain; anything else is one that
 * nothing can remove later.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 3
const a = cssTransform({ id: 'a', name: 'A', match: 'example.com/a*', code: 'a { color: red }' })
const b = cssTransform({ id: 'b', name: 'B', match: 'example.com/b*', code: 'b { color: blue }' })
const stamped = (t: typeof a) => `/* ${t.name} */\n${t.code}`

let h: Harness
beforeEach(async () => {
  h = createHarness()
  h.local.set('transforms', [a, b])
  h.tabUrls.set(TAB, 'https://example.com/a1')
  h.contentReply = (message) =>
    message.type === 'ping' ? true : { type: 'health-check-result', states: [] }
  await h.boot()
})

const commit = (url: string) =>
  h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId: TAB, url })
const route = (url: string) =>
  h.listeners.get('browser.webNavigation.onHistoryStateUpdated')!({ frameId: 0, tabId: TAB, url })

/** Stylesheets inserted and never removed, in insertion order. */
function live(): string[] {
  const remaining = h.calls.insertCSS.filter((c) => c.tabId === TAB).map((c) => c.css)
  for (const removed of h.calls.removeCSS.filter((c) => c.tabId === TAB)) {
    const at = remaining.indexOf(removed.css)
    if (at >= 0) remaining.splice(at, 1)
  }
  return remaining
}
const stored = () => h.session.get(`wa-css-applied-${TAB}`)

describe('two route changes that overlap', () => {
  it('leave only the last stylesheet, and it is the stored one', async () => {
    await Promise.all([route('https://example.com/a1'), route('https://example.com/b1')])
    expect(live()).toEqual([stamped(b)])
    expect(stored()).toBe(stamped(b))
  })

  it('control: the same two changes one after the other end the same way', async () => {
    // Shows the stub tracks stylesheets correctly and that the overlap, not the
    // counting helper, is what the test above depends on.
    await route('https://example.com/a1')
    await route('https://example.com/b1')
    expect(live()).toEqual([stamped(b)])
    expect(stored()).toBe(stamped(b))
  })
})

describe('a route change that overlaps a save', () => {
  // Passed before the change as well: the stub's timing did not reproduce the
  // stale read. It is kept as a guard that the queue does not reorder a save.
  it('does not undo the save', async () => {
    h.tabUrls.set(TAB, 'https://example.com/a1')
    await commit('https://example.com/a1')
    const edited = { ...a, code: 'a { color: green }' }
    await Promise.all([
      h.onMessage({ type: 'save-transform', transform: edited, tabId: TAB }),
      route('https://example.com/a2'),
    ])
    expect(live()).toEqual([stamped(edited)])
    expect(stored()).toBe(stamped(edited))
  })
})

describe('a route change that overlaps a page load', () => {
  it('does not store the old document\'s stylesheet under the new one', async () => {
    h.tabUrls.set(TAB, 'https://example.com/b1')
    await Promise.all([route('https://example.com/a1'), commit('https://example.com/b1')])
    expect(stored()).toBe(stamped(b))
    // The stylesheet for the old document was never inserted into the new one.
    expect(live()).toEqual([stamped(b)])
  })
})

describe('preview changes that overlap', () => {
  it('leave only the last preview inserted and stored', async () => {
    await Promise.all([
      h.onMessage({ type: 'preview-css', tabId: TAB, css: 'p { color: red }' }),
      h.onMessage({ type: 'preview-css', tabId: TAB, css: 'p { color: blue }' }),
    ])
    expect(live()).toEqual(['p { color: blue }'])
    expect(h.session.get(`wa-css-preview-${TAB}`)).toBe('p { color: blue }')
  })
})
