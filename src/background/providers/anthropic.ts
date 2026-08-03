/**
 * Anthropic adapter.
 *
 * API key only. Anthropic restricted OAuth to Claude Code and Claude.ai in
 * February 2026 and disabled third-party OAuth tokens, so there is no
 * sanctioned OAuth path for this extension. Using Claude Code's client_id to
 * work around that would violate their terms; we do not.
 *
 * The `anthropic-dangerous-direct-browser-access` header enables CORS for
 * direct browser calls. A background-script fetch holding host permissions
 * likely does not need it, but sending it costs nothing and makes the adapter
 * work from any context.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { GenerationResult, ModelReview, PageContext, Provider } from '@shared/types'
import { GENERATE_SYSTEM_PROMPT, REVIEW_SYSTEM_PROMPT, repairPrompt } from '../prompts'
import { readCredentialForRequest } from '../storage'
import {
  GENERATION_SCHEMA,
  ProviderError,
  REVIEW_SCHEMA,
  type AiProvider,
  type GenerateRequest,
} from './types'

/**
 * Anthropic's guidance is that model downgrades are the caller's decision, not
 * the implementer's. Generation quality is the product here, so the default is
 * the current Opus; users pick something cheaper in settings if they prefer.
 */
export const DEFAULT_GENERATE_MODEL = 'claude-opus-5'
export const DEFAULT_REVIEW_MODEL = 'claude-opus-5'

export async function createAnthropicProvider(provider: Provider): Promise<AiProvider> {
  const credential = await readCredentialForRequest(provider.id)
  if (!credential) {
    throw new ProviderError(
      `No API key is configured for ${provider.label}.`,
      'no-credential',
      false,
    )
  }
  if (credential.kind !== 'api_key') {
    throw new ProviderError(
      'Anthropic supports API keys only. OAuth is restricted to Claude Code and Claude.ai.',
      'auth',
      false,
    )
  }

  const client = new Anthropic({
    apiKey: credential.value,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
    maxRetries: 2,
  })

  const generateModel = provider.generateModel || DEFAULT_GENERATE_MODEL
  const reviewModel = provider.reviewModel || DEFAULT_REVIEW_MODEL

  return {
    id: provider.id,

    async supportsVision(): Promise<boolean> {
      // Anthropic publishes capabilities live, so the screenshot gate is a real
      // query rather than a hardcoded table.
      try {
        const model = (await client.models.retrieve(generateModel)) as unknown as {
          capabilities?: Record<string, { supported?: boolean }>
        }
        return model.capabilities?.['image_input']?.supported === true
      } catch {
        // A failed lookup must not silently enable image upload.
        return false
      }
    },

    async generate(request: GenerateRequest): Promise<GenerationResult> {
      const content = buildGenerationContent(request)

      try {
        const response = await client.messages.create({
          model: generateModel,
          max_tokens: 16000,
          system: GENERATE_SYSTEM_PROMPT,
          thinking: { type: 'adaptive' },
          messages: [
            ...request.history.map((turn) => ({
              role: turn.role,
              content: turn.content,
            })),
            { role: 'user' as const, content },
          ],
          // effort and format are both fields of output_config.
          output_config: {
            effort: 'high',
            format: { type: 'json_schema', schema: GENERATION_SCHEMA },
          },
        } as Parameters<typeof client.messages.create>[0])

        return parseJsonResponse<GenerationResult>(response)
      } catch (error) {
        throw toProviderError(error)
      }
    },

    async review(args: { code: string; intent: string }): Promise<ModelReview> {
      // Note what is absent: no PageContext, no URL, no DOM, no screenshot.
      // See REVIEW_SYSTEM_PROMPT for why this matters.
      const body = `INTENT (stated by the user):\n${args.intent}\n\nCODE:\n\`\`\`js\n${args.code}\n\`\`\``

      try {
        const response = await client.messages.create({
          model: reviewModel,
          max_tokens: 4000,
          system: REVIEW_SYSTEM_PROMPT,
          thinking: { type: 'adaptive' },
          messages: [{ role: 'user', content: body }],
          output_config: {
            effort: 'high',
            format: { type: 'json_schema', schema: REVIEW_SCHEMA },
          },
        } as Parameters<typeof client.messages.create>[0])

        return parseJsonResponse<ModelReview>(response)
      } catch (error) {
        throw toProviderError(error)
      }
    },
  }
}

