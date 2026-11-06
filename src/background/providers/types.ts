import {
  modelDisplayName,
  type ConfigField,
  type GenerationResult,
  type TokenUsage,
  type ModelReview,
  type PageContext,
  type Provider,
} from '@shared/types'

/** One conversational turn during refinement. */
export interface RefinementTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Where an instruction sent to the reviewer came from.
 *
 *  - `typed`: the user wrote it in this session.
 *  - `saved-description`: pre-filled from a stored transform's intent (Repair,
 *    Edit with AI, Edit description) and sent unchanged. A model or an imported
 *    bundle wrote it, so it is not evidence of what the user wants.
 *  - `saved-description-edited`: pre-filled the same way, then changed by the
 *    user before sending. The user read and wrote the final text, so it counts
 *    as theirs, and the reviewer is told how it started.
 *  - `imported-description`, `imported-description-edited`: the same two cases
 *    for a transform that came from an imported file, so the text was written
 *    by the author of that file. The reviewer is told that, which is more than
 *    "a model or an earlier session wrote it" (#56).
 */
export type InstructionSource =
  | 'typed'
  | 'saved-description'
  | 'saved-description-edited'
  | 'imported-description'
  | 'imported-description-edited'

export interface ReviewInstruction {
  text: string
  source: InstructionSource
}

/** What a review call is given. Page content is never part of it. */
export interface ReviewArgs {
  code: string
  /** The generator's summary of the intent. The model wrote it. */
  intent: string
  /** True when the user changed the intent after the model returned it. */
  intentEditedByUser?: boolean
  /**
   * True when `intent` is the description from an imported file and has not
   * been replaced by a generation. The author of the file wrote it, not the
   * generating model (#56).
   */
  intentImported?: boolean
  /**
   * Every instruction behind this transform, verbatim, in order, each with its
   * source. The message and the background entry point require it; it is
   * optional here only so that adapter tests that exercise transport do not
   * all need one.
   */
  instructions?: ReviewInstruction[]
  /**
   * The settings the code reads: keys, types, options and defaults. Written by
   * the generating model, so the reviewer is told that they are data. The
   * values the user sets are never part of a review request.
   */
  config?: ConfigField[]
}

export interface GenerateRequest {
  context: PageContext
  /** The user's latest instruction. */
  instruction: string
  /**
   * True when `instruction` is the description of an imported transform, sent
   * as it was imported. The author of the file wrote it, so the prompt says so
   * and does not present it as the user's request (#56).
   */
  instructionImported?: boolean
  /**
   * The description of an imported transform, when the run began from one and
   * `instruction` is a later follow-up. The file's author wrote it, so it is
   * kept out of `history` and sent in a fenced, labelled section on every
   * turn (#56).
   */
  importedDescription?: string
  /**
   * True when `instruction` is the saved description of a stored transform,
   * sent as it was stored. A model or an earlier session wrote it, so the
   * prompt says so and does not present it as the user's request.
   */
  instructionSaved?: boolean
  /**
   * The saved description of a stored transform, when the run began from it
   * unchanged and `instruction` is a later follow-up. A model or an earlier
   * session wrote it, so it is kept out of `history` and sent in a fenced,
   * labelled section on every turn.
   */
  savedDescription?: string
  /** Distance up the ancestor chain the result should cover. See ScopeDepth. */
  scopeDepth?: number
  /** Selector of the container that depth resolves to, for the prompt. */
  scopeContainer?: string | null
  /**
   * Prior turns in this refinement session. Discarded on save — only the
   * consolidated intent is persisted.
   */
  history: RefinementTurn[]
  /**
   * The settings of the elixir being changed (Refine and Brew again), so that
   * the model keeps the key of every setting whose meaning is unchanged. It
   * holds the fields and their defaults only, never the user's values.
   */
  currentConfig?: ConfigField[]
  /**
   * Aborted when nobody can receive the result any more, which is when the
   * panel that asked has closed. Adapters pass it to the request so the call
   * stops being paid for.
   */
  signal?: AbortSignal
  /** Present on repair, absent on first generation. */
  repair?: {
    intent: string
    previousCode: string
    previousRationale: GenerationResult['rationale']
    /** The settings of the saved elixir: fields and defaults, never the user's values. */
    previousConfig?: ConfigField[]
    brokenReason: string
  }
}

/**
 * A side question about the current draft. It carries the fields of a
 * generation request that describe the draft and the page, plus the draft, the
 * earlier questions of the run and the question itself. The answer is shown to
 * the user and is never part of a generation or review request.
 */
export interface AskRequest {
  context: PageContext
  /** The instruction the current draft was generated from. See GenerateRequest. */
  instruction: string
  instructionImported?: boolean
  importedDescription?: string
  instructionSaved?: boolean
  savedDescription?: string
  scopeDepth?: number
  scopeContainer?: string | null
  /** The change history, sent as prior messages as in a generation. */
  history: RefinementTurn[]
  /** The draft the question is about. */
  draft: {
    code: string
    rationale: GenerationResult['rationale']
    /** The settings of the draft: fields and defaults, never the user's values. */
    config?: ConfigField[]
  }
  /** Earlier questions and answers of this run, oldest first. */
  exchanges: { question: string; answer: string }[]
  question: string
  signal?: AbortSignal
}

export interface AskResult {
  answer: string
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
   * Answers a side question about the current draft. The answer is text for
   * the user and changes nothing. `onChunk` receives the raw response as it
   * arrives on adapters that stream; adapters that do not stream never call it.
   */
  ask(request: AskRequest, onChunk?: StreamListener): Promise<AskResult>

  /**
   * Reviews generated JavaScript against what the user typed.
   *
   * Implementations MUST NOT include page content in this call. The reviewer's
   * independence comes entirely from not sharing the generator's context: a
   * page that can steer the generator can steer a reviewer that reads it too.
   */
  review(args: ReviewArgs): Promise<ModelReview>

  /**
   * Whether the configured generation model accepts images, used to decide
   * whether the screenshot option is offered at all.
   */
  supportsVision(): Promise<boolean>
}

/**
 * Called once for each model call that returned a response, before the
 * response is parsed, so a call that was billed and then rejected as a refusal
 * or unreadable is still counted. `usage` is null when the response had no
 * usable usage block. Calls that failed with an HTTP error are not reported,
 * since a rejected request runs no inference.
 */
export type UsageListener = (call: { model: string; usage: TokenUsage | null }) => void

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'no-credential'
      | 'auth'
      | 'rate-limit'
      | 'network'
      | 'refusal'
      /**
       * The provider does not know the model, or no longer serves it. The fix
       * is choosing another model in settings, which is different from every
       * other failure here, so it has its own kind.
       */
      | 'model-unavailable'
      /**
       * The model exists, but this account may not use it: access is not
       * granted, or the account's data policy excludes every provider of it.
       * Choosing another model may help, but the setting to change is in the
       * provider's account, so it is not reported as a retired model.
       */
      | 'model-not-permitted'
      /** The account has no credit or a billing problem. Retrying cannot help. */
      | 'billing'
      | 'bad-response'
      | 'unknown',
    readonly retryable: boolean,
    options?: {
      cause?: unknown
      /**
       * How long the provider asked us to wait, when it said.
       *
       * Absent means it did not say — which is different from zero, and the
       * difference is the point. A zero-second countdown claims to be waiting
       * and is not. See providers/retry-after.ts.
       */
      retryInSeconds?: number
    },
  ) {
    super(message, options)
    this.name = 'ProviderError'
    this.retryInSeconds = options?.retryInSeconds
  }

  readonly retryInSeconds: number | undefined
}

