import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTAINER_TAB_UNKNOWN, containerForSave } from './container'

describe('containerForSave', () => {
  it('stores nothing for every tab, even when a restriction was stored', () => {
    expect(containerForSave('every-tab', 'firefox-container-1', 'firefox-container-2')).toEqual({
      cookieStoreId: undefined,
    })
  })

  it('records the container of the tab for a new restriction', () => {
    expect(containerForSave('tab-container', undefined, 'firefox-container-2')).toEqual({
      cookieStoreId: 'firefox-container-2',
    })
  })

  it('records the default store for a tab outside any container', () => {
    expect(containerForSave('tab-container', undefined, 'firefox-default')).toEqual({
      cookieStoreId: 'firefox-default',
    })
  })

  it('keeps a stored restriction without reading the tab', () => {
    expect(containerForSave('tab-container', 'firefox-container-1', undefined)).toEqual({
      cookieStoreId: 'firefox-container-1',
    })
  })

  // Control: the same choice with nothing to keep and no readable tab is
  // refused, so a transform is not saved restricted to nothing.
  it('control: refuses a new restriction when the tab cannot be read', () => {
    expect(containerForSave('tab-container', undefined, undefined)).toEqual({
      error: CONTAINER_TAB_UNKNOWN,
    })
  })
})

describe('the manifest permissions for containers (#127)', () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, '../manifest.json'), 'utf8')) as {
    permissions: string[]
    optional_permissions: string[]
  }

  it('does not hold contextualIdentities, which turns on containers for every user', () => {
    expect(manifest.permissions).not.toContain('contextualIdentities')
    expect(manifest.optional_permissions).not.toContain('contextualIdentities')
  })

  it('asks for cookies only as an optional permission', () => {
    expect(manifest.permissions).not.toContain('cookies')
    expect(manifest.optional_permissions).toContain('cookies')
  })

  // Control: the file read is the real manifest, with its other entries.
  it('control: the manifest read holds the other permissions', () => {
    expect(manifest.permissions).toContain('storage')
    expect(manifest.optional_permissions).toContain('userScripts')
  })
})
