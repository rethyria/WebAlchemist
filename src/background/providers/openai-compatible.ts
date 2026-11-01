/**
 * OpenAI-compatible adapter. Covers OpenRouter, local servers (Ollama,
 * LM Studio, llama.cpp), and anything else exposing /v1/chat/completions.
 *
 * Raw fetch rather than an SDK: the surface used here is two endpoints, and
 * the point of this adapter is tolerating implementations that diverge from
 * the reference spec in small ways.
 *
 * Unlike Anthropic, this ecosystem has no capability endpoint, so vision
 * support cannot be queried and is set by hand on the Provider record.
 */

import type { GenerationResult, ModelReview, Provider } from '@shared/types'
import {
  GENERATE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  fencePageContent,
  repairPrompt,
  scopeInstruction,
} from '../prompts'
import { credentialFrom, needsRefresh, type TokenPayload } from '../oauth'
import { retryAfterSeconds } from './retry-after'
import { readCredentialForRequest, setCredential } from '../storage'
import {
  GENERATION_SCHEMA,
  ProviderError,
  REVIEW_SCHEMA,
  type AiProvider,
  type GenerateRequest,
} from './types'

export async function createOpenAiCompatibleProvider(
  provider: Provider,
): Promise<AiProvider> {
  if (!provider.baseUrl) {
    throw new ProviderError(
      `${provider.label} has no base URL configured.`,
      'no-credential',
      false,
    )
  }
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')

  const authHeader = async (): Promise<Record<string, string>> => {
    const credential = await readCredentialForRequest(provider.id)
    if (!credential) {
      // Local servers frequently accept unauthenticated requests.
      if (isLoopback(baseUrl)) return {}
      throw new ProviderError(
        `No credential is configured for ${provider.label}.`,
        'no-credential',
        false,
      )
    }

    if (credential.kind === 'api_key') {
      return { Authorization: `Bearer ${credential.value}` }
    }

    // OAuth: refresh ahead of expiry rather than after a 401.
    const token = await ensureFreshToken(provider.id, credential)
    return { Authorization: `Bearer ${token}` }
  }

  const complete = async <T>(args: {
    model: string
    system: string
    userContent: unknown
    schema: unknown
    schemaName: string
    maxTokens: number
  }): Promise<T> => {
    /*
     * Built before the `try` below, not inside it. The `catch` turns every
     * error into "could not reach", which is right for `fetch` and wrong for
     * the credential: a locked vault, an expired sign-in and a missing key each
     * carry their own kind, and the sidebar picks its state from it. Wrapping
     * them as retryable network errors let a user retry forever without being
     * told to unlock or reconnect.
     */
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeader()),
    }

    let response: Response
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: args.model,
          max_tokens: args.maxTokens,
          messages: [
            { role: 'system', content: args.system },
            { role: 'user', content: args.userContent },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: args.schemaName, strict: true, schema: args.schema },
          },
        }),
      })
    } catch (error) {
      throw new ProviderError(
        `Could not reach ${provider.label}.`,
        'network',
        true,
        { cause: error },
      )
    }

    if (!response.ok) throw httpToProviderError(response.status, provider.label, response.headers)

    /*
     * A proxy, captive portal or misconfigured local server can answer with an
     * HTML page and status 200. `response.json()` would then raise the
     * browser's own parser message, which says nothing about what went wrong
     * or whose fault it is.
     */
    let payload: { choices?: { message?: { content?: string }; finish_reason?: string }[] }
    try {
      payload = (await response.json()) as typeof payload
    } catch (error) {
      throw new ProviderError(
        `${provider.label} returned a response that is not JSON. Check the base URL in settings.`,
        'bad-response',
        true,
        { cause: error },
      )
    }
    const text = payload.choices?.[0]?.message?.content
    if (!text) {
      throw new ProviderError(
        `${provider.label} returned no usable response.`,
        'bad-response',
        true,
      )
    }

    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new ProviderError(
        `${provider.label} returned a response that could not be read. It may not support structured output.`,
        'bad-response',
        true,
        { cause: error },
      )
    }
  }

  return {
    id: provider.id,

    async supportsVision(): Promise<boolean> {
      // No capability endpoint exists in this ecosystem; the flag is set by hand.
      return provider.supportsVision
    },

    async generate(request: GenerateRequest): Promise<GenerationResult> {
      const instruction = request.repair
        ? repairPrompt(request.repair)
        : request.instruction

      /*
       * Two fixes in one line. The page content is fenced, for the reason in
       * `fencePageContent` — this adapter had the same undelimited
       * concatenation the Anthropic one did, and a worse version of it, since
       * dumping the raw context object hands the model every field verbatim.
       *
       * And the scope choice was being dropped entirely. The user picks whether
       * a change applies to one element or to every element like it inside a
       * named container, and that choice reached the Anthropic adapter and no
       * other — so the same request produced a different transform depending on
       * which provider was configured.
       */
      const text = [
        instruction,
        scopeInstruction(request.scopeDepth, request.scopeContainer ?? null),
        fencePageContent(JSON.stringify(request.context, null, 2)),
      ].join('\n\n')

      const shot = request.context.screenshot
      const userContent = shot
        ? [
            { type: 'text', text },
            { type: 'image_url', image_url: { url: shot.dataUrl } },
          ]
        : text

      return complete<GenerationResult>({
        model: provider.generateModel,
        system: GENERATE_SYSTEM_PROMPT,
        userContent,
        schema: GENERATION_SCHEMA,
        schemaName: 'transform',
        maxTokens: 16000,
      })
    },

    async review(args: { code: string; intent: string }): Promise<ModelReview> {
      // No page content, deliberately. See REVIEW_SYSTEM_PROMPT.
      return complete<ModelReview>({
        model: provider.reviewModel,
        system: REVIEW_SYSTEM_PROMPT,
        userContent: `INTENT (stated by the user):\n${args.intent}\n\nCODE:\n\`\`\`js\n${args.code}\n\`\`\``,
        schema: REVIEW_SCHEMA,
        schemaName: 'review',
        maxTokens: 4000,
      })
    },
  }
}

