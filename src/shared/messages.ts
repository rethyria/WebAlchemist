/**
 * Message contract between contexts.
 *
 * Note what is absent: there is no message that returns a Credential. The
 * sidebar can set one, clear one, and ask whether one is configured. The value
 * only ever exists in the background script, and only at the point of use.
 */

import type {
  Anchor,
  Credential,
  CredentialStatus,
  GenerationResult,
  PageContext,
  ReviewResult,
  Settings,
  Transform,
  TransformRuntimeState,
} from './types'
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
    }
  | { type: 'repair'; transformId: string; context: PageContext; brokenReason: string }
  | { type: 'review'; code: string; intent: string; declaredCapabilities: Transform['capabilities'] }

  /* --- persistence -------------------------------------------------- */
  | { type: 'save-transform'; transform: Transform }
  | { type: 'delete-transform'; id: string }
  | { type: 'reorder-transforms'; orderedIds: string[] }
  | { type: 'set-enabled'; id: string; enabled: boolean }

  /* --- settings and credentials ------------------------------------- */
  | { type: 'save-settings'; settings: Settings }
  | { type: 'set-credential'; providerId: string; credential: Credential }
  | { type: 'clear-credential'; providerId: string }

  /* --- permissions -------------------------------------------------- */
  | { type: 'request-origin-permission'; origin: string }
  | { type: 'request-userscripts-permission' }

  /* --- page-side operations ----------------------------------------- */
  | { type: 'preview-css'; tabId: number; css: string }
  | { type: 'clear-preview-css'; tabId: number; css: string }
  | { type: 'capture-region'; rect: { x: number; y: number; width: number; height: number } }

  /* --- portability --------------------------------------------------- */
  | { type: 'export-transforms' }
  | { type: 'import-transforms'; bundle: unknown }

/** Sent from background to content script. */
export type ContentMessage =
  | { type: 'start-picking'; mode: 'hover' | 'drag' }
  | { type: 'cancel-picking' }
  | { type: 'apply-transforms'; transforms: Transform[] }
  | { type: 'run-health-check'; transforms: Transform[] }
  | { type: 'url-changed'; url: string }

/** Sent from content script to sidebar, via the background script. */
export type ContentEvent =
  | { type: 'element-picked'; context: PageContext; anchor: Anchor }
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
  'export-transforms': { schemaVersion: number; exportedAt: number; transforms: Transform[] }
  'import-transforms': { imported: number; needsRegeneration: string[] }
  'request-origin-permission': boolean
  'request-userscripts-permission': boolean
  'capture-region': { dataUrl: string; clipped: boolean }
}
