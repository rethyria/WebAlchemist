/**
 * Everything about the OAuth flow that can be checked without a person.
 *
 * The flow itself cannot be: `launchWebAuthFlow` opens a window and waits for
 * someone to sign in. That half is deliberately thin, and everything with a
 * decision in it is here.
 */

import { describe, expect, it } from 'vitest'
import type { OAuthConfig } from '@shared/types'
import {
  REFRESH_MARGIN_MS,
  base64url,
  buildAuthorizationUrl,
  createPkce,
  credentialFrom,
  expiryFrom,
  needsRefresh,
  parseRedirect,
  randomState,
} from './oauth'

const config: OAuthConfig = {
  authorizationEndpoint: 'https://provider.example/oauth/authorize',
  tokenEndpoint: 'https://provider.example/oauth/token',
  clientId: 'web-alchemist',
  scopes: ['models.read', 'completions'],
}

describe('PKCE', () => {
  it('derives the challenge as base64url of the verifier’s SHA-256', async () => {
    const { verifier, challenge } = await createPkce()
    // Computed independently rather than by calling the same helper, or this
    // would only prove the function agrees with itself.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const expected = Buffer.from(new Uint8Array(digest))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(challenge).toBe(expected)
  })

  it('produces a verifier in the length RFC 7636 allows', async () => {
    const { verifier } = await createPkce()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  it('uses only unreserved characters, so nothing survives URL encoding wrongly', async () => {
    const { verifier, challenge } = await createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('is different every time', async () => {
    const many = await Promise.all(Array.from({ length: 16 }, () => createPkce()))
    expect(new Set(many.map((p) => p.verifier)).size).toBe(16)
    expect(new Set(Array.from({ length: 16 }, () => randomState())).size).toBe(16)
  })

  /* The control: base64url has to actually differ from base64 where it should. */
  it('encodes without +, / or padding', () => {
    // 0xfb 0xff produces '+' and '/' in standard base64.
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-')
    expect(Buffer.from([0xfb, 0xff, 0xfe]).toString('base64')).toBe('+//+')
  })
})

describe('the authorization URL', () => {
  const url = new URL(
    buildAuthorizationUrl(config, {
      challenge: 'CHALLENGE',
      state: 'STATE',
      redirectUri: 'moz-extension://abc/redirect',
    }),
  )

  it('asks for a code with S256, not plain', () => {
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe('CHALLENGE')
  })

  it('carries the client, redirect, state and scopes', () => {
    expect(url.searchParams.get('client_id')).toBe('web-alchemist')
    expect(url.searchParams.get('redirect_uri')).toBe('moz-extension://abc/redirect')
    expect(url.searchParams.get('state')).toBe('STATE')
    expect(url.searchParams.get('scope')).toBe('models.read completions')
  })

  it('never sends the verifier', () => {
    expect(url.toString()).not.toContain('code_verifier')
  })

  it('omits scope entirely when there are none', () => {
    const bare = new URL(
      buildAuthorizationUrl(
        { ...config, scopes: [] },
        { challenge: 'C', state: 'S', redirectUri: 'r' },
      ),
    )
    expect(bare.searchParams.has('scope')).toBe(false)
  })
})

describe('reading the redirect back', () => {
  it('returns the code when the state matches', () => {
    expect(parseRedirect('moz-extension://abc/redirect?code=CODE&state=S', 'S')).toBe('CODE')
  })

  it('accepts a fragment response as well as a query one', () => {
    expect(parseRedirect('moz-extension://abc/redirect#code=CODE&state=S', 'S')).toBe('CODE')
  })

  /*
   * The one that matters. Without the state check, anyone who can cause a
   * redirect to our redirect URI can hand us their own authorization code, and
   * the user is silently connected to somebody else's account.
   */
  it('refuses a code that came back with the wrong state', () => {
    expect(() => parseRedirect('moz-extension://abc/redirect?code=CODE&state=OTHER', 'S')).toThrow(
      /did not match/,
    )
  })

  it('refuses a code that came back with no state at all', () => {
    expect(() => parseRedirect('moz-extension://abc/redirect?code=CODE', 'S')).toThrow(/did not match/)
  })

  it('reports the provider’s own refusal rather than a generic failure', () => {
    expect(() =>
      parseRedirect(
        'moz-extension://abc/redirect?error=access_denied&error_description=You+said+no&state=S',
        'S',
      ),
    ).toThrow(/You said no/)
  })

  it('refuses a response carrying a state but no code', () => {
    expect(() => parseRedirect('moz-extension://abc/redirect?state=S', 'S')).toThrow(/no authorization code/)
  })
})

describe('expiry arithmetic', () => {
  const now = 1_700_000_000_000

  it('reads expires_in as seconds, not milliseconds', () => {
    expect(expiryFrom({ expires_in: 3600 }, now)).toBe(now + 3_600_000)
  })

  it('assumes an hour when the server omits it', () => {
    expect(expiryFrom({}, now)).toBe(now + 3_600_000)
  })

  it('refreshes ahead of expiry rather than after it', () => {
    expect(needsRefresh(now + REFRESH_MARGIN_MS + 1000, now)).toBe(false)
    expect(needsRefresh(now + REFRESH_MARGIN_MS - 1000, now)).toBe(true)
  })

  it('treats an already-expired token as needing a refresh', () => {
    expect(needsRefresh(now - 1, now)).toBe(true)
  })

  /* The control: a margin of zero would pass the two tests above by accident. */
  it('uses a margin that is actually non-zero', () => {
    expect(REFRESH_MARGIN_MS).toBeGreaterThan(0)
    expect(needsRefresh(now + 1, now)).toBe(true)
  })
})

describe('building the stored credential', () => {
  const now = 1_700_000_000_000

  it('keeps the endpoint and client so a refresh needs no provider lookup', () => {
    const credential = credentialFrom(
      { access_token: 'A', refresh_token: 'R', expires_in: 60 },
      config,
      now,
    )
    expect(credential).toEqual({
      kind: 'oauth',
      accessToken: 'A',
      refreshToken: 'R',
      expiresAt: now + 60_000,
      tokenEndpoint: config.tokenEndpoint,
      clientId: config.clientId,
    })
  })

  /*
   * A refresh response often omits refresh_token, meaning "keep the one you
   * have". Dropping it there would sign the user out an hour later, which is
   * the kind of bug that looks like the provider's fault.
   */
  it('keeps the previous refresh token when the response omits one', () => {
    const credential = credentialFrom({ access_token: 'A2' }, config, now, 'OLD-R')
    expect(credential.refreshToken).toBe('OLD-R')
  })

  it('refuses a response with no access token', () => {
    expect(() => credentialFrom({ refresh_token: 'R' }, config, now)).toThrow(/usable token/)
  })

  it('refuses a first response with no refresh token and nothing to fall back on', () => {
    expect(() => credentialFrom({ access_token: 'A' }, config, now)).toThrow(/usable token/)
  })
})
