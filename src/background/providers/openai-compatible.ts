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

import {
  modelDisplayName,
  type Credential,
  type GenerationResult,
  type ModelReview,
  type Provider,
} from '@shared/types'
import {
  GENERATE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  fencePageContent,
  repairPrompt,
  scopeInstruction,
} from '../prompts'
import { TOKEN_REQUEST_TIMEOUT_MS, credentialFrom, needsRefresh, type TokenPayload } from '../oauth'
import { endpointProblem, isLoopbackHostname } from '@shared/endpoint-policy'
import { destinationOf } from '@shared/credential-binding'
import { retryAfterSeconds } from './retry-after'
import { readCredentialOrProviderError, withCredentialOrProviderError } from './credential'
import {
  GENERATION_SCHEMA,
  ProviderError,
  REVIEW_SCHEMA,
  type AiProvider,
  type GenerateRequest,
  type UsageListener,
} from './types'
import { readUsage } from '@shared/usage'

export async function createOpenAiCompatibleProvider(
  provider: Provider,
  onUsage?: UsageListener,
): Promise<AiProvider> {
  if (!provider.baseUrl) {
    throw new ProviderError(
      `${provider.label} has no base URL configured.`,
      'no-credential',
      false,
    )
  }
  const baseProblem = endpointProblem(provider.baseUrl)
  if (baseProblem) {
    throw new ProviderError(
      `The base URL for ${provider.label} is not allowed. ${baseProblem} Change it in settings.`,
      'no-credential',
      false,
    )
  }
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')

  /**
   * `oauthToken` is set when the header carries an access token that could be
   * refreshed, so that a 401 can name the token the server rejected.
   */
  const authHeader = async (): Promise<{ headers: Record<string, string>; oauthToken?: string }> => {
    const credential = await readCredentialOrProviderError(provider)
    if (!credential) {
      // Local servers frequently accept unauthenticated requests.
      if (isLoopback(baseUrl)) return { headers: {} }
      throw new ProviderError(
        `No credential is configured for ${provider.label}.`,
        'no-credential',
        false,
      )
    }

    if (credential.kind === 'api_key') {
      return { headers: { Authorization: `Bearer ${credential.value}` } }
    }

    // OAuth: refresh ahead of expiry when the expiry is known. A 401 is also
    // handled below, for tokens that end early or whose lifetime was assumed.
    const token = await ensureFreshToken(provider, credential)
    return { headers: { Authorization: `Bearer ${token}` }, oauthToken: token }
  }

  const complete = async <T>(args: {
    model: string
    system: string
    userContent: unknown
    schema: unknown
    schemaName: string
    maxTokens: number
  }): Promise<T> => {
    const body = JSON.stringify({
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
    })

    const send = async (auth: Record<string, string>): Promise<Response> => {
      try {
        return await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth },
          // A redirect would re-send the bearer token and the prompt to a
          // location the base URL check never saw.
          redirect: 'error',
          body,
        })
      } catch (error) {
        throw new ProviderError(
          `Could not reach ${provider.label}.`,
          'network',
          true,
          { cause: error },
        )
      }
    }

    /*
     * Read outside `send`, not inside its `try`. The `catch` there turns every
     * error into "could not reach", which is right for `fetch` and wrong for
     * the credential: a locked vault, an expired sign-in and a missing key each
     * carry their own kind, and the sidebar picks its state from it. Wrapping
     * them as retryable network errors let a user retry forever without being
     * told to unlock or reconnect.
     */
    const first = await authHeader()
    let response = await send(first.headers)

    /*
     * A 401 on a sign-in token is not yet a rejected credential. The lifetime
     * is assumed when the server sends no `expires_in`, and a provider can
     * revoke a token early, so the token may simply be dead while the refresh
     * token is good. Refreshing once and sending the request once more tells
     * the two apart: only a second 401 is reported as a rejection. Without
     * this, every request failed until the assumed expiry arrived, up to an
     * hour later, while settings showed the account as signed in.
     *
     * Once, not until it works: a provider that rejects a fresh token is
     * refusing the account, and looping would hammer the token endpoint.
     * The refresh is shared with overlapping calls, so several 401s from one
     * dead token cause one token request.
     */
    if (response.status === 401 && first.oauthToken !== undefined) {
      const token = await refreshAfterRejection(provider, first.oauthToken)
      response = await send({ Authorization: `Bearer ${token}` })
    }

    if (!response.ok) {
      throw await httpToProviderError(response, provider.label, args.model)
    }

    /*
     * A proxy, captive portal or misconfigured local server can answer with an
     * HTML page and status 200. `response.json()` would then raise the
     * browser's own parser message, which says nothing about what went wrong
     * or whose fault it is.
     */
    let payload: {
      choices?: { message?: { content?: string }; finish_reason?: string }[]
      usage?: unknown
    }
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
    /*
     * Reported before the content is checked, because a response that is empty
     * or cannot be parsed was still generated and billed. Many local servers
     * and some gateways omit `usage`; that is reported as null, not zero.
     */
    onUsage?.({
      model: args.model,
      usage: readUsage(payload?.usage, { input: 'prompt_tokens', output: 'completion_tokens' }),
    })
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
    return isLoopbackHostname(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

/**
 * Refreshes that are running now, one per provider and destination.
 *
 * Providers rotate refresh tokens, so a second request with the token the first
 * one used is rejected, and a provider that follows RFC 9700 section 4.14.2
 * answers reuse by revoking the whole grant. Callers that arrive while a
 * refresh is running wait for it instead of sending their own.
 *
 * The key includes the destination because a provider id survives an edit of
 * the base URL. Keyed by id alone, a request still in flight to the old address
 * joined a refresh that had been started for the re-bound credential and was
 * handed the new token, which it then sent to the old address. Callers for
 * different destinations now never share a refresh, and a caller that did wait
 * for one reads the credential again through the binding check instead of
 * using what the refresh returned.
 */
const refreshesInFlight = new Map<string, Promise<string>>()

function refreshKey(provider: Provider): string {
  const destination = destinationOf(provider)
  return `${provider.id}\n${destination?.type ?? ''}\n${destination?.origin ?? ''}`
}

/**
 * The bearer value for this provider after another call's refresh has ended.
 * Read through the binding check, so a credential that now belongs to a
 * different destination is refused here and its token is not returned.
 */
async function tokenAfterJoining(provider: Provider): Promise<string> {
  const credential = await readCredentialOrProviderError(provider)
  if (!credential) {
    throw new ProviderError('The sign-in for this provider was removed. Reconnect it in settings.', 'no-credential', false)
  }
  return credential.kind === 'api_key' ? credential.value : credential.accessToken
}

type OAuthCredential = Extract<Credential, { kind: 'oauth' }>

function ensureFreshToken(
  provider: Provider,
  credential: OAuthCredential,
  /** The access token a server just rejected, when called after a 401. */
  rejected?: string,
): Promise<string> {
  // After a 401 the clock is not consulted: the server has said this token is
  // no good, whatever its recorded expiry.
  const stale = (c: OAuthCredential) =>
    rejected !== undefined ? c.accessToken === rejected : needsRefresh(c.expiresAt, Date.now(), Boolean(c.refreshToken))
  if (!stale(credential)) return Promise.resolve(credential.accessToken)
  const key = refreshKey(provider)
  const running = refreshesInFlight.get(key)
  if (running) return running.then(() => tokenAfterJoining(provider))

  /*
   * The credential is read inside the lock, not taken from the caller. The
   * caller's copy may be older than a refresh that finished between its read
   * and this point, and refreshing with it would send a token that has already
   * been spent. Reading, requesting and storing all happen under the lock; see
   * withCredentialForRequest.
   */
  const started = withCredentialOrProviderError(provider, async (latest, store) => {
    // Removed or replaced while this call was starting. Refreshing the old
    // copy would store it again and undo the removal.
    if (!latest) {
      throw new ProviderError('The sign-in for this provider was removed. Reconnect it in settings.', 'no-credential', false)
    }
    // Replaced by an API key. Both are sent as a bearer token, and a call made
    // a moment later would use the key, so this one does too.
    if (latest.kind === 'api_key') return latest.value
    if (!stale(latest)) return latest.accessToken
    if (!latest.refreshToken) {
      // The provider issued no refresh token, so there is nothing to renew
      // with. Saying so is the point: the generic expiry message tells the
      // person to reconnect without saying that this is how it will always be.
      throw new ProviderError(
        'The sign-in has ended and this provider issued no way to renew it. Sign in again in settings.',
        'auth',
        false,
      )
    }
    const refreshed = await requestRefresh({ ...latest, refreshToken: latest.refreshToken })
    // Not stored when the sign-in was changed behind the lock's back. The token
    // belongs to a grant that is no longer the one on record, so it is not used.
    if (!(await store(refreshed))) {
      throw new ProviderError('The sign-in for this provider changed while it was being renewed. Try again.', 'no-credential', false)
    }
    return refreshed.accessToken
  }).finally(() => {
    refreshesInFlight.delete(key)
  })
  refreshesInFlight.set(key, started)
  return started
}

/**
 * Gets a token to retry with after the server answered 401 to `rejected`.
 *
 * If another call already replaced the token, that one is used and no second
 * refresh is sent. A refresh already running is joined first, because it
 * would produce the replacement.
 */
async function refreshAfterRejection(provider: Provider, rejected: string): Promise<string> {
  // Only waited for. What it returned is not used: the credential is read
  // again below, through the binding check, and that is what is sent.
  await refreshesInFlight.get(refreshKey(provider))
  const credential = await readCredentialOrProviderError(provider)
  if (!credential) {
    throw new ProviderError('The sign-in for this provider was removed. Reconnect it in settings.', 'no-credential', false)
  }
  // Replaced by an API key after the rejected request was sent; retry with it.
  if (credential.kind === 'api_key') return credential.value
  // Replaced by the refresh just waited for, or by another call's.
  if (credential.accessToken !== rejected) return credential.accessToken
  return ensureFreshToken(provider, credential, rejected)
}

/**
 * Sends the refresh request and returns the credential to store. Does not
 * store it; the caller holds the credential lock and decides.
 */
async function requestRefresh(
  credential: OAuthCredential & { refreshToken: string },
): Promise<OAuthCredential> {
  /*
   * The header call no longer sits inside the chat request's `try`, so a
   * transport failure here has to be classified on its own. It used to be
   * reported as a network failure by that outer `catch`, and still is.
   */
  // The endpoint comes from the stored credential, which an older version or
  // another context may have written without the check in setCredential.
  const endpointIssue = endpointProblem(credential.tokenEndpoint)
  if (endpointIssue) {
    throw new ProviderError(
      `The sign-in server address is not allowed. ${endpointIssue} Reconnect this provider in settings.`,
      'auth',
      false,
    )
  }

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
      // A 307 or 308 would send the refresh token to the new location.
      redirect: 'error',
      // The caller holds the credential lock while this waits.
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
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
  /*
   * `credentialFrom` raises a plain Error when the response has no access
   * token. Left as it is, that reached the sidebar with no kind, which shows a
   * generic failure instead of the reconnect state this one needs.
   */
  let refreshed: ReturnType<typeof credentialFrom>
  try {
    refreshed = credentialFrom(
      tokens,
      { authorizationEndpoint: '', tokenEndpoint: credential.tokenEndpoint, clientId: credential.clientId, scopes: [] },
      Date.now(),
      credential.refreshToken,
    )
  } catch (error) {
    throw new ProviderError(
      'The sign-in server returned no access token. Reconnect this provider in settings.',
      'auth',
      false,
      { cause: error },
    )
  }
  // Carried over: the refreshed token goes to the same destination as the one
  // it replaces, and dropping the binding would send it back through migration.
  return {
    ...refreshed,
    ...(credential.boundTo ? { boundTo: credential.boundTo } : {}),
  }
}

/** The fields of an error body that the checks below read. */
interface ErrorFields {
  message: string
  code: string
  type: string
}

/**
 * Reads the error body without letting a missing or non-JSON body raise.
 * Servers in this ecosystem differ in shape: OpenAI nests the fields under
 * `error`, and some local servers send `error` as a plain string.
 */
async function readErrorFields(response: Response): Promise<ErrorFields> {
  const fields: ErrorFields = { message: '', code: '', type: '' }
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown }
    const error = body?.error
    if (typeof error === 'string') fields.message = error
    else if (error && typeof error === 'object') {
      const e = error as { message?: unknown; code?: unknown; type?: unknown }
      fields.message = typeof e.message === 'string' ? e.message : ''
      fields.code = typeof e.code === 'string' ? e.code : ''
      fields.type = typeof e.type === 'string' ? e.type : ''
    } else if (typeof body?.message === 'string') fields.message = body.message
  } catch {
    // No usable body; the status alone decides.
  }
  return fields
}

