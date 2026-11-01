/**
 * The background script's own enforcement of the endpoint rule. The settings
 * page checks the same rule for the person typing, but a message can reach the
 * background from any extension context without passing through the page, so
 * each place a credential is saved or sent is checked here.
 */

import { localArea, resetBrowserMock } from './test-support/browser-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type OAuthConfig, type Provider, type Settings } from '@shared/types'
import * as storage from './storage'
import { connect } from './oauth'
import { createOpenAiCompatibleProvider } from './providers/openai-compatible'
import { ProviderError } from './providers/types'

const provider = (over: Partial<Provider> = {}): Provider =>
  ({
    id: 'p1',
    label: 'Remote',
    type: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    generateModel: 'm',
    reviewModel: 'm',
    supportsVision: false,
    ...over,
  }) as Provider

const settingsWith = (p: Provider): Settings => ({ ...DEFAULT_SETTINGS, providers: [p] })

const oauth: OAuthConfig = {
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'c',
  scopes: [],
}

function stubFetch() {
  const spy = vi.fn(async () => new Response('{}'))
  ;(globalThis as unknown as { fetch: unknown }).fetch = spy
  return spy
}

beforeEach(() => {
  resetBrowserMock()
})

describe('saving settings with an endpoint stored before the rule', () => {
  const legacy = provider({ baseUrl: 'http://api.example.com/v1' })

  beforeEach(() => {
    // Written directly, as an older version would have stored it.
    localArea.raw()['settings'] = { ...DEFAULT_SETTINGS, providers: [legacy] }
  })

  it('saves an unrelated change while the stored endpoint is still unchanged', async () => {
    await storage.saveSettings({ ...DEFAULT_SETTINGS, providers: [legacy], aiJsKillSwitch: true })
    expect((await storage.getSettings()).aiJsKillSwitch).toBe(true)
  })

  // Controls: the check is not switched off. A changed endpoint, a new
  // provider, and another provider with the same address are all checked.
  it('still refuses a changed endpoint', async () => {
    await expect(
      storage.saveSettings(settingsWith(provider({ baseUrl: 'http://other.example.com/v1' }))),
    ).rejects.toThrow(/https/)
  })

  it('still refuses a new provider with a bad endpoint, even beside the stored one', async () => {
    const added = provider({ id: 'p2', baseUrl: 'http://new.example.com/v1' })
    await expect(
      storage.saveSettings({ ...DEFAULT_SETTINGS, providers: [legacy, added] }),
    ).rejects.toThrow(/https/)
  })

  it('does not treat the same address under another provider id as unchanged', async () => {
    const copy = provider({ id: 'p2', baseUrl: legacy.baseUrl as string })
    await expect(
      storage.saveSettings({ ...DEFAULT_SETTINGS, providers: [legacy, copy] }),
    ).rejects.toThrow(/https/)
  })
})

describe('saving settings', () => {
  it('refuses an http base URL on a remote host and writes nothing', async () => {
    await expect(
      storage.saveSettings(settingsWith(provider({ baseUrl: 'http://api.example.com/v1' }))),
    ).rejects.toThrow(/https/)
    expect(localArea.raw()['settings']).toBeUndefined()
  })

  it.each(['authorizationEndpoint', 'tokenEndpoint'] as const)(
    'refuses an http %s on a remote host',
    async (field) => {
      const bad = { ...oauth, [field]: 'http://auth.example.com/x' }
      await expect(storage.saveSettings(settingsWith(provider({ oauth: bad })))).rejects.toThrow(/https/)
      expect(localArea.raw()['settings']).toBeUndefined()
    },
  )

  it('control: https endpoints and an http loopback base URL are saved', async () => {
    await storage.saveSettings(settingsWith(provider({ oauth })))
    await storage.saveSettings(settingsWith(provider({ baseUrl: 'http://127.0.0.1:1234/v1' })))
    expect(localArea.raw()['settings']).toBeDefined()
  })
})

describe('saving a sign-in credential', () => {
  const credential = (tokenEndpoint: string) => ({
    kind: 'oauth' as const,
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
    tokenEndpoint,
    clientId: 'c',
  })

  it('refuses a token endpoint that would receive the refresh token over http', async () => {
    await expect(storage.setCredential('p1', credential('http://auth.example.com/token'))).rejects.toThrow(/https/)
    expect(localArea.raw()['credentials']).toBeUndefined()
  })

  it('control: an https token endpoint is stored', async () => {
    await storage.setCredential('p1', credential('https://auth.example.com/token'))
    expect((await storage.readStoredCredential('p1'))?.kind).toBe('oauth')
  })
})

describe('starting sign-in', () => {
  it.each(['authorizationEndpoint', 'tokenEndpoint'] as const)(
    'refuses an http %s before opening any window',
    async (field) => {
      const launch = vi.fn()
      ;(globalThis as unknown as { browser: Record<string, unknown> }).browser.identity = {
        getRedirectURL: () => 'https://x.extensions.allizom.org/',
        launchWebAuthFlow: launch,
      }
      await expect(connect({ ...oauth, [field]: 'http://auth.example.com/x' })).rejects.toThrow(/https/)
      expect(launch).not.toHaveBeenCalled()
    },
  )
})

describe('the provider adapter', () => {
  it('refuses an http base URL and sends no request', async () => {
    const spy = stubFetch()
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-secret' })
    const error = await createOpenAiCompatibleProvider(provider({ baseUrl: 'http://api.example.com/v1' })).then(
      (a) => a.review({ code: 'x', intent: 'y' }),
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ProviderError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('refuses to refresh against an http token endpoint stored in a credential', async () => {
    const spy = stubFetch()
    // Written to storage directly, as an older version or another context could.
    localArea.raw()['credentials'] = {
      p1: {
        kind: 'oauth',
        accessToken: 'a',
        refreshToken: 'r-secret',
        expiresAt: 0,
        tokenEndpoint: 'http://auth.example.com/token',
        clientId: 'c',
      },
    }
    const adapter = await createOpenAiCompatibleProvider(provider())
    const error = await adapter.review({ code: 'x', intent: 'y' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('control: an http loopback base URL still reaches fetch', async () => {
    const spy = stubFetch()
    const adapter = await createOpenAiCompatibleProvider(provider({ baseUrl: 'http://127.0.0.1:1234/v1' }))
    await adapter.review({ code: 'x', intent: 'y' }).catch(() => undefined)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
