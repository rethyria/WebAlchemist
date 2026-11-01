/**
 * The panel opened in a tab verifies the page tab it is bound to (#128).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boundTab,
  boundTabFromSearch,
  panelPagesFromStorage,
  panelPageKey,
  panelUrl,
  resolveBinding,
  setBoundTab,
  type PanelLink,
} from './panel-binding'

const BASE = 'moz-extension://abc/'

afterEach(() => setBoundTab(null))

describe('boundTabFromSearch', () => {
  it('reads the tab id', () => expect(boundTabFromSearch('?tab=42')).toBe(42))
  it('is null without the parameter', () => expect(boundTabFromSearch('')).toBeNull())
  it.each(['?tab=', '?tab=abc', '?tab=0', '?tab=-3', '?tab=1.5', '?tab=4x'])(
    'reports %s as invalid',
    (search) => expect(boundTabFromSearch(search)).toBeNaN(),
  )
  it('round trips with panelUrl', () => {
    expect(boundTabFromSearch(new URL(panelUrl(BASE, 17)).search)).toBe(17)
  })
})

/** A link whose panel is tab 50 and whose record names `recorded`. */
function link(recorded: number | undefined, own: number | undefined = 50): PanelLink & { reads: number } {
  const l = {
    reads: 0,
    ownTabId: async () => own,
    recordedPage: async () => {
      l.reads += 1
      return recorded
    },
    wait: async () => {},
  }
  return l
}

describe('resolveBinding', () => {
  const page = (id: number) => async () => ({ id, url: 'https://example.com/' })

  it('is docked without the parameter and never looks up a tab', async () => {
    const getTab = vi.fn()
    expect(await resolveBinding('', BASE, getTab, link(undefined))).toEqual({ kind: 'docked' })
    expect(getTab).not.toHaveBeenCalled()
  })

  it('binds to an existing page tab', async () => {
    expect(await resolveBinding('?tab=7', BASE, page(7), link(7))).toEqual({ kind: 'bound', tabId: 7 })
  })

  it('refuses a tab that is closed', async () => {
    const result = await resolveBinding(
      '?tab=7',
      BASE,
      async () => {
        throw new Error('Invalid tab ID: 7')
      },
      link(7),
    )
    expect(result).toMatchObject({ kind: 'refused' })
    expect((result as { message: string }).message).toContain('closed')
  })

  it('refuses a malformed id without looking up a tab', async () => {
    const getTab = vi.fn()
    expect(await resolveBinding('?tab=oops', BASE, getTab, link(7))).toMatchObject({ kind: 'refused' })
    expect(getTab).not.toHaveBeenCalled()
  })

  it('refuses a tab that is a page of the extension', async () => {
    const result = await resolveBinding(
      '?tab=7',
      BASE,
      async () => ({ id: 7, url: `${BASE}src/sidebar/index.html?tab=3` }),
      link(7),
    )
    expect(result).toMatchObject({ kind: 'refused' })
  })

  it('refuses a reply for a different tab id', async () => {
    expect(await resolveBinding('?tab=7', BASE, page(8), link(7))).toMatchObject({ kind: 'refused' })
  })
})

describe('the record that links a panel tab to its page tab (#128)', () => {
  const page = (id: number) => async () => ({ id, url: 'https://example.com/' })
  const reopen = 'Open Web Alchemist from the toolbar menu'

  it('refuses when the record names another page tab, as after a restart reuses ids', async () => {
    const result = await resolveBinding('?tab=7', BASE, page(7), link(9))
    expect(result).toMatchObject({ kind: 'refused' })
    expect((result as { message: string }).message).toContain(reopen)
  })

  it('refuses when no record exists, after trying for a short time', async () => {
    const l = link(undefined)
    expect(await resolveBinding('?tab=7', BASE, page(7), l)).toMatchObject({ kind: 'refused' })
    expect(l.reads).toBe(10)
  })

  it('accepts a record that appears after the panel loaded', async () => {
    let calls = 0
    const l: PanelLink = {
      ownTabId: async () => 50,
      recordedPage: async () => (++calls < 3 ? undefined : 7),
      wait: async () => {},
    }
    expect(await resolveBinding('?tab=7', BASE, page(7), l)).toEqual({ kind: 'bound', tabId: 7 })
  })

  it('refuses when the panel cannot tell which tab it is in', async () => {
    const l: PanelLink = { ...link(7), ownTabId: async () => undefined }
    expect(await resolveBinding('?tab=7', BASE, page(7), l)).toMatchObject({ kind: 'refused' })
  })

  it('does not need a record for the docked sidebar', async () => {
    const l = link(undefined)
    expect(await resolveBinding('', BASE, vi.fn(), l)).toEqual({ kind: 'docked' })
    expect(l.reads).toBe(0)
  })

  it('reads the records back from a storage snapshot', () => {
    const pages = panelPagesFromStorage({
      [panelPageKey(50)]: 7,
      [panelPageKey(51)]: 'bad',
      'wa-run-tabs-3': [1],
    })
    expect([...pages]).toEqual([[50, 7]])
  })
})

describe('bound tab state', () => {
  it('is null until set', () => expect(boundTab()).toBeNull())
  it('holds the id once set', () => {
    setBoundTab(5)
    expect(boundTab()).toBe(5)
  })
})
