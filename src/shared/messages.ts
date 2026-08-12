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
  ElementContext,
  GenerationResult,
  HoverTarget,
  PageContext,
  Rect,
  ReviewResult,
  Settings,
  Conflict,
  Transform,
  TransformRuntimeState,
  TreePath,
  TreeRow,
} from './types'
import type { Rule } from './css'
import type { OverlayPalette } from './accents'
import type { RefinementTurn } from '@background/providers/types'

/**
 * What a confirmed pick means.
 *
 * 'target' is the element the transform acts on — picking one replaces the
 * previous target, its anchor and its outline. 'reference' only adds context
 * for the next request and changes nothing about what is being transformed.
 * 'region' selects no element at all: the drag is the screenshot boundary and
 * nothing else, so nothing under it is highlighted or resolved.
 */
export type PickMode = 'target' | 'reference' | 'region'

export type Message =
  /* --- read state --------------------------------------------------- */
  | { type: 'get-settings' }
  | { type: 'get-transforms-for-url'; url: string }
  /** One record by id, for the editor page, which has no page URL of its own. */
  | { type: 'get-transform'; id: string }
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
  /** `tabId` lets the change come off the page now rather than on reload. */
  | { type: 'delete-transform'; id: string; tabId?: number }
  /**
   * Re-applies one transform to every tab it matches.
   *
   * The editor is its own tab and is not on any of the pages the transform
   * affects, so it has no `tabId` to hand back the way the panel does. Saving
   * from there would otherwise take effect on the next navigation, which reads
   * as the save not having worked.
   */
  | { type: 'reapply-everywhere'; id: string }
  /** `tabId` re-applies in the new precedence now rather than on reload. */
  | { type: 'reorder-transforms'; orderedIds: string[]; tabId?: number }
  | { type: 'set-enabled'; id: string; enabled: boolean; tabId?: number }

  /* --- settings and credentials ------------------------------------- */
  | { type: 'save-settings'; settings: Settings }
  | { type: 'set-credential'; providerId: string; credential: Credential }
  | { type: 'clear-credential'; providerId: string }
  /*
   * Sign-in runs in the background rather than in the settings page, because
   * the token must not pass through a page — the same rule the API key follows.
   * The settings page asks for the flow and is told whether it worked; the
   * credential itself never leaves this module.
   *
   * The `identity` permission request stays in the page, since that needs a
   * live gesture the background does not have.
   */
  | { type: 'connect-oauth'; providerId: string }
  /*
   * Passphrase mode. The passphrase crosses the message channel exactly once
   * per operation and is never stored — what is kept is the key derived from
   * it, in `storage.session`, which was measured not to reach the disk.
   *
   * It has to cross: the derivation must happen in the background, because the
   * background is the only context that reads credentials, and a key derived in
   * a page would have to be sent instead. Sending the passphrase and deriving
   * once is a smaller surface than sending a key.
   */
  | { type: 'vault-state' }
  | { type: 'enable-vault'; passphrase: string }
  | { type: 'disable-vault'; passphrase: string }
  | { type: 'unlock-vault'; passphrase: string }
  | { type: 'lock-vault' }
  | { type: 'discard-vault' }

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
  /**
   * Captures the region now.
   *
   * tabs.captureVisibleTab needs `hasPermission("<all_urls>")` or a live
   * activeTab grant. A specific host permission does not count, which is why
   * holding `*://example.com/*` — enough to read every byte of the page — does
   * not let us photograph it.
   *
   * `<all_urls>` reaches the permission set when it is *granted as an origin*
   * at runtime. Manifest-declared host permissions do not, because origin
   * controls keep them out, which is what made this look impossible at first.
   * So the panel asks for it once, from the click that turns screenshots on,
   * and after that this simply works.
   */
  | { type: 'capture-region'; tabId: number; rect: Rect; viewportWidth: number }
  /**
   * `mode` decides what a confirmed pick means. 'target' replaces what the
   * transform acts on; 'reference' adds an element the follow-up can talk
   * about and leaves the target, its outline and its anchor alone.
   */
  | { type: 'start-picking'; tabId: number; mode?: PickMode }
  | { type: 'stop-picking'; tabId: number }
  /**
   * Re-reads the element currently being described, from the live page.
   *
   * Refinement used to resend the context captured when the element was first
   * confirmed, so after a preview was applied the model was reasoning about
   * computed styles and matched rules that its own last attempt had already
   * changed.
   */
  | { type: 'recapture'; tabId: number }
  /**
   * Finds the element a stored anchor refers to, and describes it as if it had
   * just been picked. Null when the anchor no longer resolves.
   *
   * This is how a repair starts: the transform broke because the page moved,
   * so the model must be shown the page as it is now rather than the context
   * captured when the transform was written.
   */
  | { type: 'context-for-anchor'; tabId: number; anchor: Anchor }
  /**
   * Which of these transforms are overriding each other on this page.
   *
   * The rules are parsed in the panel and the elements resolved by the page,
   * because only the page knows what a selector reaches. Order matters: the
   * specs are sent in application order.
   */
  | { type: 'find-conflicts'; tabId: number; specs: ConflictSpec[] }
  /**
   * Takes one saved transform off a tab, or puts every one back with `null`.
   *
   * Editing a transform with the AI previews the new version by injecting it,
   * and the saved copy is injected the same way — so leaving it on would let a
   * rule the new version dropped go on applying underneath. The suspension is
   * for the tab and is not remembered: a navigation restores everything, which
   * is the right way for a live-editing state to expire.
   */
  | { type: 'suspend-transform'; tabId: number; id: string | null }
  | { type: 'retarget'; tabId: number; path: TreePath }
  | { type: 'highlight-node'; tabId: number; path: TreePath | null }
  /** Asks for one node's children in full, and answers with the new tree. */
  | { type: 'expand-node'; tabId: number; path: TreePath }
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
  | { type: 'start-picking'; palette: OverlayPalette; mode: PickMode }
  | { type: 'cancel-picking' }
  | { type: 'recapture' }
  | { type: 'context-for-anchor'; anchor: Anchor }
  | { type: 'find-conflicts'; specs: ConflictSpec[] }
  /**
   * Takes the target outline down, and puts it back.
   *
   * The outline is a real element in the page, so a screenshot taken with it
   * up contains our own highlight drawn over the very thing being described.
   */
  | { type: 'set-lock-visible'; visible: boolean }
  /** Moves the selection along the tree, up or down. See TreePath. */
  | { type: 'retarget'; path: TreePath }
  /** Draws a node without selecting it. `null` clears. */
  | { type: 'highlight-node'; path: TreePath | null }
  /** Lifts the breadth cap on one node. Selection and target are untouched. */
  | { type: 'expand-node'; path: TreePath }
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
  /** A reference pick. Carries no anchor or crop: nothing is targeted by it. */
  | { type: 'element-referenced'; element: ElementContext }
  /** A drag in 'region' mode. The rectangle a screenshot would cover. */
  | {
      type: 'region-selected'
      rect: Rect
      clipped: boolean
      /** CSS pixels, for scaling the rect against a device-pixel capture. */
      viewportWidth: number
    }
  | {
      type: 'element-picked'
      context: PageContext
      anchor: Anchor
      /** The region a screenshot would cover, whether drawn or derived. */
      crop: Rect
      /** True when the crop extends past the viewport and would be cut. */
      cropClipped: boolean
      /**
       * True when the user drew the rectangle rather than it being derived
       * from the element's bounds. A drawn one is already a screenshot region
       * the user chose, so it can be offered directly.
       */
      cropDrawn: boolean
      target: HoverTarget
      /**
       * The tree around the selection, as the page sees it right now. Sent on
       * every retarget as well as the first pick: what is under the current
       * element changes as the selection moves, so a copy taken once at
       * confirm time would go stale the moment it was used.
       */
      tree: TreeRow[]
      /** CSS pixels, for scaling the crop against a device-pixel capture. */
      viewportWidth: number
    }
  | { type: 'picking-cancelled' }
  | { type: 'health-check-result'; states: TransformRuntimeState[] }

