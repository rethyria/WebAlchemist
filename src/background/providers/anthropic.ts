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
import {
  modelDisplayName,
  type GenerationResult,
  toGenerationResult,
  type ModelReview,
  type PageContext,
  type Provider,
} from '@shared/types'
import {
  ASK_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  askContent,
  fencePageContent,
  fenceSavedTransform,
  pageDataSections,
  randomNonce,
  generationInstruction,
  repairPrompt,
  reviewContent,
  scopeInstruction,
} from '../prompts'
import { retryAfterSeconds, type HeaderSource } from './retry-after'
import { readCredentialOrProviderError } from './credential'
import {
  ASK_SCHEMA,
  GENERATION_SCHEMA,
  ProviderError,
  REVIEW_SCHEMA,
  isModelNotPermitted,
  modelNotPermittedError,
  type AiProvider,
  type AskRequest,
  type AskResult,
  type GenerateRequest,
  type ReviewArgs,
  type StreamListener,
  type ThinkingListener,
  type UsageListener,
} from './types'
import { readUsage } from '@shared/usage'

/**
 * Anthropic's guidance is that model downgrades are the caller's decision, not
 * the implementer's. Generation quality is the product here, so the default is
 * the current Opus; users pick something cheaper in settings if they prefer.
 */
import { DEFAULT_GENERATE_MODEL, DEFAULT_REVIEW_MODEL } from '@shared/types'
import { t } from '@shared/i18n'
export { DEFAULT_GENERATE_MODEL, DEFAULT_REVIEW_MODEL }

/**
 * Request fields that only some models accept, and how to take them back off.
 *
 * The panel lets any model be chosen for either role, including by typing an
 * id that is not in the list, and the models do not agree on what a request
 * may contain. Picking Haiku 4.5 for the review pass — the cheap option, and
 * an entirely sensible choice for it — produced a 400 at the moment of saving
 * a transform, with nothing to say why.
 *
 * Rather than a table of which model supports what, which is a thing that
 * goes stale silently, the API is asked. It names the parameter it rejected,
 * that parameter comes off, and the request goes again. A model that accepts
 * everything pays nothing for this; one that does not costs a round trip that
 * was never going to be billed, since a rejected request runs no inference.
 *
 * Matching is on the specific wording of each rejection, so this can only
 * ever drop a field the API objected to by name. Any other 400 is a real
 * error and is raised as one.
 */
const DOWNGRADES: { readonly rejected: RegExp; readonly without: (body: Body) => Body }[] = [
  {
    rejected: /adaptive thinking is not supported/i,
    without: ({ thinking: _thinking, ...rest }) => rest,
  },
  {
    rejected: /does not support the effort parameter/i,
    without: (body) => {
      const config = { ...(body['output_config'] as Body | undefined) }
      delete config['effort']
      return { ...body, output_config: config }
    },
  },
]

type Body = Record<string, unknown>

/**
 * Calls, and on a rejection that names one of the fields above, calls again
 * without it. At most one attempt per field, so this always terminates.
 */
async function withoutUnsupportedFields<T>(
  body: Body,
  call: (body: Body) => Promise<T>,
): Promise<T> {
  let current = body
  const spent = new Set<number>()

  for (;;) {
    try {
      return await call(current)
    } catch (error) {
      const message = error instanceof Anthropic.APIError ? String(error.message ?? '') : ''
      const index = DOWNGRADES.findIndex(
        (rule, at) => !spent.has(at) && rule.rejected.test(message),
      )
      if (index === -1) throw error
      spent.add(index)
      current = (DOWNGRADES[index] as (typeof DOWNGRADES)[number]).without(current)
    }
  }
}

