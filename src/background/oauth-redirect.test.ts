/**
 * Requests that carry a secret are made with `redirect: 'error'`, so that a 307
 * or 308 cannot send the secret to another address. `fetch` is replaced with a
 * stub that behaves like the platform: it follows a redirect unless the call
 * says not to, and rejects when the call says 'error'. No network call is made.
 */

import { resetBrowserMock } from './test-support/browser-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import type { OAuthConfig, Provider } from '@shared/types'
import * as storage from './storage'
import { connect } from './oauth'
import { createOpenAiCompatibleProvider } from './providers/openai-compatible'

const TOKEN = 'https://auth.example.com/token'
const config: OAuthConfig = {
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: TOKEN,
  clientId: 'c',
  scopes: [],
}
const provider = {
  id: 'p1',
  label: 'Remote',
  type: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  generateModel: 'm',
  reviewModel: 'm',
  supportsVision: false,
} as unknown as Provider

/** Every URL the stub was asked for, including ones reached by a redirect. */
function redirectingFetch() {
  const reached: string[] = []
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit) => {
    reached.push(url)
    if (url.startsWith('http://evil.example')) return new Response('{}')
    // The first hop answers 307 to a plain-http address.
    if (init.redirect === 'error') throw new TypeError('NetworkError when attempting to fetch resource.')
    reached.push('http://evil.example/collect')
    return new Response('{}')
  }
  return reached
}

beforeEach(() => {
  resetBrowserMock()
  ;(globalThis as unknown as { browser: Record<string, unknown> }).browser['identity'] = {
    getRedirectURL: () => 'https://ext.example/cb',
    launchWebAuthFlow: async ({ url }: { url: string }) => {
      const state = new URL(url).searchParams.get('state')
      return `https://ext.example/cb?code=abc&state=${state}`
    },
  }
})

describe('requests that carry a secret', () => {
  it('does not follow a redirect of the code exchange', async () => {
    const reached = redirectingFetch()
    await expect(connect(config)).rejects.toThrow(/redirected the token request/)
    expect(reached).toEqual([TOKEN])
  })

  it('does not follow a redirect of a refresh', async () => {
    await storage.saveCredentialFor(provider, {
      kind: 'oauth',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() - 1000,
      tokenEndpoint: TOKEN,
      clientId: 'c',
    })
    const reached = redirectingFetch()
    await (await createOpenAiCompatibleProvider(provider)).review({ code: 'x', intent: 'y' }).catch(() => undefined)
    expect(reached).toEqual([TOKEN])
  })

  it('does not follow a redirect of the chat request', async () => {
    await storage.saveCredentialFor(provider, { kind: 'api_key', value: 'sk-secret' })
    const reached = redirectingFetch()
    await (await createOpenAiCompatibleProvider(provider)).review({ code: 'x', intent: 'y' }).catch(() => undefined)
    expect(reached).toEqual(['https://api.example.com/v1/chat/completions'])
  })

  // Control: the stub does follow a redirect when a call does not ask for
  // 'error', so the three results above come from the option and not from a
  // stub that never redirects.
  it('the stub follows a redirect when the option is absent', async () => {
    const reached = redirectingFetch()
    await fetch(TOKEN, { method: 'POST' })
    expect(reached).toEqual([TOKEN, 'http://evil.example/collect'])
  })
})