/**
 * A 404 on the chat endpoint is a missing model only when the server says so.
 * The same status answers a wrong base URL, which the user fixes in a different
 * place, so a 404 with no model wording stays a generic error rather than
 * sending the user to the model setting. OpenAI sends code model_not_found,
 * Ollama words it "model 'x' not found", and OpenRouter says "No endpoints
 * found for x".
 */
function isModelNotFound(fields: ErrorFields): boolean {
  return (
    fields.code === 'model_not_found' ||
    /\bmodel\b/i.test(fields.message) ||
    /no endpoints found/i.test(fields.message)
  )
}

/**
 * A billing problem is 402 (OpenRouter and others) or OpenAI's
 * insufficient_quota, which arrives with status 429. The second is checked
 * before the rate-limit branch, or an empty balance is reported as a wait
 * that never ends.
 */
function isBillingProblem(status: number, fields: ErrorFields): boolean {
  return (
    status === 402 || fields.code === 'insufficient_quota' || fields.type === 'insufficient_quota'
  )
}

async function httpToProviderError(
  response: Response,
  label: string,
  model: string,
): Promise<ProviderError> {
  const { status, headers } = response
  // Only the statuses that can carry these cases have their body read.
  const fields: ErrorFields =
    status === 404 || status === 402 || status === 429
      ? await readErrorFields(response)
      : { message: '', code: '', type: '' }

  if (status === 404 && isModelNotFound(fields)) {
    return new ProviderError(
      `The model ${modelDisplayName(model)} is not available from ${label}. Choose another model in settings.`,
      'model-unavailable',
      false,
    )
  }
  if (isBillingProblem(status, fields)) {
    return new ProviderError(
      `${label} reports a billing problem, such as no remaining credit. Add credit or fix billing with the provider, then try again.`,
      'billing',
      false,
    )
  }

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
