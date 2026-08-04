import type {
  GenerationResult,
  ModelReview,
  PageContext,
  Provider,
} from '@shared/types'

/** One conversational turn during refinement. */
export interface RefinementTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerateRequest {
  context: PageContext
  /** The user's latest instruction. */
  instruction: string
  /** Distance up the ancestor chain the result should cover. See ScopeDepth. */
  scopeDepth?: number
  /** Selector of the container that depth resolves to, for the prompt. */
  scopeContainer?: string | null
  /**
   * Prior turns in this refinement session. Discarded on save — only the
   * consolidated intent is persisted.
   */
  history: RefinementTurn[]
  /** Present on repair, absent on first generation. */
  repair?: {
    intent: string
    previousCode: string
    previousRationale: GenerationResult['rationale']
    brokenReason: string
  }
}

/**
 * Every provider implements this. Adapters are responsible for their own auth
 * shape; callers only ever hand over a Provider and get results back.
 */
/** Raw response text so far, for the panel to show code as it is written. */
export type StreamListener = (accumulated: string) => void

/**
 * Notified while the model reasons, before any response text exists.
 *
 * Reasoning arrives on a different stream event from output, and on a hard
 * request it is the whole first half of the wait. Without this the panel had
 * nothing to say for thirty seconds and sat on "sent", which read as a hang.
 *
 * The argument is a character count rather than the reasoning itself: the
 * panel only needs to show that something is happening, and shipping the text
 * across the port would put the model's reasoning somewhere it is not
 * displayed and was never asked for.
 */
export type ThinkingListener = (characters: number) => void

export interface AiProvider {
  readonly id: string

  generate(request: GenerateRequest): Promise<GenerationResult>

  /**
   * The same call, reporting the raw response as it arrives.
   *
   * Optional because not every endpoint streams usefully. Where it is absent
   * the caller falls back to `generate`, and the panel shows an honest
   * indeterminate wait rather than pretending to stream.
   */
  generateStream?(
    request: GenerateRequest,
    onChunk: StreamListener,
    onThinking?: ThinkingListener,
  ): Promise<GenerationResult>

  /**
   * Reviews generated JavaScript against the stated intent.
   *
   * Implementations MUST NOT include page content in this call. The reviewer's
   * independence comes entirely from not sharing the generator's context: a
   * page that can steer the generator can steer a reviewer that reads it too.
   */
  review(args: { code: string; intent: string }): Promise<ModelReview>

  /**
   * Whether the configured generation model accepts images, used to decide
   * whether the screenshot option is offered at all.
   */
  supportsVision(): Promise<boolean>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'no-credential'
      | 'auth'
      | 'rate-limit'
      | 'network'
      | 'refusal'
      | 'bad-response'
      | 'unknown',
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ProviderError'
  }
}

export type ProviderFactory = (provider: Provider) => Promise<AiProvider>

/* ------------------------------------------------------------------ */
/* Response schemas, shared across adapters                            */
/* ------------------------------------------------------------------ */

export const GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Short literal name for this transform, e.g. "Hide sidebar". No metaphor.',
    },
    kind: { type: 'string', enum: ['css', 'js'] },
    world: {
      type: 'string',
      enum: ['USER_SCRIPT', 'MAIN'],
      description: 'Ignored for css. Default USER_SCRIPT; MAIN only with justification.',
    },
    capabilities: {
      type: 'array',
      items: { type: 'string', enum: ['network', 'storage', 'cookies'] },
      description: 'Empty for almost every transform. Undeclared use is rejected.',
    },
    code: { type: 'string' },
    rationale: {
      type: 'object',
      properties: {
        targets: { type: 'string' },
        approach: { type: 'string' },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
      required: ['targets', 'approach', 'assumptions'],
      additionalProperties: false,
    },
    intent: {
      type: 'string',
      description: 'Single sentence describing the end state. Must stand alone.',
    },
  },
  required: ['name', 'kind', 'world', 'capabilities', 'code', 'rationale', 'intent'],
  additionalProperties: false,
} as const

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['match', 'mismatch', 'uncertain'] },
    explanation: {
      type: 'string',
      description:
        'Names the specific behaviour of concern, for a reader deciding whether to allow this code to run.',
    },
  },
  required: ['verdict', 'explanation'],
  additionalProperties: false,
} as const
