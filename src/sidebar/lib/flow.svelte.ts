/**
 * The authoring flow, as one state machine.
 *
 *   list ──Select an element──▶ picking
 *   picking ──↵────────────────▶ describing
 *   describing ──Generate──────▶ generating
 *   generating ──stream ends───▶ refining
 *   refining ──Keep it─────────▶ saving
 *   saving ──Continue──────────▶ reviewing
 *   reviewing ──Save transform─▶ list
 *
 * Two rules hold across every transition and are the reason this lives in one
 * place rather than spread across components:
 *
 *   Nothing is persisted before `Save transform`. A preview is CSS injected
 *   into the tab and a draft held in memory. Closing the panel discards both,
 *   which is what the refining step promises the user.
 *
 *   The screenshot opt-in is per request. It resets on every entry to
 *   `describing` and is never written to storage. Consent to send an image of
 *   the page once is not consent to keep doing it.
 */

import type { ContentEvent } from '@shared/messages'
import type { RefinementTurn } from '@background/providers/types'
import {
  matchPresetsFor,
  originPermissionFor,
  originPermissionForUrl,
  type MatchPreset,
} from '@shared/match'
import type {
  Anchor,
  GenerationResult,
  HoverTarget,
  PageContext,
  Rect,
  ReviewResult,
  Transform,
  TransformKind,
} from '@shared/types'
import { BackgroundError, send } from './messaging.svelte'

export type Step =
  | 'list'
  | 'picking'
  | 'describing'
  | 'generating'
  | 'refining'
  | 'saving'
  | 'reviewing'

/**
 * The four dead ends the design draws, kept apart because each has a different
 * way out. Collapsing them into one "something went wrong" card would lose the
 * only useful part — what to do next.
 */
export type FlowError =
  | { kind: 'no-provider'; message: string }
  | { kind: 'request-failed'; message: string; detail?: string }
  | { kind: 'rate-limited'; message: string; retryInSeconds: number }
  | { kind: 'credential-expired'; message: string }

interface Picked {
  context: PageContext
  anchor: Anchor
  crop: Rect
  cropClipped: boolean
  target: HoverTarget
  viewportWidth: number
}

/** Named so the generating checklist can render them in order. */
export type ProgressStage = 'context' | 'sent' | 'streaming' | 'analysis' | 'preview'

const STAGE_ORDER: ProgressStage[] = [
  'context',
  'sent',
  'streaming',
  'analysis',
  'preview',
]

export class Flow {
  step = $state<Step>('list')
  error = $state<FlowError | null>(null)

  /** Live target under the pointer, replaced on every move during picking. */
  hover = $state<HoverTarget | null>(null)
  picked = $state<Picked | null>(null)

  instruction = $state('')
  /** Per request. Reset on every entry to `describing`; never persisted. */
  sendScreenshot = $state(false)
  visionSupported = $state(false)

  history = $state<RefinementTurn[]>([])
  followUp = $state('')

  result = $state<GenerationResult | null>(null)
  /**
   * The record that will be saved, built as soon as there is code. It exists
   * this early because the JS preview registers it — previewing through the
   * same path as saving is what makes the preview trustworthy.
   */
  draft = $state<Transform | null>(null)
  /** Exactly what was injected, so removal takes the same string back out. */
  previewedCss = $state<string | null>(null)
  /** Set once the draft has been registered and the page reloaded. */
  jsRan = $state(false)
  /** Static analysis, run locally after every generation. Gates the preview. */
  analysis = $state<ReviewResult | null>(null)
  /** Set when the user declines the grant the transform needs to function. */
  permissionDenied = $state(false)

  intent = $state('')
  matchPattern = $state('')
  review = $state<ReviewResult | null>(null)

  stage = $state<ProgressStage>('context')
  elapsed = $state(0)

  private tabId: number | null = null
  private url = ''
  private timer: ReturnType<typeof setInterval> | null = null

  /**
   * Bumped by every reset. A request in flight cannot be recalled — the model
   * call is already happening — so cancelling has to mean the answer is
   * ignored when it lands, rather than the panel jumping to a result the user
   * walked away from.
   */
  private generation = 0

  constructor(private readonly onSaved: () => void) {}

  get matchPresets(): MatchPreset[] {
    return matchPresetsFor(this.url)
  }

  stageReached(stage: ProgressStage): boolean {
    return STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(this.stage)
  }

  bindTab(tabId: number | undefined, url: string): void {
    this.tabId = tabId ?? null
    this.url = url
  }

