/**
 * Removing a site's access takes the CSS that was applied there out of open
 * tabs (#122). Two tabs are open on different sites and only the one that lost
 * access is expected to change.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { removeAccessQuestion } from '@shared/site-access'
import { createHarness, cssTransform, type Harness } from './test-browser'

const a = cssTransform({ id: 'a', name: 'A', match: 'a.example/*', code: 'a { color: red }' })
const b = cssTransform({ id: 'b', name: 'B', match: 'b.example/*', code: 'b { color: blue }', order: 1 })

let h: Harness
beforeEach(async () => {
  h = createHarness()
  h.origins = ['*://a.example/*', '*://b.example/*']
  h.local.set('transforms', [a, b])
  h.tabUrls.set(1, 'https://a.example/')
  h.tabUrls.set(2, 'https://b.example/')
  h.contentReply = () => undefined
  await h.boot()
  await h.onMessage({ type: 'reapply-everywhere', id: 'a' })
})

const removed = (tabId: number) => h.calls.removeCSS.filter((c) => c.tabId === tabId)
const removedEvent = () => h.listeners.get('browser.permissions.onRemoved')!({ origins: ['*://a.example/*'] })

describe('permissions.onRemoved', () => {
  it('starts with both tabs styled (control)', () => {
    expect(h.calls.insertCSS.map((c) => c.tabId).sort()).toEqual([1, 2])
  })

  it('takes the CSS out of the tab that lost access, and forgets the record', async () => {
    h.origins = ['*://b.example/*']
    await removedEvent()
    expect(removed(1)).toHaveLength(1)
    expect(removed(1)[0]!.css).toContain('a { color: red }')
    expect(h.session.has('wa-css-applied-1')).toBe(false)
  })

  it('leaves the tab that kept access alone', async () => {
    h.origins = ['*://b.example/*']
    await removedEvent()
    expect(removed(2)).toEqual([])
    expect(h.session.has('wa-css-applied-2')).toBe(true)
  })

  it('removes nothing when every site still has access (control)', async () => {
    await removedEvent()
    expect(h.calls.removeCSS).toEqual([])
  })
})

describe('the question before removing access', () => {
  it('is asked when transforms depend on the grant, with the count', () => {
    expect(removeAccessQuestion({ origin: '*://a.example/*', transforms: 1 })).toContain('1 saved transform uses')
    expect(removeAccessQuestion({ origin: '*://a.example/*', transforms: 3 })).toContain('3 saved transforms use')
  })

  it('is not asked when no transform depends on the grant (control)', () => {
    expect(removeAccessQuestion({ origin: '*://a.example/*', transforms: 0 })).toBeNull()
  })
})