export async function createAnthropicProvider(
  provider: Provider,
  onUsage?: UsageListener,
): Promise<AiProvider> {
  const credential = await readCredentialOrProviderError(provider)
  if (!credential) {
    throw new ProviderError(
      t('bgNoApiKeyIsConfiguredFor', provider.label),
      'no-credential',
      false,
    )
  }
  if (credential.kind !== 'api_key') {
    throw new ProviderError(
      t('bgAnthropicSupportsApiKeysOnlyOauth'),
      'auth',
      false,
    )
  }

  const client = new Anthropic({
    apiKey: credential.value,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
    maxRetries: 2,
    // A redirect would re-send the x-api-key header and the prompt to the
    // address in the Location header. The request goes to a fixed address and
    // never needs a redirect, so one is treated as a failure.
    fetchOptions: { redirect: 'error' },
  })

  const generateModel = provider.generateModel || DEFAULT_GENERATE_MODEL
  const reviewModel = provider.reviewModel || DEFAULT_REVIEW_MODEL

  /*
   * Only input_tokens and output_tokens are read. Thinking tokens are already
   * inside output_tokens, and the adapter sends no cache_control, so the cache
   * counters are always zero here and are left out rather than priced at a
   * rate this file does not know.
   */
  const reportUsage = (model: string, response: unknown) =>
    onUsage?.({
      model,
      usage: readUsage((response as { usage?: unknown } | null)?.usage, {
        input: 'input_tokens',
        output: 'output_tokens',
      }),
    })

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
        const response = await withoutUnsupportedFields(
          {
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
          },
          (body) =>
            client.messages.create(
              body as unknown as Parameters<typeof client.messages.create>[0],
              request.signal ? { signal: request.signal } : undefined,
            ),
        )

        reportUsage(generateModel, response)
        return toGenerationResult(parseJsonResponse<Record<string, unknown>>(response))
      } catch (error) {
        throw toProviderError(error, { model: generateModel, label: provider.label })
      }
    },

    /**
     * Streaming is for the progress display, and for that alone.
     *
     * It is *not* what keeps the background page alive — this comment used to
     * say it was, and that was wrong. Firefox's idle timer is reset by parent
     * API calls, not by bytes arriving on a fetch, so a stream that is merely
     * open is as invisible to it as a request that has sent nothing. See
     * keepalive.ts; every call into here is wrapped in withKeepalive.
     */
    async generateStream(
      request: GenerateRequest,
      onChunk: StreamListener,
      onThinking?: ThinkingListener,
    ): Promise<GenerationResult> {
      const content = buildGenerationContent(request)

      try {
        /*
         * The whole stream is the retryable unit, not just its construction:
         * a rejected request emits nothing before it fails, so a second
         * attempt starts from an empty accumulator and the panel never sees
         * the difference.
         */
        const final = await withoutUnsupportedFields(
          {
            model: generateModel,
            max_tokens: 16000,
            system: GENERATE_SYSTEM_PROMPT,
            /*
             * `display` is an opt-in. On Opus 5 the default omits the reasoning
             * text entirely, so `thinking_delta` never arrives and the stream is
             * silent until the answer starts — which is exactly the stretch the
             * panel had nothing to report. The non-streaming calls below leave
             * it off: nothing there reads the reasoning, so paying for it would
             * buy nothing.
             */
            thinking: { type: 'adaptive', display: 'summarized' },
            messages: [
              ...request.history.map((turn) => ({
                role: turn.role,
                content: turn.content,
              })),
              { role: 'user' as const, content },
            ],
            output_config: {
              effort: 'high',
              format: { type: 'json_schema', schema: GENERATION_SCHEMA },
            },
          },
          async (payload) => {
            const stream = client.messages.stream(
              payload as unknown as Parameters<typeof client.messages.stream>[0],
              request.signal ? { signal: request.signal } : undefined,
            )

            let accumulated = ''
            stream.on('text', (delta: string) => {
              accumulated += delta
              onChunk(accumulated)
            })

            /*
             * Reasoning is a separate event from output. With adaptive thinking
             * at high effort it is also the entire first stretch of the request
             * — on a hard change the model can reason well past thirty seconds
             * before emitting a single character of the response — so
             * subscribing only to `text` left the panel with nothing to report
             * for that whole period.
             */
            let thought = 0
            stream.on('thinking', (delta: string) => {
              thought += delta.length
              onThinking?.(thought)
            })

            try {
              return await stream.finalMessage()
            } catch (error) {
              /*
               * An aborted generation makes finalMessage() throw, so the
               * report after this call never runs. The tokens counted in the
               * message events received before the abort are still billed, so
               * they are reported here (#71). The message is absent when the
               * abort came before the first event.
               */
              const partial = stream.currentMessage
              if (partial?.usage) reportUsage(generateModel, partial)
              throw error
            }
          },
        )

        reportUsage(generateModel, final)
        return toGenerationResult(parseJsonResponse<Record<string, unknown>>(final))
      } catch (error) {
        throw toProviderError(error, { model: generateModel, label: provider.label })
      }
    },

    /**
     * A side question about the draft. It streams so the panel can show the
     * answer as it is written. The configured generation model answers it, with
     * adaptive thinking at medium effort where the model supports them; a
     * rejected field is taken off by `withoutUnsupportedFields` as for
     * generation. The reply is capped at 8000 tokens, which is far more than the
     * prompt asks for, so a cut-off reply is unusual.
     */
    async ask(request: AskRequest, onChunk?: StreamListener): Promise<AskResult> {
      const content = buildAskContent(request)

      try {
        const final = await withoutUnsupportedFields(
          {
            model: generateModel,
            max_tokens: ASK_MAX_TOKENS,
            system: ASK_SYSTEM_PROMPT,
            thinking: { type: 'adaptive' },
            messages: [
              ...request.history.map((turn) => ({
                role: turn.role,
                content: turn.content,
              })),
              { role: 'user' as const, content },
            ],
            output_config: {
              effort: 'medium',
              format: { type: 'json_schema', schema: ASK_SCHEMA },
            },
          },
          async (payload) => {
            const stream = client.messages.stream(
              payload as unknown as Parameters<typeof client.messages.stream>[0],
              request.signal ? { signal: request.signal } : undefined,
            )

            let accumulated = ''
            stream.on('text', (delta: string) => {
              accumulated += delta
              onChunk?.(accumulated)
            })

            try {
              return await stream.finalMessage()
            } catch (error) {
              // As in generateStream: tokens counted before an abort are billed.
              const partial = stream.currentMessage
              if (partial?.usage) reportUsage(generateModel, partial)
              throw error
            }
          },
        )

        reportUsage(generateModel, final)
        return toAskResult(parseJsonResponse<unknown>(final))
      } catch (error) {
        throw toProviderError(error, { model: generateModel, label: provider.label })
      }
    },

    async review(args: ReviewArgs): Promise<ModelReview> {
      // Note what is absent: no PageContext, no URL, no DOM, no screenshot.
      // See REVIEW_SYSTEM_PROMPT for why this matters.
      const body = reviewContent(args)

      try {
        const response = await withoutUnsupportedFields(
          {
            model: reviewModel,
            max_tokens: 4000,
            system: REVIEW_SYSTEM_PROMPT,
            thinking: { type: 'adaptive' },
            messages: [{ role: 'user', content: body }],
            output_config: {
              effort: 'high',
              format: { type: 'json_schema', schema: REVIEW_SCHEMA },
            },
          },
          (payload) =>
            client.messages.create(
              payload as unknown as Parameters<typeof client.messages.create>[0],
            ),
        )

        reportUsage(reviewModel, response)
        return parseJsonResponse<ModelReview>(response)
      } catch (error) {
        throw toProviderError(error, { model: reviewModel, label: provider.label })
      }
    },
  }
}