  /* ---------------------------------------------------------------- */
  /* Picking                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * `activeTab` is not enough here, and assuming it was is what produced
   * "Missing host permission for the tab".
   *
   * That permission is granted by a click on the *toolbar button*, and it
   * expires. Opening the sidebar from the toolbar grants it once; every
   * subsequent click inside an already-open panel is not a fresh gesture on
   * the action, so `executeScript` has nothing to run under.
   *
   * Asking for the origin outright is also the more honest request: picking is
   * the point where the user decides this extension may read this site, and
   * the transform they are about to make will need the same grant to apply on
   * later visits anyway.
   */
  async startPicking(): Promise<void> {
    if (this.tabId === null) return

    const origin = originPermissionForUrl(this.url)
    if (!origin) return

    // First await — the gesture has to still be live when this runs.
    const granted = await browser.permissions.request({ origins: [origin] })
    if (!granted) {
      this.error = {
        kind: 'request-failed',
        message: `Web Alchemist needs permission to read ${this.hostname()} before it can point at anything on it.`,
      }
      return
    }

    this.error = null
    this.hover = null
    this.picked = null
    this.step = 'picking'
    try {
      await send({ type: 'start-picking', tabId: this.tabId })
    } catch (cause) {
      this.step = 'list'
      this.fail(cause)
    }
  }

  private hostname(): string {
    try {
      return new URL(this.url).hostname
    } catch {
      return 'this site'
    }
  }

  async cancelPicking(): Promise<void> {
    if (this.tabId !== null) {
      await send({ type: 'stop-picking', tabId: this.tabId }).catch(() => {})
    }
    this.step = 'list'
    this.hover = null
  }

  /** Content events arrive here from App's runtime listener. */
  receive(event: ContentEvent): void {
    switch (event.type) {
      case 'element-hovered':
        if (this.step === 'picking') this.hover = event.target
        return

      case 'element-picked':
        if (this.step !== 'picking') return
        this.picked = {
          context: event.context,
          anchor: event.anchor,
          crop: event.crop,
          cropClipped: event.cropClipped,
          target: event.target,
          viewportWidth: event.viewportWidth,
        }
        this.enterDescribing()
        return

      case 'picking-cancelled':
        if (this.step === 'picking') this.step = 'list'
        return

      case 'health-check-result':
        return
    }
  }

  /* ---------------------------------------------------------------- */
  /* Describing                                                        */
  /* ---------------------------------------------------------------- */

  private enterDescribing(): void {
    this.step = 'describing'
    // The reset that makes the opt-in per-request rather than sticky.
    this.sendScreenshot = false
    this.instruction = ''
    this.history = []
    this.followUp = ''
    void this.checkVisionSupport()
  }

  private async checkVisionSupport(): Promise<void> {
    try {
      this.visionSupported = await send<boolean>({ type: 'get-vision-support' })
    } catch {
      // A model whose capabilities cannot be established does not get offered
      // an image. Degrading to no-screenshot is the safe direction.
      this.visionSupported = false
    }
  }

  /* ---------------------------------------------------------------- */
  /* Generating                                                        */
  /* ---------------------------------------------------------------- */

  async generate(): Promise<void> {
    const picked = this.picked
    if (!picked || !this.instruction.trim()) return

    const from = this.step
    const token = ++this.generation
    const current = () => token === this.generation

    this.step = 'generating'
    this.error = null
    this.startClock()

    try {
      const context = { ...picked.context }
      this.stage = 'context'

      if (this.sendScreenshot && this.visionSupported) {
        const shot = await send<{ dataUrl: string; clipped: boolean }>({
          type: 'capture-region',
          rect: picked.crop,
          viewportWidth: picked.viewportWidth,
        })
        context.screenshot = {
          dataUrl: shot.dataUrl,
          rect: picked.crop,
          clipped: shot.clipped,
        }
      }

      this.stage = 'sent'
      const result = await send<GenerationResult>({
        type: 'generate',
        context,
        instruction: this.instruction,
        history: this.history,
      })
      if (!current()) return

      this.stage = 'streaming'
      this.result = result
      this.intent = result.intent
      // Keep the user's scope choice across a regeneration; only seed it once.
      this.matchPattern ||=
        this.matchPresets.find((p) => p.recommended)?.pattern ??
        this.matchPresets[0]?.pattern ??
        ''
      this.draft = this.buildDraft(result, picked.anchor)

      this.stage = 'analysis'
      this.analysis =
        result.kind === 'js'
          ? await send<ReviewResult>({
              type: 'analyse',
              code: result.code,
              declaredCapabilities: result.capabilities,
            })
          : { static: [], undeclaredCapabilities: [], passed: true }
      if (!current()) return

      this.stage = 'preview'
      await this.applyPreview(result)
      if (!current()) return
      this.step = 'refining'
    } catch (cause) {
      if (!current()) return
      // Back where they started, with what they typed intact — a failed
      // request should not cost the user their description.
      this.step = from === 'refining' ? 'refining' : 'describing'
      this.fail(cause)
    } finally {
      this.stopClock()
    }
  }

