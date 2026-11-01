/**
 * The binding pass in the onInstalled handler of the real index.ts (#74): it
 * runs before scripts are registered, and a failure is logged without secrets
 * and does not stop the registrations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { createHarness, cssTransform, type Harness } from './test-browser'

let h: Harness
const provider = {
  id: 'p1',
  label: 'Remote',
  type: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  generateModel: 'm',
  reviewModel: 'm',
  supportsVision: false,
}
const jsTransform = () => ({
  ...cssTransform({ id: 'script-1', kind: 'js', code: 'document.title = "x"', origin: 'user' }),
  world: 'USER_SCRIPT',
})
const installed = (reason: string) => h.listeners.get('browser.runtime.onInstalled')!({ reason })
const credential = () => (h.local.get('credentials') as Record<string, { boundTo?: unknown }>)['p1']!

beforeEach(async () => {
  h = createHarness()
  h.hasUserScripts = true
  h.local.set('settings', { ...DEFAULT_SETTINGS, providers: [provider], activeProviderId: 'p1' })
  h.local.set('credentials', { p1: { kind: 'api_key', value: 'sk-secret-value' } })
  h.local.set('transforms', [jsTransform()])
  await h.boot()
  h.userScriptsHeld.clear()
})

afterEach(() => vi.restoreAllMocks())

describe('onInstalled', () => {
  it('binds the stored keys before it registers any script', async () => {
    let boundAtFirstRegistration: unknown = 'no registration'
    const set = h.userScriptsHeld.set.bind(h.userScriptsHeld)
    h.userScriptsHeld.set = (key, value) => {
      if (boundAtFirstRegistration === 'no registration') boundAtFirstRegistration = credential().boundTo
      return set(key, value)
    }

    await installed('update')

    expect(boundAtFirstRegistration).toMatchObject({ origin: 'https://api.example.com' })
  })

  // Control: the observer does see a registration, so the test above is not
  // passing because none happened.
  it('registers the script', async () => {
    await installed('update')
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
  })

  it('also runs on a first install, and does not run for other reasons', async () => {
    await installed('browser_update')
    expect(credential().boundTo).toBeUndefined()
    await installed('install')
    expect(credential().boundTo).toBeDefined()
  })

  it('logs a failure without the secret, and still registers the script', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A sealed vault that is locked makes the pass throw.
    h.local.set('credentials', { sealed: true, salt: 'x', iv: 'x', data: 'x' })
    const { isSealed } = await import('./vault')
    expect(isSealed(h.local.get('credentials'))).toBe(true)

    await installed('update')

    expect(logged).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls[0])).toMatch(/Binding stored credentials failed/)
    expect(String(logged.mock.calls[0])).not.toContain('sk-secret-value')
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
  })
})