/** Largest reply to a side question, in tokens. */
const ASK_MAX_TOKENS = 8000

/** The message of a side question: the same page description and screenshot rule as a generation. */
export function buildAskContent(request: AskRequest): Anthropic.MessageParam['content'] {
  const nonce = randomNonce()
  const text = askContent(
    request,
    describeContext(request.context) + pageDataSections(request, nonce),
    nonce,
  )
  return withScreenshot(text, request.context)
}

/** Checks the shape of a side-question reply, which the schema should already guarantee. */
function toAskResult(parsed: unknown): AskResult {
  const answer = (parsed as { answer?: unknown } | null)?.answer
  if (typeof answer !== 'string') {
    throw new ProviderError(t('bgTheModelReturnedAResponseThat'), 'bad-response', true)
  }
  return { answer }
}

export function buildGenerationContent(
  request: GenerateRequest,
): Anthropic.MessageParam['content'] {
  // One value for every fence and section name in this request, so the
  // instruction can name sections the page's own text cannot imitate.
  const nonce = randomNonce()
  const instruction = request.repair ? repairPrompt(nonce) : generationInstruction(request, nonce)

  /*
   * Instruction first, then the data, fenced. The order matters as much as the
   * fence: what the user asked for is stated before any page-controlled text
   * has been read, so the request cannot be reframed by content arriving after
   * it. On repair the saved transform is data too, in its own block. See
   * `fencePageContent` and `fenceSavedTransform`.
   */
  const text = [
    instruction,
    scopeInstruction(request.scopeDepth, request.scopeContainer ?? null, nonce),
    ...(request.repair ? [fenceSavedTransform(request.repair, nonce)] : []),
    fencePageContent(describeContext(request.context) + pageDataSections(request, nonce), nonce),
  ].join('\n\n')

  return withScreenshot(text, request.context)
}