  private buildDraft(result: GenerationResult, anchor: Anchor): Transform {
    const now = Date.now()
    return {
      id: this.draft?.id ?? crypto.randomUUID(),
      name: result.name,
      enabled: true,
      // Appended, so a new transform wins conflicts against existing ones.
      order: now,
      match: this.matchPattern,
      kind: result.kind,
      origin: 'ai',
      ...(result.kind === 'js' ? { world: result.world } : {}),
      capabilities: result.capabilities,
      intent: this.intent,
      rationale: result.rationale,
      anchor,
      code: result.code,
      createdAt: this.draft?.createdAt ?? now,
      updatedAt: now,
    }
  }

  /**
   * CSS previews at the USER origin, the same way a saved transform applies,
   * so what is on screen during refinement is what will be stored.
   *
   * JS is not previewed automatically. Registering a script and reloading the
   * page is a visible, disruptive act, and it runs code the user has not read
   * yet — so it stays behind a button rather than happening on their behalf.
   */
  private async applyPreview(result: GenerationResult): Promise<void> {
    if (result.kind !== 'css' || this.tabId === null) return
    await this.clearPreview()
    await send({ type: 'preview-css', tabId: this.tabId, css: result.code })
    this.previewedCss = result.code
  }

  /** JS only. Registers the draft and reloads, so it runs the way it will run. */
  async runJs(): Promise<void> {
    const draft = this.draft
    if (!draft || this.tabId === null || !this.analysis?.passed) return
    try {
      await send({ type: 'preview-js', tabId: this.tabId, transform: draft })
      this.jsRan = true
    } catch (cause) {
      this.fail(cause)
    }
  }

  private async clearPreview(): Promise<void> {
    if (this.tabId !== null && this.previewedCss !== null) {
      await send({
        type: 'clear-preview-css',
        tabId: this.tabId,
        css: this.previewedCss,
      }).catch(() => {})
      this.previewedCss = null
    }

    // A registered draft outlives the panel, so it has to come back out
    // whether the user saved, discarded, or simply closed the sidebar.
    if (this.draft && this.jsRan) {
      await send({ type: 'clear-preview-js', id: this.draft.id }).catch(() => {})
      this.jsRan = false
    }
  }

  /* ---------------------------------------------------------------- */
  /* Refining                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * The follow-up becomes the current instruction and the previous exchange
   * moves into history. The provider sends history as prior messages and the
   * instruction as the latest one, so putting the follow-up in history too
   * would send it twice and leave the model answering the older request.
   */
  async regenerate(): Promise<void> {
    const text = this.followUp.trim()
    if (!text || !this.result) return

    this.history = [
      ...this.history,
      { role: 'user', content: this.instruction },
      { role: 'assistant', content: this.result.rationale.approach },
    ]
    this.instruction = text
    this.followUp = ''
    await this.generate()
  }

  /**
   * JS only, and only after a preview has run. The script has already altered
   * the page, so a second attempt would compound the first — the page has to
   * go back to its original state before anything is worth looking at again.
   */
  async reloadAndRetry(): Promise<void> {
    if (this.tabId === null) return
    await this.clearPreview()
    await browser.tabs.reload(this.tabId)
    await this.regenerate()
  }

  async discard(): Promise<void> {
    await this.clearPreview()
    this.reset()
  }

  /* ---------------------------------------------------------------- */
  /* Saving and review                                                 */
  /* ---------------------------------------------------------------- */

  toSaving(): void {
    this.step = 'saving'
  }

  async toReview(): Promise<void> {
    const result = this.result
    if (!result) return

    this.step = 'reviewing'
    this.review = null

    // CSS is not sent for model review: it cannot make a request, read
    // storage, or reach a cookie, so there is no behaviour for a reviewer to
    // disagree with. Static analysis has nothing to say about it either.
    if (result.kind === 'css') {
      this.review = { static: [], undeclaredCapabilities: [], passed: true }
      return
    }

    try {
      this.review = await send<ReviewResult>({
        type: 'review',
        code: result.code,
        // The edited intent, not the model's. The reviewer is asked whether
        // the code matches what the user says they wanted.
        intent: this.intent,
        declaredCapabilities: result.capabilities,
      })
    } catch (cause) {
      this.step = 'saving'
      this.fail(cause)
    }
  }