function buildGenerationContent(
  request: GenerateRequest,
): Anthropic.MessageParam['content'] {
  const instruction = request.repair
    ? repairPrompt(request.repair)
    : request.instruction

  const text = `${instruction}\n\n${describeContext(request.context)}`

  const shot = request.context.screenshot
  if (!shot) return text

  const [meta, data] = shot.dataUrl.split(',', 2)
  const mediaType = meta?.match(/data:(image\/\w+)/)?.[1] ?? 'image/png'

  return [
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType as 'image/png', data: data ?? '' },
    },
    {
      type: 'text',
      text: shot.clipped
        ? `${text}\n\nNote: the target is taller than the viewport, so the image shows only the visible portion.`
        : text,
    },
  ]
}

/** Renders extracted page context as text for the model. */
function describeContext(context: PageContext): string {
  const styles = (record: Record<string, string>) =>
    Object.entries(record)
      .map(([property, value]) => `    ${property}: ${value}`)
      .join('\n')

  const ancestors = context.ancestors
    .map((a) => `  ${a.selector}\n${styles(a.computedStyles)}`)
    .join('\n')

  const rules = context.target.matchedRules
    .map((r) => `  ${r.selector}  /* specificity ${r.specificity} */\n    ${r.declarations}`)
    .join('\n')

  const customProperties = Object.entries(context.customProperties)
    .map(([property, value]) => `  ${property}: ${value}`)
    .join('\n')

  return `## Page
URL: ${context.url}

## Target
selector: ${context.target.selector}
tag: ${context.target.tag}

computed styles:
${styles(context.target.computedStyles)}

author rules matching it (most specific last):
${rules || '  (none)'}

## Ancestors (nearest first)
${ancestors || '  (none)'}

## CSS custom properties in scope
${customProperties || '  (none)'}

## Markup excerpt
${context.target.outerHTMLExcerpt}`
}

function parseJsonResponse<T>(response: unknown): T {
  const message = response as {
    stop_reason?: string
    stop_details?: { category?: string; explanation?: string }
    content?: { type: string; text?: string }[]
  }

  // Check stop_reason before touching content: a refusal returns HTTP 200 with
  // empty or partial content, and indexing content[0] blindly throws.
  if (message.stop_reason === 'refusal') {
    throw new ProviderError(
      message.stop_details?.explanation ??
        'The model declined this request. Try rewording what you asked for.',
      'refusal',
      false,
    )
  }

  const text = message.content?.find((block) => block.type === 'text')?.text
  if (!text) {
    throw new ProviderError('The model returned no usable response.', 'bad-response', true)
  }

  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new ProviderError(
      'The model returned a response that could not be read.',
      'bad-response',
      true,
      { cause: error },
    )
  }
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error

  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError(
      'That API key was rejected. Check it in settings.',
      'auth',
      false,
      { cause: error },
    )
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError(
      'Rate limited by the provider. Wait a moment and try again.',
      'rate-limit',
      true,
      { cause: error },
    )
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('Could not reach the provider.', 'network', true, {
      cause: error,
    })
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(
      `Provider returned an error (${error.status ?? 'unknown'}).`,
      'unknown',
      (error.status ?? 0) >= 500,
      { cause: error },
    )
  }

  return new ProviderError(
    error instanceof Error ? error.message : String(error),
    'unknown',
    false,
    { cause: error },
  )
}