export type ProviderFactory = (
  provider: Provider,
  onUsage?: UsageListener,
) => Promise<AiProvider>

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
    requestedWorld: {
      type: 'string',
      enum: ['USER_SCRIPT', 'MAIN'],
      description:
        'Ignored for css. USER_SCRIPT unless the code needs the page\'s own JavaScript globals. MAIN is only a request: the code runs in the isolated world until the user approves it.',
    },
    worldReason: {
      type: 'string',
      description:
        'Why MAIN is needed, in one or two plain sentences for the user. Empty string when requestedWorld is USER_SCRIPT.',
    },
    capabilities: {
      type: 'array',
      items: { type: 'string', enum: ['network', 'storage', 'cookies'] },
      description: 'Empty for almost every transform. Undeclared use is rejected.',
    },
    code: {
      type: 'string',
      description:
        'The code, formatted for a person to read: one statement or declaration per line, 2-space indentation, blank lines between logical parts, short comments only where they help.',
    },
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
    config: {
      type: 'array',
      description:
        'Settings the user can change later without asking again. Empty for most transforms. At most 20. Every property is required, so use an empty string, an empty array or an empty list where one does not apply.',
      items: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Starts with a lowercase letter, then letters and digits only, at most 32 characters. Unique. The code reads it as CONFIG.<key>.',
          },
          label: { type: 'string', description: 'Plain label for the user, 1 to 60 characters.' },
          help: { type: 'string', description: 'One short line of help, up to 200 characters, or an empty string.' },
          type: { type: 'string', enum: ['text', 'number', 'yes-no', 'choice', 'colour', 'list', 'table'] },
          options: {
            type: 'array',
            description: 'For choice only, 2 to 20 options. Empty for every other type.',
            items: {
              type: 'object',
              properties: { value: { type: 'string' }, label: { type: 'string' } },
              required: ['value', 'label'],
              additionalProperties: false,
            },
          },
          columns: {
            type: 'array',
            description: 'For table only, 1 to 6 columns, each key following the same rule as key. Empty for every other type.',
            items: {
              type: 'object',
              properties: { key: { type: 'string' }, label: { type: 'string' } },
              required: ['key', 'label'],
              additionalProperties: false,
            },
          },
          min: { type: 'string', description: 'For number only: the smallest value as decimal text, or an empty string for no limit.' },
          max: { type: 'string', description: 'For number only: the largest value as decimal text, or an empty string for no limit.' },
          step: { type: 'string', description: 'For number only: the step as decimal text, or an empty string.' },
          unit: {
            type: 'string',
            enum: ['', 'px', 'em', 'rem', '%', 'vh', 'vw', 's', 'ms', 'deg'],
            description: 'For number only, used when CSS reads the value. An empty string for every other case.',
          },
          defaultValue: {
            type: 'string',
            description:
              'The default of a text, colour, choice, number or yes-no setting. A number as decimal text. yes-no as "yes" or "no". A colour as #rrggbb. An empty string for list and table.',
          },
          defaultRows: {
            type: 'array',
            description:
              'The default of a list (one cell per row) or a table (one cell per column, in column order). An empty list for every other type.',
            items: { type: 'array', items: { type: 'string' } },
          },
        },
        required: ['key', 'label', 'help', 'type', 'options', 'columns', 'min', 'max', 'step', 'unit', 'defaultValue', 'defaultRows'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'kind', 'requestedWorld', 'worldReason', 'capabilities', 'code', 'rationale', 'intent', 'config'],
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

export const ASK_SCHEMA = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      description: 'The answer in plain text for the user. It changes nothing.',
    },
  },
  required: ['answer'],
  additionalProperties: false,
} as const

/**
 * Whether a 404 message says the account cannot use the model, as opposed to
 * the model not existing. OpenAI words it "The model `x` does not exist or you
 * do not have access to it", and sends it with the code model_not_found. The
 * sentence does not say which of the two applies, and the reviewed reports of
 * it were for accounts without access, so it is checked before the code and is
 * treated as an account problem. OpenRouter answers "No endpoints found matching your data policy" when the account's
 * privacy settings exclude every provider of the model.
 */
export function isModelNotPermitted(message: string): boolean {
  return (
    /does not exist or you do not have access to it/i.test(message) ||
    /no endpoints found matching your data policy/i.test(message)
  )
}

/** The error for a model the account may not use. Names the model and where to change it. */
export function modelNotPermittedError(
  model: string,
  label: string,
  cause?: unknown,
): ProviderError {
  return new ProviderError(
    `The model ${modelDisplayName(model)} is not available to this account on ${label}. Check the account and data policy settings with the provider, or choose another model in settings.`,
    'model-not-permitted',
    false,
    cause === undefined ? undefined : { cause },
  )
}
