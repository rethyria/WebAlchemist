/**
 * The relay of picker keys from the sidebar to the page (#118).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, type Harness } from './test-browser'

let h: Harness
const TAB = 4

beforeEach(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  h = createHarness()
  h.tabUrls.set(TAB, 'https://example.com/')
  h.contentReply = (m) => (m.type === 'ping' ? true : true)
  await h.boot()
})

const relayed = () => h.calls.sendMessage.filter((c) => c.message.type === 'picker-key')

describe('picker-key', () => {
  it.each(['parent', 'child', 'previous', 'next', 'confirm', 'cancel'] as const)(
    'forwards %s to the content script of the tab, with the action',
    async (action) => {
      const out = await h.onMessage({ type: 'picker-key', tabId: TAB, action })
      expect(out.ok).toBe(true)
      expect(relayed()).toEqual([{ tabId: TAB, message: { type: 'picker-key', action } }])
    },
  )

  it('sends nothing for a message that is not picker-key (control)', async () => {
    await h.onMessage({ type: 'cancel-picking', tabId: TAB })
    expect(relayed()).toEqual([])
  })

  it('is refused from a sender that is not an extension page', async () => {
    const out = await h.onMessage(
      { type: 'picker-key', tabId: TAB, action: 'confirm' },
      { url: 'https://example.com/', id: 'wa@test', tab: { id: TAB } },
    )
    expect(out.ok).not.toBe(true)
    expect(relayed()).toEqual([])
  })
})
