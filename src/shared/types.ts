/**
 * Core data model. Every other module is arranged around these shapes.
 *
 * The three text fields on a Transform are deliberately distinct and must not
 * be collapsed into each other:
 *
 *   intent     what the user wants, in their words, describing the end state.
 *              User-editable. This is the seed for every regeneration, so it
 *              must describe the destination rather than the path taken to it.
 *   rationale  how the current code achieves that. Model-written. Regenerated
 *              on every repair and never preserved across one, because it
 *              describes an implementation that no longer exists.
 *   code       the implementation itself.
 */

export const SCHEMA_VERSION = 1

export type TransformKind = 'css' | 'js'
export type TransformOrigin = 'manual' | 'ai'
export type ExecutionWorld = 'USER_SCRIPT' | 'MAIN'

/**
 * How broadly a transform applies, as a distance up the ancestor chain.
 *
 *   0  only the element that was picked
 *   1  every element like it inside its parent
 *   2  every element like it inside its grandparent
 *   n  …and so on, widening one container at a time
 *
 * This is uBlock Origin's specificity slider, expressed against something we
 * actually compute. A bare specificity number would be a knob over a value we
 * never calculate, since the model writes the selector — but the ancestor
 * chain is ours, already captured, and already shown in the picker. Indexing
 * it gives every position a container the user can point at.
 *
 * Optional on Transform: records written before it existed read as 0, the
 * narrowest and safest reading.
 */
export type ScopeDepth = number

/** Capabilities a transform must declare before its code is allowed to use them. */
export type Capability = 'network' | 'storage' | 'cookies'

/**
 * Whether a declared capability can actually be enforced at runtime, or is
 * only a disclosure.
 *
 * The enforcement mechanism is the user script world's CSP, and CSP has
 * directives for fetching but none for storage or cookies. So `network` is
 * genuinely contained — a transform that did not declare it runs under
 * `connect-src 'none'` and its request fails whatever the code says. Storage
 * and cookies have no equivalent, and the only real control over them is
 * refusing to save the code at all.
 *
 * The review UI says which of the two it is at the point of approval, because
 * "allow" means materially different things in each case.
 */
export const CAPABILITY_ENFORCEMENT: Record<Capability, 'csp' | 'disclosure'> = {
  network: 'csp',
  storage: 'disclosure',
  cookies: 'disclosure',
}

/**
 * Identifying signals for the target element, captured at authoring time.
 * This is the machine-checkable twin of `rationale.assumptions` — the health
 * check tests this, and shows the assumption text when it fails.
 */
export interface Anchor {
  tag: string
  /** Classes filtered to drop build-hash-looking tokens; see anchor.ts. */
  classes: string[]
  id?: string
  role?: string
  /** Leading text content, truncated. Absent when the element has none. */
  text?: string
  /** Structural path from document root, used as the last-resort locator. */
  path: string
  /** Nearby landmark elements that survive redesigns more often than classes. */
  landmarks: string[]
  /** Selector generated at authoring time; tried first on every resolve. */
  selector: string
}

export interface Rationale {
  /** What the code targets, in prose. */
  targets: string
  /** How it achieves the intent. */
  approach: string
  /** What must stay true for this to keep working. Shown when it breaks. */
  assumptions: string[]
}

export type TransformStatus = 'ok' | 'broken' | 'disabled'

export interface Transform {
  id: string
  /** Short human-facing name, model-proposed, user-editable. */
  name: string
  enabled: boolean
  /** Application order within a site. Later entries win conflicts. */
  order: number
  /** Match pattern glob, e.g. "*://reddit.com/r/programming/*". */
  match: string
  kind: TransformKind
  origin: TransformOrigin
  /** Only meaningful when kind === 'js'. Defaults to USER_SCRIPT. */
  world?: ExecutionWorld
  /** Empty by default. Anything used beyond this list is a rejection. */
  capabilities: Capability[]
  intent: string
  /** Absent means 0 — the picked element alone. See ScopeDepth. */
  scopeDepth?: ScopeDepth
  rationale: Rationale
  anchor: Anchor
  code: string
  createdAt: number
  updatedAt: number
}

/** Runtime state, derived per page load. Never persisted. */
export interface TransformRuntimeState {
  id: string
  status: TransformStatus
  /** Populated when status === 'broken'. */
  brokenReason?: string
  /** Which stored assumption stopped holding, when we can attribute it. */
  failedAssumption?: string
}

