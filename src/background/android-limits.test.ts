/**
 * What the extension says where Firefox for Android lacks an API (#128).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_SIGN_IN_UNAVAILABLE,
  SCREENSHOTS_UNAVAILABLE,
  hasAccountSignIn,
} from '@shared/android-limits'
import { screenshotsAvailable, setBoundTab } from '@shared/panel-binding'
import { connect } from './oauth'
import { createHarness, type Harness } from './test-browser'

const config = {
  authorizationEndpoint: 'https://provider.example/oauth/authorize',
  tokenEndpoint: 'https://provider.example/oauth/token',
  clientId: 'web-alchemist',
  scopes: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
  setBoundTab(null)
})

describe('account sign-in without the identity API', () => {
  it('is detected from the missing function', () => {
    expect(hasAccountSignIn({})).toBe(false)
    expect(hasAccountSignIn({ identity: {} })).toBe(false)
    expect(hasAccountSignIn({ identity: { launchWebAuthFlow: () => {} } })).toBe(true)
  })

  it('stops with a plain message and opens nothing', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('browser', {})
    await expect(connect(config)).rejects.toThrow(ACCOUNT_SIGN_IN_UNAVAILABLE)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('starts the flow where the API exists', async () => {
    // Control: the same call with the API present reaches launchWebAuthFlow.
    const launch = vi.fn(async () => {
      throw new Error('stop here')
    })
    vi.stubGlobal('browser', {
      identity: { getRedirectURL: () => 'https://abc.extensions.allizom.org/', launchWebAuthFlow: launch },
    })
    await expect(connect(config)).rejects.toThrow('stop here')
    expect(launch).toHaveBeenCalledTimes(1)
  })
})

describe('screenshots', () => {
  it('are offered by the docked sidebar and not by a panel bound to a page tab', () => {
    expect(screenshotsAvailable()).toBe(true)
    setBoundTab(5)
    expect(screenshotsAvailable()).toBe(false)
  })

  describe('in the background', () => {
    let h: Harness
    beforeEach(() => {
      vi.stubGlobal('matchMedia', () => ({ matches: false }))
      h = createHarness()
    })

    const capture = () =>
      h.onMessage({
        type: 'capture-region',
        tabId: 3,
        rect: { x: 0, y: 0, width: 10, height: 10 },
        viewportWidth: 100,
        url: 'https://example.com/',
      })

    it('are refused with a plain message on Android', async () => {
      h.os = 'android'
      h.tabUrls.set(3, 'https://example.com/')
      await h.boot()
      await new Promise((resolve) => setTimeout(resolve, 20))
      const reply = await capture()
      expect(reply.ok).toBe(false)
      expect(reply.error.message).toBe(SCREENSHOTS_UNAVAILABLE)
    })

    it('are not refused with that message on desktop', async () => {
      h.os = 'linux'
      h.tabUrls.set(3, 'https://example.com/')
      await h.boot()
      await new Promise((resolve) => setTimeout(resolve, 20))
      const reply = await capture()
      expect(reply.error?.message).not.toBe(SCREENSHOTS_UNAVAILABLE)
    })
  })
})
