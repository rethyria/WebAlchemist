/**
 * The panel opened in a tab verifies the page tab it is bound to (#128).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { boundTab, boundTabFromSearch, panelUrl, resolveBinding, setBoundTab } from './panel-binding'

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

describe('resolveBinding', () => {
  const page = (id: number) => async () => ({ id, url: 'https://example.com/' })

  it('is docked without the parameter and never looks up a tab', async () => {
    const getTab = vi.fn()
    expect(await resolveBinding('', BASE, getTab)).toEqual({ kind: 'docked' })
    expect(getTab).not.toHaveBeenCalled()
  })

  it('binds to an existing page tab', async () => {
    expect(await resolveBinding('?tab=7', BASE, page(7))).toEqual({ kind: 'bound', tabId: 7 })
  })

  it('refuses a tab that is closed', async () => {
    const result = await resolveBinding('?tab=7', BASE, async () => {
      throw new Error('Invalid tab ID: 7')
    })
    expect(result).toMatchObject({ kind: 'refused' })
    expect((result as { message: string }).message).toContain('closed')
  })

  it('refuses a malformed id without looking up a tab', async () => {
    const getTab = vi.fn()
    expect(await resolveBinding('?tab=oops', BASE, getTab)).toMatchObject({ kind: 'refused' })
    expect(getTab).not.toHaveBeenCalled()
  })

  it('refuses a tab that is a page of the extension', async () => {
    const result = await resolveBinding('?tab=7', BASE, async () => ({
      id: 7,
      url: `${BASE}src/sidebar/index.html?tab=3`,
    }))
    expect(result).toMatchObject({ kind: 'refused' })
  })

  it('refuses a reply for a different tab id', async () => {
    expect(await resolveBinding('?tab=7', BASE, page(8))).toMatchObject({ kind: 'refused' })
  })
})

describe('bound tab state', () => {
  it('is null until set', () => expect(boundTab()).toBeNull())
  it('holds the id once set', () => {
    setBoundTab(5)
    expect(boundTab()).toBe(5)
  })
})
