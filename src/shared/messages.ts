/**
 * Message contract between contexts.
 *
 * Note what is absent: there is no message that returns a Credential. The
 * sidebar can set one, clear one, and ask whether one is configured.
 *
 * That absence keeps the value out of message passing and out of UI state, so
 * it cannot be logged or rendered by mistake. It does not put the value beyond
 * reach — storage.local is shared by every extension context, and a page that
 * went looking would find it. See the header of background/storage.ts for what
 * is and is not guaranteed.
 */

import type {
  Anchor,
  Credential,
  CredentialStatus,
  GenerationResult,
  HoverTarget,
  PageContext,
  Rect,
  ReviewResult,
  Settings,
  Transform,
  TransformRuntimeState,
} from './types'
import type { OverlayPalette } from './accents'
import type { RefinementTurn } from '@background/providers/types'

export type Message =
  /* --- read state --------------------------------------------------- */
  | { type: 'get-settings' }
  | { type: 'get-transforms-for-url'; url: string }
  | { type: 'get-credential-statuses' }
  | { type: 'get-vision-support' }

  /* --- generation --------------------------------------------------- */
  | {
      type: 'generate'
      context: PageContext
      instruction: string
      history: RefinementTurn[]
      scopeDepth?: number
      scopeContainer?: string | null
    }
  | { type: 'repair'; transformId: string; context: PageContext; brokenReason: string }
  | { type: 'review'; code: string; intent: string; declaredCapabilities: Transform['capabilities'] }
  /** Static analysis alone — no model call, so it is free to run before preview. */
  | { type: 'analyse'; code: string; declaredCapabilities: Transform['capabilities'] }

  /* --- persistence -------------------------------------------------- */
  /** `tabId` lets the change take effect now instead of on the next load. */
  | { type: 'save-transform'; transform: Transform; tabId?: number }
  | { type: 'delete-transform'; id: string }
  | { type: 'reorder-transforms'; orderedIds: string[] }
  | { type: 'set-enabled'; id: string; enabled: boolean; tabId?: number }

  /* --- settings and credentials ------------------------------------- */
  | { type: 'save-settings'; settings: Settings }
  | { type: 'set-credential'; providerId: string; credential: Credential }
  | { type: 'clear-credential'; providerId: string }

  /*
   * There are no permission messages. permissions.request() only succeeds
   * while the user gesture that triggered it is still live, and the background
   * script has no gesture — so the sidebar calls the API directly. Routing it
   * through here would fail every time.
   */

  /* --- page-side operations ----------------------------------------- */
  | { type: 'preview-css'; tabId: number; css: string }
  | { type: 'clear-preview-css'; tabId: number; css: string }
  /**
   * Registers an unsaved transform and reloads the tab, so the preview runs in
   * the same world, under the same CSP, through the same harness as the saved
   * one would. A JS preview that ran some other way would not be a preview.
   */
  | { type: 'preview-js'; tabId: number; transform: Transform }
  | { type: 'clear-preview-js'; id: string }
  /** `viewportWidth` converts the CSS-pixel rect to the capture's device pixels. */
  | { type: 'capture-region'; rect: Rect; viewportWidth: number }
  | { type: 'start-picking'; tabId: number }
  | { type: 'stop-picking'; tabId: number }
  | { type: 'retarget'; tabId: number; levelsUp: number }
  | { type: 'highlight-ancestor'; tabId: number; levelsUp: number | null }
  | { type: 'set-lock-scope'; tabId: number; depth: number }
  | { type: 'clear-lock'; tabId: number }
  /** Runs a check regardless of the configured mode. Always user-initiated. */
  | { type: 'check-now'; tabId: number; url: string }

  /* --- verification --------------------------------------------------- */
  /**
   * Registers the CSP probe and navigates to its fixture. Development only —
   * the sidebar affordance is behind an explicit build flag, and the probe is
   * never persisted as a transform.
   */
  | { type: 'run-csp-probe'; tabId: number }
  | { type: 'clear-csp-probe' }

  /* --- portability --------------------------------------------------- */
  | { type: 'export-transforms' }
  | { type: 'import-transforms'; bundle: unknown }

/** Sent from background to content script. */
export type ContentMessage =
  /** The palette travels with the request: the overlay cannot read our CSS. */
  | { type: 'start-picking'; palette: OverlayPalette }
  | { type: 'cancel-picking' }
  /** Walks the selection up the tree from the element being described. */
  | { type: 'retarget'; levelsUp: number }
  /** Draws an ancestor without selecting it. `null` clears. */
  | { type: 'highlight-ancestor'; levelsUp: number | null }
  /** Redraws the persistent outline for the current scope. Answers a count. */
  | { type: 'set-lock-scope'; depth: number }
  | { type: 'clear-lock' }
  | { type: 'apply-transforms'; transforms: Transform[] }
  | { type: 'run-health-check'; transforms: Transform[] }
  | { type: 'url-changed'; url: string }
  /** Answered only by a live instance; the background uses it to avoid reinjecting. */
  | { type: 'ping' }

/**
 * Sent from content script to sidebar, via the background script.
 *
 * These are one-way notifications, not requests: the content script does not
 * wait on the sidebar, and a closed sidebar simply means nobody is listening.
 */
export type ContentEvent =
  | { type: 'element-hovered'; target: HoverTarget }
  | {
      type: 'element-picked'
      context: PageContext
      anchor: Anchor
      /** The region a screenshot would cover, whether drawn or derived. */
      crop: Rect
      /** True when the crop extends past the viewport and would be cut. */
      cropClipped: boolean
      target: HoverTarget
      /** CSS pixels, for scaling the crop against a device-pixel capture. */
      viewportWidth: number
    }
  | { type: 'picking-cancelled' }
  | { type: 'health-check-result'; states: TransformRuntimeState[] }

export interface MessageResponse<T> {
  ok: boolean
  data?: T
  error?: { message: string; kind?: string; retryable?: boolean }
}

/* Response payload types, keyed for convenience at call sites. */
export interface Responses {
  'get-settings': Settings
  'get-transforms-for-url': Transform[]
  'get-credential-statuses': CredentialStatus[]
  'get-vision-support': boolean
  generate: GenerationResult
  repair: GenerationResult
  review: ReviewResult
  analyse: ReviewResult
  'preview-js': boolean
  'clear-preview-js': boolean
  'export-transforms': { schemaVersion: number; exportedAt: number; transforms: Transform[] }
  'import-transforms': { imported: number; needsRegeneration: string[] }
  'capture-region': { dataUrl: string; clipped: boolean }
  'start-picking': boolean
  'stop-picking': boolean
  retarget: boolean
  'highlight-ancestor': boolean
  'set-lock-scope': { count: number; container: string | null }
  'clear-lock': boolean
  'check-now': TransformRuntimeState[]
  'run-csp-probe': boolean
  'clear-csp-probe': boolean
}
