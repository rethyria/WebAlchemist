/**
 * A request still in flight to a provider's old base URL must not pick up the
 * token of a refresh that was started for the new address. Runs the real
 * storage and adapter code with `fetch` replaced; no network call is made.
 */

import { localArea, resetBrowserMock } from '../test-support/browser-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@shared/types'
import * as storage from '../storage'
import { createOpenAiCompatibleProvider } from './openai-compatible'

const at = (baseUrl: string): Provider =>
  ({
    id: 'p1',
    label: 'Remote',
    type: 'openai-compatible',
    baseUrl,
    generateModel: 'm',
    reviewModel: 'm',
    supportsVision: false,
  }) as Provider

const OLD = at('https://a.example/v1')
const NEW = at('https://b.example/v1')
const OK = JSON.stringify({ choices: [{ message: { content: '{"verdict":"match","explanation":""}' } }] })
const ARGS = { code: 'x', intent: 'y' }
const TOKEN_ENDPOINT = 'https://auth.example.com/token'

function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => (open = resolve))
  return { promise, open }
}

/**
 * Sets up the sequence from the review: a request to the old address is sent
 * and waits; the credential is re-entered for the new address with an expired
 * token, and a refresh for it starts and waits; then the old request is
 * answered with 401 while that refresh is still running.
 */
async function run() {
  await storage.saveCredentialFor(OLD, {
    kind: 'oauth',
    accessToken: 'oldA',
    refreshToken: 'rA',
    expiresAt: Date.now() + 3_600_000,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: 'c',
  })

  const oldAnswers = gate()
  const refreshAnswers = gate()
  const sent: { url: string; bearer: string }[] = []
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit) => {
    if (url === TOKEN_ENDPOINT) {
      await refreshAnswers.promise
      return new Response(JSON.stringify({ access_token: 'newB', refresh_token: 'rB2', expires_in: 3600 }))
    }
    const bearer = ((init.headers as Record<string, string>)['Authorization'] ?? '').replace('Bearer ', '')
    sent.push({ url, bearer })
    if (url.startsWith('https://a.example')) {
      await oldAnswers.promise
      return new Response('{}', { status: 401 })
    }
    return new Response(OK)
  }

  const oldRequest = (await createOpenAiCompatibleProvider(OLD)).review(ARGS).catch((e: unknown) => e)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(sent).toEqual([{ url: 'https://a.example/v1/chat/completions', bearer: 'oldA' }])

  // The user moves the provider and enters the sign-in again. Its token has
  // expired, so the first request to the new address starts a refresh.
  await storage.saveCredentialFor(NEW, {
    kind: 'oauth',
    accessToken: 'oldB',
    refreshToken: 'rB',
    expiresAt: Date.now() - 1000,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: 'c',
  })
  const newRequest = (await createOpenAiCompatibleProvider(NEW)).review(ARGS).catch((e: unknown) => e)
  await new Promise((resolve) => setTimeout(resolve, 20))

  let oldSettled = false
  void oldRequest.then(() => (oldSettled = true))
  oldAnswers.open()
  await new Promise((resolve) => setTimeout(resolve, 20))
  // Read before the refresh is let go. A request that waited for the refresh
  // would still be pending here.
  const oldSettledBeforeRefreshEnded = oldSettled
  refreshAnswers.open()
  return { sent, oldResult: await oldRequest, newResult: await newRequest, oldSettledBeforeRefreshEnded }
}

beforeEach(() => {
  resetBrowserMock()
})