/**
 * An element the page found for us, described the way a pick describes one.
 *
 * The same shape `element-picked` carries, so a repair can hand the flow the
 * same thing a pick would have and everything downstream — regeneration,
 * recapture, the crop a screenshot would use — works without knowing which of
 * the two it came from.
 */
/** One transform's parsed stylesheet, for conflict detection. */
export interface ConflictSpec {
  id: string
  rules: Rule[]
}

export interface AnchoredElement {
  context: PageContext
  /** Recaptured from the live element, not the stored one that went stale. */
  anchor: Anchor
  crop: Rect
  cropClipped: boolean
  target: HoverTarget
  viewportWidth: number
  /**
   * The subtree around the element, as a pick would have produced.
   *
   * Only the describing step draws this, and only `editIntent` re-enters that
   * step from a stored anchor — a repair goes straight to generating and never
   * shows the list. Optional rather than required so the callers that ignore it
   * are not made to care.
   */
  tree?: TreeRow[]
}

export interface MessageResponse<T> {
  ok: boolean
  data?: T
  error?: { message: string; kind?: string; retryable?: boolean }
}

/* Response payload types, keyed for convenience at call sites. */
export interface Responses {
  'get-settings': Settings
  'get-transforms-for-url': Transform[]
  'get-transform': Transform | null
  'reapply-everywhere': boolean
  'get-credential-statuses': CredentialStatus[]
  /** The status after signing in, so settings can redraw without a re-fetch. */
  'connect-oauth': CredentialStatus
  'vault-state': { sealed: boolean; unlocked: boolean }
  'get-vision-support': boolean
  generate: GenerationResult
  repair: GenerationResult
  /** Null when the anchor no longer resolves on this page. */
  'context-for-anchor': AnchoredElement | null
  'find-conflicts': Conflict[]
  'suspend-transform': boolean
  review: ReviewResult
  analyse: ReviewResult
  'preview-js': boolean
  'clear-preview-js': boolean
  'export-transforms': { schemaVersion: number; exportedAt: number; transforms: Transform[] }
  'import-transforms': { imported: number; needsRegeneration: string[] }
  'capture-region': { dataUrl: string; rect: Rect; clipped: boolean }
  'start-picking': boolean
  'stop-picking': boolean
  retarget: boolean
  'highlight-node': boolean
  'expand-node': TreeRow[]
  'set-lock-scope': { count: number; container: string | null }
  'clear-lock': boolean
  'check-now': TransformRuntimeState[]
  'run-csp-probe': boolean
  'clear-csp-probe': boolean
}
