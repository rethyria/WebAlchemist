/**
 * Which tab the panel works on (#128).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBoundTab } from '@shared/panel-binding'
import { activeTab } from './messaging.svelte'

afterEach(() => {
  setBoundTab(null)
  vi.unstubAllGlobals()
})

function stubTabs() {
  const tabs = {
    query: vi.fn(async () => [{ id: 1, url: 'moz-extension://abc/src/sidebar/index.html?tab=7' }]),
    get: vi.fn(async (id: number) => {
      if (id === 7) return { id: 7, url: 'https://example.com/' }
      throw new Error('Invalid tab ID')
    }),
  }
  vi.stubGlobal('browser', { tabs })
  return tabs
}

describe('activeTab', () => {
  it('is the active tab of the window when docked', async () => {
    const tabs = stubTabs()
    expect((await activeTab())?.id).toBe(1)
    expect(tabs.get).not.toHaveBeenCalled()
  })

  it('is the bound page tab, not the active tab, when the panel is in a tab', async () => {
    const tabs = stubTabs()
    setBoundTab(7)
    expect((await activeTab())?.url).toBe('https://example.com/')
    expect(tabs.query).not.toHaveBeenCalled()
  })

  it('is null once the bound tab is closed, and does not fall back to the active tab', async () => {
    stubTabs()
    setBoundTab(8)
    expect(await activeTab()).toBeNull()
  })
})