/* ------------------------------------------------------------------ */
/* Providers and credentials                                           */
/* ------------------------------------------------------------------ */

export type ProviderType = 'anthropic' | 'openai-compatible'

/**
 * Credentials are keyed by provider *id*, not provider type, so two
 * OpenAI-compatible endpoints hold independent keys. Removing a provider
 * clears its credential.
 *
 * Anthropic is API-key only: Anthropic restricted OAuth to Claude Code and
 * Claude.ai in February 2026 and disabled third-party OAuth tokens. OAuth is
 * implemented only for providers that sanction it.
 */
export type Credential =
  | { kind: 'api_key'; value: string }
  | {
      kind: 'oauth'
      accessToken: string
      refreshToken: string
      /** Epoch ms. Refresh is attempted ahead of this. */
      expiresAt: number
      tokenEndpoint: string
      clientId: string
    }

/*
 * Defaults for a newly added provider. They live here rather than in the
 * Anthropic adapter so the settings page can read them without pulling the SDK
 * into its bundle.
 */
export const DEFAULT_GENERATE_MODEL = 'claude-opus-5'
export const DEFAULT_REVIEW_MODEL = 'claude-opus-5'

/**
 * Models offered in the settings dropdown, newest first.
 *
 * A list rather than a live fetch because the endpoint needs a working
 * credential, and the model has to be choosable before one is proven. Any
 * string can be typed in, so an endpoint serving something not listed here is
 * never blocked by this.
 *
 * `vision` is what decides whether the screenshot toggle appears at all.
 */
export interface ModelOption {
  id: string
  label: string
  /** Input / output USD per million tokens, for the settings hint. */
  price: string
  vision: boolean
}

export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-opus-5', label: 'Opus 5', price: '$5 / $25', vision: true },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', price: '$3 / $15', vision: true },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', price: '$5 / $25', vision: true },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', price: '$3 / $15', vision: true },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', price: '$1 / $5', vision: true },
]

export interface Provider {
  id: string
  label: string
  type: ProviderType
  /** Required for openai-compatible; ignored for anthropic. */
  baseUrl?: string
  /** Model used to generate transforms. */
  generateModel: string
  /** Model used for the adversarial review pass. */
  reviewModel: string
  /**
   * Whether the generate model accepts images. For Anthropic this is resolved
   * live from GET /v1/models/{id} (capabilities.image_input.supported); for
   * OpenAI-compatible endpoints there is no equivalent, so it is set by hand.
   */
  supportsVision: boolean
}