  /**
   * Drops every declared capability, per "Refuse storage". The code is saved
   * unchanged — the transform's world CSP is built from this list, so removing
   * an entry is what actually stops the call at runtime.
   *
   * Only static analysis is re-run. The model was asked whether the code
   * matches the intent; neither has changed, so asking again would be a second
   * billed call for an answer already given.
   */
  async refuseCapabilities(): Promise<void> {
    const result = this.result
    if (!result) return

    this.result = { ...result, capabilities: [] }
    const analysis = await send<ReviewResult>({
      type: 'analyse',
      code: result.code,
      declaredCapabilities: [],
    })
    this.analysis = analysis
    this.review = { ...analysis, ...(this.review?.model ? { model: this.review.model } : {}) }
  }

  /**
   * What has to be granted before this transform can actually work.
   *
   * The origin grant is what lets `insertCSS` run on later visits. Without it
   * the transform saves, appears in the list, and silently never applies —
   * which is worse than refusing to save it.
   */
  permissionsFor(kind: TransformKind, match: string): browser.permissions.Permissions {
    return {
      origins: [originPermissionFor(match)],
      // 'userScripts' is absent from the OptionalPermission union in
      // @types/firefox-webext-browser, and a union cannot be widened by
      // declaration merging. Same cast as registry.ts, for the same reason.
      ...(kind === 'js' ? { permissions: ['userScripts'] } : {}),
    } as unknown as browser.permissions.Permissions
  }

  async save(): Promise<void> {
    const draft = this.draft
    if (!draft) return

    /*
     * This must be the first thing that happens, before any await.
     * permissions.request() only succeeds while the user gesture that
     * triggered it is still live, and an await spends it.
     *
     * It also has to happen here rather than in the background script, which
     * has no gesture at all — the two background handlers that used to do this
     * could never have worked.
     *
     * Requesting something already granted resolves true without prompting,
     * so there is no need to check first.
     */
    const granted = await browser.permissions.request(
      this.permissionsFor(draft.kind, this.matchPattern),
    )
    if (!granted) {
      this.permissionDenied = true
      return
    }
    this.permissionDenied = false

    // The intent and scope are editable right up to this point, so they are
    // read now rather than at generation time.
    const transform: Transform = {
      ...draft,
      intent: this.intent,
      match: this.matchPattern,
      capabilities: this.result?.capabilities ?? draft.capabilities,
      updatedAt: Date.now(),
    }

    try {
      // The preview and the saved transform would otherwise both be applied,
      // stacking the same rules twice.
      await this.clearPreview()
      await send({ type: 'save-transform', transform })
      this.reset()
      this.onSaved()
    } catch (cause) {
      this.fail(cause)
    }
  }

  /* ---------------------------------------------------------------- */
  /* Errors and lifecycle                                              */
  /* ---------------------------------------------------------------- */

  private fail(cause: unknown): void {
    if (!(cause instanceof BackgroundError)) {
      this.error = { kind: 'request-failed', message: String(cause) }
      return
    }

    switch (cause.kind) {
      case 'no-credential':
        this.error = { kind: 'no-provider', message: cause.message }
        return
      case 'auth':
        this.error = { kind: 'credential-expired', message: cause.message }
        return
      case 'rate-limit':
        this.error = { kind: 'rate-limited', message: cause.message, retryInSeconds: 0 }
        return
      default:
        this.error = { kind: 'request-failed', message: cause.message }
    }
  }

  dismissError(): void {
    this.error = null
  }

  async retry(): Promise<void> {
    this.error = null
    await this.generate()
  }

  private startClock(): void {
    this.stopClock()
    this.elapsed = 0
    this.timer = setInterval(() => {
      this.elapsed += 1
    }, 1000)
  }

  private stopClock(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  reset(): void {
    this.stopClock()
    this.generation += 1
    this.step = 'list'
    this.hover = null
    this.picked = null
    this.instruction = ''
    this.sendScreenshot = false
    this.history = []
    this.followUp = ''
    this.result = null
    this.draft = null
    this.previewedCss = null
    this.jsRan = false
    this.analysis = null
    this.permissionDenied = false
    this.intent = ''
    this.matchPattern = ''
    this.review = null
    this.stage = 'context'
    this.elapsed = 0
  }
}
