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
    let response: Response
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeader()),
        },
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

    if (!response.ok) throw httpToProviderError(response.status, provider.label)

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[]
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

/** Refreshes an OAuth token a minute ahead of expiry and persists the result. */
async function ensureFreshToken(
  providerId: string,
  credential: Extract<
    NonNullable<Awaited<ReturnType<typeof readCredentialForRequest>>>,
    { kind: 'oauth' }
  >,
): Promise<string> {
  const REFRESH_MARGIN_MS = 60_000
  if (credential.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return credential.accessToken
  }

  const response = await fetch(credential.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
      client_id: credential.clientId,
    }),
  })

  if (!response.ok) {
    throw new ProviderError(
      'Sign-in expired. Reconnect this provider in settings.',
      'auth',
      false,
    )
  }

  const payload = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  const refreshed = {
    ...credential,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? credential.refreshToken,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  }
  await setCredential(providerId, refreshed)
  return refreshed.accessToken
}

function httpToProviderError(status: number, label: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(
      `${label} rejected the credential. Check it in settings.`,
      'auth',
      false,
    )
  }
  if (status === 429) {
    return new ProviderError(
      `Rate limited by ${label}. Wait a moment and try again.`,
      'rate-limit',
      true,
    )
  }
  return new ProviderError(
    `${label} returned an error (${status}).`,
    'unknown',
    status >= 500,
  )
}