function isLoopback(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * Refreshes that are running now, one per provider.
 *
 * Providers rotate refresh tokens, so a second request with the token the first
 * one used is rejected, and a provider that follows RFC 9700 section 4.14.2
 * answers reuse by revoking the whole grant. Callers that arrive while a
 * refresh is running wait for it instead of sending their own.
 */
const refreshesInFlight = new Map<string, Promise<string>>()

type OAuthCredential = Extract<
  NonNullable<Awaited<ReturnType<typeof readCredentialForRequest>>>,
  { kind: 'oauth' }
>

function ensureFreshToken(providerId: string, credential: OAuthCredential): Promise<string> {
  if (!needsRefresh(credential.expiresAt, Date.now())) {
    return Promise.resolve(credential.accessToken)
  }
  const running = refreshesInFlight.get(providerId)
  if (running) return running

  const started = (async () => {
    /*
     * The credential is read again, because the caller's copy may be older than
     * a refresh that finished between its read and this point. Without this, a
     * caller that missed the in-flight window would refresh with a token that
     * has already been spent.
     */
    const latest = await readCredentialForRequest(providerId)
    // Removed or replaced while this call was starting. Refreshing the old
    // copy would store it again and undo the removal.
    if (latest?.kind !== 'oauth') {
      throw new ProviderError('The sign-in for this provider was removed. Reconnect it in settings.', 'no-credential', false)
    }
    if (!needsRefresh(latest.expiresAt, Date.now())) return latest.accessToken
    return refreshToken(providerId, latest)
  })().finally(() => {
    refreshesInFlight.delete(providerId)
  })
  refreshesInFlight.set(providerId, started)
  return started
}

/** Refreshes an OAuth token a minute ahead of expiry and persists the result. */
async function refreshToken(
  providerId: string,
  credential: OAuthCredential,
): Promise<string> {
  /*
   * The header call no longer sits inside the chat request's `try`, so a
   * transport failure here has to be classified on its own. It used to be
   * reported as a network failure by that outer `catch`, and still is.
   */
  let response: Response
  try {
    response = await fetch(credential.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credential.refreshToken,
        client_id: credential.clientId,
      }),
    })
  } catch (error) {
    throw new ProviderError('Could not reach the sign-in server.', 'network', true, {
      cause: error,
    })
  }

  if (!response.ok) {
    throw new ProviderError(
      'Sign-in expired. Reconnect this provider in settings.',
      'auth',
      false,
    )
  }

  /*
   * Built by the same function the initial exchange uses, so a refresh cannot
   * drift from a connect — including the part where a response omitting
   * `refresh_token` means "keep the one you have" rather than "you no longer
   * have one".
   */
  let tokens: TokenPayload
  try {
    tokens = (await response.json()) as TokenPayload
  } catch (error) {
    throw new ProviderError(
      'The sign-in server returned a response that is not JSON. Reconnect this provider in settings.',
      'auth',
      false,
      { cause: error },
    )
  }
  const refreshed = credentialFrom(
    tokens,
    { authorizationEndpoint: '', tokenEndpoint: credential.tokenEndpoint, clientId: credential.clientId, scopes: [] },
    Date.now(),
    credential.refreshToken,
  )
  await setCredential(providerId, refreshed)
  return refreshed.accessToken
}

function httpToProviderError(
  status: number,
  label: string,
  headers?: Headers,
): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(
      `${label} rejected the credential. Check it in settings.`,
      'auth',
      false,
    )
  }
  if (status === 429) {
    // This ecosystem does not agree on how to say it — `retry-after`, or one of
    // several `x-ratelimit-reset-*` shapes. retry-after.ts reads whichever came.
    const seconds = retryAfterSeconds(headers, Date.now())
    return new ProviderError(
      seconds === null
        ? `Rate limited by ${label}. Wait a moment and try again.`
        : `Rate limited by ${label}. It asked for ${seconds} seconds.`,
      'rate-limit',
      true,
      seconds === null ? undefined : { retryInSeconds: seconds },
    )
  }
  return new ProviderError(
    `${label} returned an error (${status}).`,
    'unknown',
    status >= 500,
  )
}