/** The text with the screenshot, when one was opted into, in front of it. */
function withScreenshot(text: string, context: PageContext): Anthropic.MessageParam['content'] {
  const shot = context.screenshot
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

  /*
   * Rendered only when there are any, and labelled as context rather than as
   * further targets. The user pointed at these to be able to talk about them;
   * whether the transform should touch them is something their instruction
   * says, not something their having pointed implies.
   */
  const references = (context.references ?? [])
    .map(
      (element) => `  ${element.selector}  (${element.tag})
  computed styles:
${styles(element.computedStyles)}
  author rules matching it (most specific last):
${
  element.matchedRules
    .map((r) => `    ${r.selector}  /* specificity ${r.specificity} */\n      ${r.declarations}`)
    .join('\n') || '    (none)'
}
  markup excerpt:
    ${element.outerHTMLExcerpt}`,
    )
    .join('\n\n')

  const referenceSection = references
    ? `

## Also pointed at
These are for reference. Act on the Target above unless the instruction says
otherwise; these are here so the instruction can refer to them by name.

${references}`
    : ''

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
${customProperties || '  (none)'}${referenceSection}

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
        t('bgTheModelDeclinedThisRequestTry'),
      'refusal',
      false,
    )
  }

  const text = message.content?.find((block) => block.type === 'text')?.text
  if (!text) {
    throw new ProviderError(t('bgTheModelReturnedNoUsableResponse'), 'bad-response', true)
  }

  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new ProviderError(
      t('bgTheModelReturnedAResponseThat'),
      'bad-response',
      true,
      { cause: error },
    )
  }
}

/**
 * Whether an API error means the account cannot pay for requests.
 *
 * Anthropic reports an empty balance as HTTP 400 with the error type
 * invalid_request_error and the text "Your credit balance is too low", so the
 * documented billing_error type and status 402 are not enough on their own;
 * the wording is the only signal for that case.
 */
function isBillingError(error: InstanceType<typeof Anthropic.APIError>): boolean {
  return (
    error.type === 'billing_error' ||
    error.status === 402 ||
    /credit balance is too low/i.test(String(error.message ?? ''))
  )
}

function toProviderError(
  error: unknown,
  context: { model: string; label: string },
): ProviderError {
  if (error instanceof ProviderError) return error

  /*
   * Checked before the generic API branch below, which would report both as
   * "Provider returned an error" with no way out. A 404 alone is not enough:
   * the type has to be not_found_error and the text has to name the model,
   * because the same status answers a wrong path. Anthropic words it
   * "model: <id>".
   */
  if (
    error instanceof Anthropic.NotFoundError &&
    isModelNotPermitted(String(error.message ?? ''))
  ) {
    return modelNotPermittedError(context.model, context.label, error)
  }
  if (
    error instanceof Anthropic.NotFoundError &&
    error.type === 'not_found_error' &&
    /\bmodel\b/i.test(String(error.message ?? ''))
  ) {
    return new ProviderError(
      t('bgTheModelIsNotAvailableFrom', modelDisplayName(context.model), context.label),
      'model-unavailable',
      false,
      { cause: error },
    )
  }
  if (error instanceof Anthropic.APIError && isBillingError(error)) {
    return new ProviderError(
      t('bgReportsABillingProblemSuchAs', context.label),
      'billing',
      false,
      { cause: error },
    )
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError(
      t('bgThatApiKeyWasRejectedCheck'),
      'auth',
      false,
      { cause: error },
    )
  }
  if (error instanceof Anthropic.RateLimitError) {
    /*
     * The SDK exposes the response headers on the error. Reading the wait from
     * them is what turns #35's placeholder into a countdown — and when they say
     * nothing, saying nothing is the right answer rather than counting down
     * from a number we invented.
     */
    const seconds = retryAfterSeconds(error.headers as HeaderSource | undefined, Date.now())
    return new ProviderError(
      seconds === null
        ? t('bgRateLimitedByTheProviderWait')
        : t('bgRateLimitedByTheProviderIt', seconds),
      'rate-limit',
      true,
      { cause: error, ...(seconds === null ? {} : { retryInSeconds: seconds }) },
    )
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError(t('bgCouldNotReachTheProvider'), 'network', true, {
      cause: error,
    })
  }
  if (error instanceof Anthropic.APIError) {
    /*
     * The provider's own words, not just its status code.
     *
     * This used to read "Provider returned an error (400)." and nothing else,
     * which told the user nothing and cost a session of bisecting request
     * bodies against the live API to discover that the message had said
     * "adaptive thinking is not supported on this model" all along. An error
     * that names its cause is the difference between a report and a repro.
     */
    const detail = String(error.message ?? '').trim()
    return new ProviderError(
      detail
        ? t('bgProviderReturnedAnError', error.status ?? 'unknown', detail)
        : t('bgProviderReturnedAnError2', error.status ?? 'unknown'),
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
