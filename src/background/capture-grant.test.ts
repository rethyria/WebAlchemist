/**
 * Handing back the all-sites screenshot grant when the panel closes mid-run
 * (#134).
 *
 * The panel records that it holds the grant in storage.local; the background
 * script removes the grant when the last panel's port disconnects, and at
 * start-up when no panel reconnects.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPTURE_GRANT_KEY } from '@shared/capture-grant'
import { createHarness, sidebarPort, type Harness } from './test-browser'

const GRACE = 3000
let h: Harness
beforeEach(() => {
  vi.useFakeTimers()
  h = createHarness()
})
afterEach(() => vi.useRealTimers())

const connect = (windowId: number | null = 1) => {
  const port = sidebarPort(windowId)
  h.listeners.get('browser.runtime.onConnect')!(port)
  return port
}
const settle = () => vi.advanceTimersByTimeAsync(50)
const afterGrace = () => vi.advanceTimersByTimeAsync(GRACE + 100)

describe('a panel that closes during a run that holds the grant', () => {
  beforeEach(() => {
    h.allUrlsGranted = true
    h.local.set(CAPTURE_GRANT_KEY, true)
  })

  it('has the grant removed when its port disconnects', async () => {
    await h.boot()
    const port = connect()
    port.drop()
    await settle()
    expect(h.allUrlsGranted).toBe(false)
    expect(h.local.get(CAPTURE_GRANT_KEY)).toBe(false)
  })

  it('keeps the grant while another panel is still connected', async () => {
    await h.boot()
    const first = connect(1)
    const second = connect(2)
    first.drop()
    await settle()
    expect(h.allUrlsGranted).toBe(true)
    second.drop()
    await settle()
    expect(h.allUrlsGranted).toBe(false)
  })

  it('keeps the grant when the setting to keep it is on (control)', async () => {
    // Same steps as the first test with the setting on, so the removal there
    // comes from the disconnect and the setting is what prevents it here.
    h.local.set('settings', { keepScreenshotPermission: true })
    await h.boot()
    connect().drop()
    await settle()
    expect(h.allUrlsGranted).toBe(true)
    expect(h.permissionsRemoved).toEqual([])
  })

  it('works after the background page was suspended in the middle of the run', async () => {
    await h.boot()
    // The page is suspended: the panel's port is lost, only storage is kept.
    await h.boot()
    const port = connect()
    port.drop()
    await settle()
    expect(h.allUrlsGranted).toBe(false)
  })
})

describe('a panel that closes with no run holding the grant (control)', () => {
  it('leaves a grant the panel never recorded', async () => {
    h.allUrlsGranted = true
    await h.boot()
    connect().drop()
    await settle()
    expect(h.allUrlsGranted).toBe(true)
  })
})

describe('the background page starting with the grant held', () => {
  beforeEach(() => {
    h.allUrlsGranted = true
  })

  it('control: removes nothing when the panel never recorded taking the grant', async () => {
    // A grant the user gave outside the panel has no record.
    await h.boot()
    await afterGrace()
    expect(h.allUrlsGranted).toBe(true)
    expect(h.permissionsRemoved).toEqual([])
  })

  it('removes the grant and clears the record when the panel recorded taking it and no panel connects', async () => {
    // The record is in storage.local, so it is still there after a browser restart.
    h.local.set(CAPTURE_GRANT_KEY, true)
    await h.boot()
    await afterGrace()
    expect(h.allUrlsGranted).toBe(false)
    expect(h.local.get(CAPTURE_GRANT_KEY)).toBe(false)
  })

  it('keeps the grant when a panel reconnects during start-up', async () => {
    h.local.set(CAPTURE_GRANT_KEY, true)
    await h.boot()
    connect()
    await afterGrace()
    expect(h.allUrlsGranted).toBe(true)
  })

  it('keeps the grant when the setting to keep it is on', async () => {
    h.local.set(CAPTURE_GRANT_KEY, true)
    h.local.set('settings', { keepScreenshotPermission: true })
    await h.boot()
    await afterGrace()
    expect(h.allUrlsGranted).toBe(true)
  })

  it('control: with no grant held nothing is removed', async () => {
    h.allUrlsGranted = false
    await h.boot()
    await afterGrace()
    expect(h.permissionsRemoved).toEqual([])
  })
})