describe('a refresh for a re-bound credential', () => {
  it('is not joined by a request still going to the old address', async () => {
    const { sent, oldResult, newResult } = await run()

    // The token issued for the new address never reaches the old one.
    expect(sent.filter((s) => s.url.startsWith('https://a.example') && s.bearer === 'newB')).toEqual([])
    expect(sent.filter((s) => s.url.startsWith('https://a.example'))).toHaveLength(1)
    // The old request ends as a credential problem, not as a success.
    expect(oldResult).toMatchObject({ kind: 'no-credential' })

    // Control: the request for the new address completes with the new token,
    // so the sequence did run a refresh and the old request could have joined it.
    expect(newResult).toEqual({ verdict: 'match', explanation: '' })
    expect(sent.some((s) => s.url.startsWith('https://b.example') && s.bearer === 'newB')).toBe(true)
  })

  // Fails on its own when the refresh key is changed back to the provider id
  // alone: the old request then waits for the refresh of the new address, and
  // is refused only after it ends. The re-read after a join would still refuse
  // it, which is why the test above does not catch that change.
  it('is not waited for by a request going to the old address', async () => {
    const { oldSettledBeforeRefreshEnded, oldResult } = await run()
    expect(oldSettledBeforeRefreshEnded).toBe(true)
    expect(oldResult).toMatchObject({ kind: 'no-credential' })
  })
})

describe('a request that joins a refresh for the same address', () => {
  const EXPIRED = {
    kind: 'oauth' as const,
    accessToken: 'stale',
    refreshToken: 'r1',
    expiresAt: Date.now() - 1000,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: 'c',
  }

  /**
   * Two requests find the token expired. The first starts the refresh and the
   * second joins it. When the refresh has stored its token, and before the
   * joiner reads, the stored credential is replaced by an API key, which stands
   * for the sign-in being removed or replaced in that gap.
   */
  async function joinWithReplacement(replace: boolean) {
    await storage.saveCredentialFor(OLD, EXPIRED)
    const refreshAnswers = gate()
    const bearers: string[] = []
    let refreshReturned = false
    let replaced = false
    let refreshes = 0
    ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit) => {
      if (url === TOKEN_ENDPOINT) {
        refreshes += 1
        await refreshAnswers.promise
        refreshReturned = true
        return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }))
      }
      bearers.push(((init.headers as Record<string, string>)['Authorization'] ?? '').replace('Bearer ', ''))
      return new Response(OK)
    }
    // The first read of the credentials after the refresh has been stored.
    const originalGet = localArea.get.bind(localArea)
    localArea.get = (async (keys?: string | string[]) => {
      const stored = (localArea.raw()['credentials'] as Record<string, { accessToken?: string }> | undefined)?.['p1']
      if (replace && refreshReturned && !replaced && stored?.accessToken === 'fresh') {
        replaced = true
        localArea.raw()['credentials'] = {
          p1: { kind: 'api_key', value: 'replacement-key', boundTo: { type: 'openai-compatible', origin: 'https://a.example' } },
        }
      }
      return originalGet(keys)
    }) as typeof localArea.get

    try {
      const first = (await createOpenAiCompatibleProvider(OLD)).review(ARGS)
      const second = (await createOpenAiCompatibleProvider(OLD)).review(ARGS)
      await new Promise((resolve) => setTimeout(resolve, 20))
      refreshAnswers.open()
      await Promise.all([first, second])
    } finally {
      localArea.get = originalGet as typeof localArea.get
    }
    return { bearers, replaced, refreshes }
  }

  it('sends what is stored when it continues, not the token the refresh returned', async () => {
    const { bearers, replaced } = await joinWithReplacement(true)
    expect(replaced).toBe(true)
    // The first request used the token it refreshed; the second read the
    // credential again and found the replacement.
    expect([...bearers].sort()).toEqual(['fresh', 'replacement-key'])
  })

  // Control: without the replacement both requests send the refreshed token,
  // and a single refresh served both, so the second did join.
  it('sends the refreshed token on both requests when nothing was replaced', async () => {
    const { bearers, replaced, refreshes } = await joinWithReplacement(false)
    expect(replaced).toBe(false)
    expect(refreshes).toBe(1)
    expect(bearers).toEqual(['fresh', 'fresh'])
  })
})
