/**
 * Authorization-code flow with PKCE.
 *
 * #32: only token *refresh* existed, so the refresh path was unreachable —
 * there was no way to obtain a token to refresh. This is the missing half.
 *
 * ## Anthropic is out of scope, deliberately
 *
 * Anthropic restricted OAuth to Claude Code and Claude.ai in February 2026 and
 * disabled third-party OAuth tokens. Using Claude Code's client id to get a
 * token would work and would violate their terms, so the Anthropic adapter
 * accepts an API key and nothing else. This module is reachable only from
 * OpenAI-compatible providers that sanction it.
 *
 * ## Why PKCE, in an extension
 *
 * A public client cannot keep a secret — the extension is a zip file the user
 * can read. PKCE replaces the client secret with a value generated per attempt
 * and never transmitted until redemption, so intercepting the authorization
 * code is not enough to exchange it.
 *
 * Everything here that can be tested without a browser is a separate pure
 * function, because the parts that need one cannot be tested at all on this
 * machine: `launchWebAuthFlow` opens a window and waits for a human.
 */

import type { Credential, OAuthConfig } from '@shared/types'

/** RFC 7636 §4.1: 43–128 characters from the unreserved set. */
const VERIFIER_BYTES = 32

/*
 * `identity` is a required permission, not an optional one.
 *
 * It was declared under `optional_permissions` first, because every other
 * permission this extension needs is asked for at the moment it is used, and
 * that is the design. Firefox refuses:
 *
 *   Reading manifest: Warning processing optional_permissions:
 *   Value "identity" must either: … be one of ["userScripts"] …
 *
 * The optional set is a closed list and `identity` is not in it, so there is
 * nothing to request and no gesture to request it with. It sits in
 * `permissions` instead and is held from install.
 *
 * `web-ext lint` reported this only as a generic MANIFEST_OPTIONAL_PERMISSIONS
 * warning; the message above came from Firefox itself.
 */

export interface Pkce {
  verifier: string
  challenge: string
}

/**
 * base64url without padding.
 *
 * Standard base64 is rejected by conforming authorization servers — `+`, `/`
 * and `=` are not in the unreserved set and survive URL encoding badly.
 */
export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function createPkce(): Promise<Pkce> {
  const random = new Uint8Array(VERIFIER_BYTES)
  crypto.getRandomValues(random)
  const verifier = base64url(random)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export function randomState(): string {
  const random = new Uint8Array(16)
  crypto.getRandomValues(random)
  return base64url(random)
}

export function buildAuthorizationUrl(
  config: OAuthConfig,
  args: { challenge: string; state: string; redirectUri: string },
): string {
  const url = new URL(config.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('code_challenge', args.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', args.state)
  if (config.scopes.length > 0) url.searchParams.set('scope', config.scopes.join(' '))
  return url.toString()
}

/**
 * Pulls the code out of what the browser handed back.
 *
 * The state check is not a formality. Without it, an attacker who can cause a
 * redirect to our redirect URI can hand us *their* authorization code, and the
 * user ends up connected to the attacker's account without knowing — their
 * prompts and their pages then go to somebody else's provider account. A
 * mismatch is a refusal, not a warning.
 */
export function parseRedirect(returnedUrl: string, expectedState: string): string {
  let url: URL
  try {
    url = new URL(returnedUrl)
  } catch {
    throw new Error('The sign-in did not complete.')
  }

  // Some servers answer in the fragment rather than the query.
  const params = new URLSearchParams(url.search)
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  const get = (name: string) => params.get(name) ?? fragment.get(name)

  const error = get('error')
  if (error) {
    throw new Error(
      get('error_description') ?? `The provider refused the sign-in (${error}).`,
    )
  }

  const state = get('state')
  if (state !== expectedState) {
    throw new Error('The sign-in response did not match the request, so it was not accepted.')
  }

  const code = get('code')
  if (!code) throw new Error('The provider returned no authorization code.')
  return code
}

export interface TokenPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

/** Default when a server omits `expires_in`, per common practice. */
const ASSUMED_LIFETIME_SECONDS = 3600

/**
 * When a token should be treated as expired.
 *
 * Separated out because "expires_in is seconds from now" is the kind of thing
 * that reads correctly and is off by a factor of a thousand.
 */
export function expiryFrom(payload: TokenPayload, now: number): number {
  return now + (payload.expires_in ?? ASSUMED_LIFETIME_SECONDS) * 1000
}

/** Refresh this far ahead of expiry, so a request in flight does not expire. */
export const REFRESH_MARGIN_MS = 60_000

export function needsRefresh(expiresAt: number, now: number): boolean {
  return expiresAt - REFRESH_MARGIN_MS <= now
}

export function credentialFrom(
  payload: TokenPayload,
  config: OAuthConfig,
  now: number,
  previousRefreshToken?: string,
): Extract<Credential, { kind: 'oauth' }> {
  const refreshToken = payload.refresh_token ?? previousRefreshToken
  if (!payload.access_token || !refreshToken) {
    throw new Error('The provider did not return a usable token.')
  }
  return {
    kind: 'oauth',
    accessToken: payload.access_token,
    refreshToken,
    expiresAt: expiryFrom(payload, now),
    tokenEndpoint: config.tokenEndpoint,
    clientId: config.clientId,
  }
}

/**
 * The half that needs a browser and a person.
 *
 * `launchWebAuthFlow` opens a window, waits for the user to sign in and
 * approve, and resolves with the redirect it was sent to. Nothing about this
 * can be exercised without a real provider and a real click, which is why it is
 * as thin as it is — every decision worth testing has been moved above.
 */
export async function connect(config: OAuthConfig): Promise<Extract<Credential, { kind: 'oauth' }>> {
  const redirectUri = browser.identity.getRedirectURL()
  const { verifier, challenge } = await createPkce()
  const state = randomState()

  const returned = await browser.identity.launchWebAuthFlow({
    url: buildAuthorizationUrl(config, { challenge, state, redirectUri }),
    interactive: true,
  })

  const code = parseRedirect(returned, state)

  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `The provider rejected the sign-in (${response.status}). Check the client id and endpoints in settings.`,
    )
  }

  return credentialFrom((await response.json()) as TokenPayload, config, Date.now())
}