/** What the sidebar is allowed to know about a credential. Never the value. */
export interface CredentialStatus {
  providerId: string
  configured: boolean
  kind?: Credential['kind']
  /** Epoch ms, oauth only. Lets the UI warn before a hard expiry. */
  expiresAt?: number
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type HealthCheckMode = 'every-load' | 'once-per-session' | 'manual'

/**
 * Accent is user-selectable from a swatch row in settings. Applied as
 * `data-accent` on the document element; the palette lives in tokens.css.
 *
 * Order is the swatch row as drawn — a spectrum, not an alphabetical list —
 * so this array is also the render order.
 *
 * Red, orange and amber sit next to the status hues, which is allowed but
 * makes a broken transform harder to spot. The settings UI says so at the
 * point of choosing rather than preventing it.
 */
export const ACCENTS = [
  'red',
  'orange',
  'amber',
  'green',
  'blue',
  'indigo',
  'violet',
  'mono',
] as const
export type Accent = (typeof ACCENTS)[number]

export interface Settings {
  schemaVersion: number
  providers: Provider[]
  activeProviderId: string | null
  healthCheckMode: HealthCheckMode
  accent: Accent
  /**
   * Keeps the all-sites grant that screenshots need, instead of handing it
   * back when the run ends.
   *
   * Off by default. While the grant is held, every per-site prompt this
   * extension would otherwise show is satisfied silently, because `<all_urls>`
   * subsumes any specific origin — so leaving it on trades the per-site
   * consent model for not being asked again.
   */
  keepScreenshotPermission: boolean
  /** Disables execution of every AI-authored JS transform, everywhere. */
  aiJsKillSwitch: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  providers: [],
  activeProviderId: null,
  healthCheckMode: 'every-load',
  accent: 'blue',
  keepScreenshotPermission: false,
  aiJsKillSwitch: false,
}

/* ------------------------------------------------------------------ */
/* Safety pipeline                                                     */
/* ------------------------------------------------------------------ */

export type FindingSeverity = 'block' | 'warn'

export interface StaticFinding {
  line: number
  column: number
  /** The API that was matched, e.g. "navigator.sendBeacon". */
  api: string
  capability: Capability | null
  severity: FindingSeverity
  /** Plain-language explanation for someone who cannot read the code. */
  explanation: string
}

export type ReviewVerdict = 'match' | 'mismatch' | 'uncertain'

export interface ModelReview {
  verdict: ReviewVerdict
  explanation: string
}

export interface ReviewResult {
  static: StaticFinding[]
  /** APIs used whose capability was not declared on the transform. */
  undeclaredCapabilities: Capability[]
  /** Absent for CSS transforms, which are not sent for model review. */
  model?: ModelReview
  /** False when anything blocking is outstanding. */
  passed: boolean
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/** Viewport coordinates. Also the screenshot crop when the user drew one. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * What the sidebar shows while the pointer moves over the page. Sent on every
 * change of target, so it stays small — the expensive context extraction only
 * happens once, on confirm.
 */
export interface HoverTarget {
  /** Ancestor selectors, root first, the target itself last. */
  breadcrumb: string[]
  width: number
  height: number
  role?: string
  /** Present once the user has drawn a rectangle. */
  crop?: Rect
  /** True while the mouse button is down and the rectangle is being drawn. */
  drawing: boolean
}

/**
 * A node located relative to the element the pick confirmed.
 *
 * Absolute rather than relative to wherever the selection currently sits.
 * Every move is measured from the same fixed origin, so walking up the chain
 * and back down lands where it started — a relative step would be cumulative
 * and one-way, because after moving up the descendants are no longer on the
 * path.
 */
export interface TreePath {
  /** Levels up from the picked element. */
  up: number
  /** Then child indices down from there, outermost first. */
  down: number[]
}

/**
 * One row of the tree shown while describing, flattened for rendering.
 *
 * The page builds this, not the panel: which children exist, and which of them
 * are worth showing, are facts about the live DOM.
 */
export interface TreeRow {
  label: string
  /** Nesting level, 0 at the outermost row. Drawn as indentation. */
  indent: number
  /**
   * Where the row sits relative to the selection. `sibling` covers a whole
   * neighbouring branch, not only the neighbour itself: everything in it is
   * off the selection's line, which is what the panel dims it for.
   */
  relation: 'ancestor' | 'current' | 'sibling' | 'descendant' | 'more'
  /**
   * Levels above the current element. Ancestors and the current row only —
   * the scope slider reaches upwards, so it is the one measurement it needs.
   */
  above?: number
  /** Absent on 'more' rows, which are a count rather than an element. */
  path?: TreePath
  /** The element the pick confirmed, marked once the selection has left it. */
  origin?: boolean
}

/** One element, described well enough for the model to write against it. */
export interface ElementContext {
  selector: string
  tag: string
  /** Bounded, depth- and node-capped, with text truncated. */
  outerHTMLExcerpt: string
  computedStyles: Record<string, string>
  /** Author rules matching the element, with specificity, most specific last. */
  matchedRules: { selector: string; specificity: string; declarations: string }[]
}

/** Context extracted from the page and sent to the model. */
export interface PageContext {
  url: string
  target: ElementContext
  /**
   * Further elements the user pointed at while refining.
   *
   * Empty on a first generation. These are context, not targets: the model is
   * told it may read them and refer to them, but that the transform still acts
   * on `target` unless the instruction says otherwise. Without this the only
   * way to mention a second element was to describe it in prose and hope the
   * selector guessed from that description was the right one.
   */
  references?: ElementContext[]
  ancestors: { selector: string; tag: string; computedStyles: Record<string, string> }[]
  /** CSS custom properties in scope at the target. */
  customProperties: Record<string, string>
  /** Only present when the user opted in for this specific request. */
  screenshot?: { dataUrl: string; rect: Rect; clipped: boolean }
}

/** What the model returns for a generation or repair request. */
export interface GenerationResult {
  name: string
  kind: TransformKind
  world: ExecutionWorld
  capabilities: Capability[]
  code: string
  rationale: Rationale
  /** Model's consolidation of the conversation into a single end-state intent. */
  intent: string
}
