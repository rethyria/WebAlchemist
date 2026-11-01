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
 *   The screenshot opt-in is per request. It resets after every attempt and is
 *   never written to storage. Consent to send an image of the page once is not
 *   consent to keep doing it.
 */

import type { AnchoredElement, ContentEvent } from '@shared/messages'
import type { RefinementTurn } from '@background/providers/types'
import type { ScrollOffset } from '@shared/region'
import {
  matchPresetsFor,
  originPermissionFor,
  originPermissionForUrl,
  type MatchPreset,
} from '@shared/match'
import type {
  Anchor,
  ElementContext,
  GenerationResult,
  HoverTarget,
  PageContext,
  Rect,
  ReviewResult,
  Transform,
  TransformKind,
  TreePath,
  TreeRow,
} from '@shared/types'
import { extractPartialString } from '@shared/partial-json'
import { BackgroundError, generateOverPort, send } from './messaging.svelte'

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
/** The steps in which the typed description is still shown after a failure. */
const DESCRIPTION_STEPS: Step[] = ['describing', 'refining', 'reviewing', 'saving']

export type FlowError =
  | { kind: 'no-provider'; message: string }
  | {
      kind: 'request-failed'
      message: string
      detail?: string
      /**
       * Whether the description the user typed is still on screen. Set by
       * show(); the card says "Your description is kept." only when true,
       * because a failed repair, AI edit or delete leaves the list and keeps
       * nothing.
       */
      descriptionKept?: boolean
    }
  /**
   * `retryInSeconds` counts down to zero and then the retry fires on its own.
   *
   * Null means the provider gave no guidance, and the card falls back to the
   * manual button rather than counting down from a number nobody supplied.
   */
  | { kind: 'rate-limited'; message: string; retryInSeconds: number | null }
  | { kind: 'credential-expired'; message: string }

interface Picked {
  context: PageContext
  anchor: Anchor
  crop: Rect
  cropClipped: boolean
  /** True when the user drew the rectangle rather than it coming from bounds. */
  cropDrawn: boolean
  target: HoverTarget
  viewportWidth: number
  devicePixelRatio?: number
  /** The scroll offset `crop` was measured at, for a capture made after scrolling. */
  scrolledTo?: ScrollOffset
}

/** Named so the generating checklist can render them in order. */
export type ProgressStage =
  | 'context'
  | 'sent'
  | 'thinking'
  | 'streaming'
  | 'analysis'
  | 'preview'

const STAGE_ORDER: ProgressStage[] = [
  'context',
  'sent',
  'thinking',
  'streaming',
  'analysis',
  'preview',
]

function samePath(a: TreePath, b: TreePath | null): boolean {
  if (!b) return false
  return a.up === b.up && a.down.length === b.down.length && a.down.every((v, i) => v === b.down[i])
}

export class Flow {
  step = $state<Step>('list')
  error = $state<FlowError | null>(null)

  /** Live target under the pointer, replaced on every move during picking. */
  hover = $state<HoverTarget | null>(null)
  picked = $state<Picked | null>(null)

  /**
   * The tree around the current selection, as the page last described it.
   *
   * Replaced on every pick and every retarget, because what sits under the
   * selection changes when the selection does. The page is what keeps the
   * originally picked element in the list after a move up the chain — see
   * buildTree in the content script.
   */
  tree = $state<TreeRow[]>([])

  /** Where the selection sits, for the guard against re-selecting it. */
  get currentPath(): TreePath | null {
    return this.tree.find((row) => row.relation === 'current')?.path ?? null
  }

  instruction = $state('')
  /**
   * The saved transform currently taken off the page, if any.
   *
   * Editing one with the AI suspends it so previews are the whole truth, and
   * whatever ends the run — saving, discarding, closing — has to put it back.
   */
  suspendedId = $state<string | null>(null)
  /** Distance up the ancestor chain the result covers. See ScopeDepth. */
  scopeDepth = $state(0)
  /** What the page says that depth resolves to. Never estimated here. */
  scopeCount = $state(1)
  scopeContainer = $state<string | null>(null)
  /**
   * Whether an image is going with the next request.
   *
   * Only ever true once one has actually been captured, so the panel cannot
   * claim it is sending something it does not have. Per request, and never
   * persisted.
   */
  sendScreenshot = $state(false)
  /** True while the user is drawing the region on the page. */
  choosingRegion = $state(false)
  /** True when the pick came from a drawn rectangle, which is already a region. */
  get pickedRegionAvailable(): boolean {
    return this.picked?.cropDrawn === true
  }

  /** The captured image, sent with the next request. */
  shot = $state<{ dataUrl: string; rect: Rect; clipped: boolean; moved?: boolean } | null>(null)
  shotClipped = $state(false)
  /** The area was moved to follow the page after it scrolled. The preview says so. */
  shotMoved = $state(false)
  /**
   * The captured image itself, shown in the panel.
   *
   * This is the consent surface. A rectangle's dimensions in text describe
   * what will be sent; the picture is what was actually taken, including
   * anything that happened to be inside it.
   */
  shotPreview = $state<string | null>(null)
  visionSupported = $state(false)
  /** Mirrors the setting; decides whether the all-sites grant is handed back. */
  keepScreenshotPermission = $state(false)

  history = $state<RefinementTurn[]>([])
  followUp = $state('')

  /**
   * Extra elements pointed at while refining, sent alongside the target.
   *
   * Cleared with the run, not with each attempt: having pointed at something
   * once, the user should not have to point at it again for every follow-up.
   */
  references = $state<ElementContext[]>([])
  /** True between asking for a reference pick and one arriving or being cancelled. */
  awaitingReference = $state(false)

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
  /** Characters of reasoning so far. The reasoning itself never crosses. */
  thinkingChars = $state(0)
  /**
   * Kind read out of the partial response, before a full result exists.
   *
   * The generating panel titled itself from `result`, which is null for the
   * whole of generation — so every run announced itself as CSS, including the
   * ones writing JavaScript. `kind` is the second property in the schema, so
   * it lands early and long before the code does.
   */
  streamedKind = $state<TransformKind | null>(null)
  /** Code pulled out of the partial response, shown as it is written. */
  streamed = $state('')

  private cancelGeneration: (() => void) | null = null

  /**
   * Where we are in a reload we asked for ourselves.
   *
   * A JS preview works by registering the draft and reloading, and the reload
   * after that is how a second attempt gets back to a clean page. Those are
   * the two cases where the run has to survive a reload — every other reload
   * means the element being described no longer exists.
   *
   * This was a boolean cleared by the first `loading` it saw, which was wrong
   * in both directions. A single navigation can report `loading` more than
   * once, so the second report found the flag already spent and discarded the
   * run — "Reload and run it" reset the panel it was supposed to preserve. And
   * clearing on `complete` alone would disarm us in the window between asking
   * for the reload and it starting, if a previous load happened to settle
   * there.
   *
   *   none      no reload of ours outstanding; any load is the user's
   *   pending   we have asked, but the navigation has not begun
   *   underway  it has begun; further `loading` reports are the same one
   */
  private ourReload: 'none' | 'pending' | 'underway' = 'none'

  /**
   * The tab this run belongs to, and the tab currently on screen.
   *
   * They are separate because a run is about an element in a particular page.
   * Following the active tab mid-flow pointed every page-side operation at
   * whatever the user happened to be looking at — the preview, the save, and
   * the outline teardown, which is why cancelling from another tab left the
   * highlight behind on the original.
   */
  private tabId: number | null = null
  private url = ''
  ownerHost = $state('')
  activeTabId = $state<number | null>(null)
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
    this.activeTabId = tabId ?? null
    // A run in progress keeps the tab it started on. Rebinding would silently
    // move the subject out from under the user.
    if (this.step !== 'list') return
    // An error card on the list, and the retry or countdown behind it, belong
    // to the tab it came from. Leaving them up let "Try again" or the
    // countdown run a paid request against the tab the user had moved to.
    if ((tabId ?? null) !== this.tabId) this.dismissError()
    this.tabId = tabId ?? null
    this.url = url
    this.ownerHost = this.hostname()
  }

  /** True when a run is in progress and the user is looking somewhere else. */
  get awayFromOwner(): boolean {
    return (
      this.step !== 'list' &&
      this.tabId !== null &&
      this.activeTabId !== null &&
      this.activeTabId !== this.tabId
    )
  }

  /** Brings the run's own tab back to the front. */
  async returnToOwner(): Promise<void> {
    if (this.tabId === null) return
    await browser.tabs.update(this.tabId, { active: true }).catch(() => {})
  }

  /** The run cannot outlive the page it is about. */
  tabClosed(tabId: number): void {
    if (tabId !== this.tabId) return
    // reset() only forgets the run. A preview that already ran is registered in
    // the background, and the saved script it paused stays paused until the
    // preview is cleared, so the clear has to be sent before the state that
    // says it is needed is wiped.
    if (this.draft && this.jsRan) {
      void send({ type: 'clear-preview-js', id: this.draft.id }).catch(() => {})
    }
    this.reset()
  }

  /**
   * The owning page started loading again.
   *
   * Everything the run refers to is gone with it — the element, the anchor
   * that was captured from it, the preview, and the outline. Carrying on would
   * mean describing a page that no longer exists and saving a transform
   * anchored to it.
   */
  pageReloading(tabId: number): void {
    if (tabId !== this.tabId) return
    if (this.step === 'list') {
      // No run to end, but an error card here refers to the page that is
      // being replaced, and its retry would act on the new page.
      this.dismissError()
      return
    }
    if (this.ourReload !== 'none') {
      // Ours. Stay armed: the same navigation may report loading again, and
      // only the load settling tells us it is over.
      this.ourReload = 'underway'
      return
    }
    void this.discard()
  }

  /**
   * The owning page finished loading.
   *
   * Only meaningful as the end of a reload we asked for. Disarming here rather
   * than on the first `loading` is what makes a repeated report harmless.
   */
  pageLoaded(tabId: number): void {
    if (tabId !== this.tabId) return
    if (this.ourReload === 'underway') this.ourReload = 'none'
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
  /**
   * Where a confirmed pick goes.
   *
   * 'describe' is the AI path. 'author' skips the model entirely and opens the
   * editor with an empty body — #27's point being that someone who already
   * knows the CSS they want should not have to describe it to a model and
   * wait, and that this has to work when no provider is configured at all.
   *
   * The pick still happens, and that is not a formality: the anchor is what
   * makes a health check and a repair possible later, so a hand-written
   * transform without one would be a second-class record that silently opts
   * out of both.
   */
  private pickPurpose: 'describe' | 'author' = 'describe'

  /**
   * The description typed before "Change" started a new pick, held until the
   * pick arrives. A pick that arrives while the step is 'picking' goes through
   * enterDescribing, which empties the instruction, so the text has to be kept
   * somewhere that survives the step change. Null when the pick did not start
   * from the describing step.
   */
  private keptInstruction: string | null = null

  /**
   * The element that was selected when "Change" started a new pick, held so
   * that cancelling the pick can go back to it. Null when the pick did not
   * start from the describing step, in which case there is nothing to go back
   * to and cancelling discards the run.
   */
  private rePickFrom: { picked: Picked; tree: TreeRow[] } | null = null

  /**
   * Ends a cancelled or failed re-pick by returning to the describing step
   * with the element, the draft, the match pattern and the typed text as they
   * were. Returns false when the pick did not start from the describing step.
   *
   * Cancelling a re-pick used to discard the whole run, which is right for a
   * first pick and wrong here: in Edit description it threw away an edit the
   * user had only paused to point at a different element.
   */
  private returnFromRePick(): boolean {
    const held = this.rePickFrom
    this.rePickFrom = null
    this.keptInstruction = null
    if (!held) return false
    this.picked = held.picked
    this.tree = held.tree
    this.hover = null
    this.step = 'describing'
    return true
  }

  async startPicking(purpose: 'describe' | 'author' = 'describe'): Promise<void> {
    this.pickPurpose = purpose
    this.keptInstruction = this.step === 'describing' ? this.instruction : null
    if (this.tabId === null) return

    const origin = originPermissionForUrl(this.url)
    if (!origin) return

    /*
     * Held next to keptInstruction, before the first await. It used to be set
     * after the permission request, so a request that threw reached the catch
     * below with nothing held, and the run was discarded instead of returning
     * to the description.
     */
    this.rePickFrom =
      this.step === 'describing' && this.picked
        ? { picked: this.picked, tree: this.tree }
        : null

    /*
     * A new pick from the list starts a new transform. Anything still held
     * from an earlier run would otherwise become part of it, and a draft's id
     * decides which saved transform a save replaces. Synchronous on purpose:
     * the permission request below has to remain the first await, or the
     * gesture is spent. Re-picking from Edit description arrives with the step
     * 'describing' and keeps its draft deliberately.
     */
    if (this.step === 'list') {
      this.draft = null
      this.result = null
      this.matchPattern = ''
      void this.resumeSuspended()
    }

    try {
      // First await — the gesture has to still be live when this runs. See
      // runJs for why the request is inside the try rather than before it.
      const granted = await browser.permissions.request({ origins: [origin] })
      if (!granted) {
        // Nothing was started, so there is nothing to return from.
        this.rePickFrom = null
        this.show({
          kind: 'request-failed',
          message: `Web Alchemist needs permission to read ${this.hostname()} before it can point at anything on it.`,
        })
        return
      }

      this.error = null
      this.hover = null
      this.picked = null
      this.step = 'picking'
      await send({ type: 'start-picking', tabId: this.tabId })
    } catch (cause) {
      /*
       * A failed re-pick from the describing step goes back there, as a
       * cancelled one does. Otherwise only the step was changed, which left
       * the draft, the suspended CSS transform and the outline in place.
       */
      if (!this.returnFromRePick()) await this.discard()
      this.fail(cause, () => this.startPicking(purpose))
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
    // Cancelling "Change" goes back to the description it was started from.
    if (this.returnFromRePick()) return
    /*
     * Any other pick ends the run, through discard rather than a bare step
     * change. A first pick can still hold a draft, its match pattern and a
     * suspended saved transform; going back to the list with only the step
     * changed left all three in place: the suspended transform stayed off the
     * page, and the next new pick inherited the draft's id and saved over the
     * saved transform.
     */
    await this.discard()
  }

  /**
   * Whether a run is waiting for an event from the page: a pick, a retarget
   * on the describing step, a reference pick or a region pick.
   */
  private get awaitingPageEvent(): boolean {
    return (
      this.step === 'picking' ||
      this.step === 'describing' ||
      this.awaitingReference ||
      this.choosingRegion
    )
  }

  /**
   * Content events arrive here from App's runtime listener.
   *
   * `sender` is checked here, and not left to the background's sender check
   * (#68), because a content script's runtime.sendMessage reaches every
   * extension page directly and the background never sees it. Without the
   * check, a script in any other tab could send an element or a region, and
   * the next generation would be built from its content. Events are ignored
   * unless they come from the tab the run is working on and a run is waiting
   * for one.
   */
  receive(event: ContentEvent, sender: { tab?: { id?: number | undefined } | undefined }): void {
    if (sender.tab?.id === undefined || sender.tab.id !== this.tabId) return
    if (!this.awaitingPageEvent) return
    switch (event.type) {
      case 'element-hovered':
        if (this.step === 'picking') this.hover = event.target
        return

      case 'element-picked': {
        // Also arrives while describing, when the ancestor list retargets.
        if (this.step !== 'picking' && this.step !== 'describing') return
        const retargeting = this.step === 'describing'
        this.picked = {
          context: event.context,
          anchor: event.anchor,
          crop: event.crop,
          cropClipped: event.cropClipped,
          cropDrawn: event.cropDrawn,
          target: event.target,
          viewportWidth: event.viewportWidth,
          devicePixelRatio: event.devicePixelRatio,
          scrolledTo: event.scrolledTo,
        }
        this.tree = event.tree
        // Retargeting must not wipe what has already been typed — the user is
        // adjusting the target of a description they are partway through.
        if (retargeting) return
        // The new element replaces the one held for a cancelled re-pick.
        this.rePickFrom = null
        if (this.pickPurpose === 'author') void this.openAuthoring()
        else {
          const kept = this.keptInstruction
          this.keptInstruction = null
          this.enterDescribing()
          // Changing the element is not starting a new description, so what
          // was typed stays. The screenshot, scope and references describe the
          // old element and are reset as before.
          if (kept !== null) this.instruction = kept
        }
        return
      }

      case 'element-referenced':
        if (!this.awaitingReference) return
        this.awaitingReference = false
        // The same element twice tells the model nothing and costs tokens.
        if (this.references.some((held) => held.selector === event.element.selector)) return
        this.references = [...this.references, event.element]
        return

      case 'region-selected': {
        if (!this.choosingRegion) return
        this.choosingRegion = false
        void this.captureRegion(event.rect, event.viewportWidth)
        return
      }


      case 'picking-cancelled':
        this.awaitingReference = false
        // Without this, Esc during a region pick left the screenshot button
        // disabled: both panels disable it while this is true and offer no
        // other way out of region mode.
        this.choosingRegion = false
        // Same as cancelPicking: back to the description for a re-pick, and
        // otherwise the list must not keep the old run.
        if (this.step === 'picking' && !this.returnFromRePick()) void this.discard()
        return

      case 'health-check-result':
        return
    }
  }

  /* ---------------------------------------------------------------- */
  /* Describing                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Hands the pick to the editor page instead of to the model.
   *
   * The draft goes through `storage.session` rather than the URL: an anchor
   * carries a path, landmarks and class names, and a query string is the wrong
   * shape for it — long, escaped, and visible in the address bar. Session
   * storage is memory-only (measured in `test/crypto/session-probe.mjs`) and
   * the draft is discarded once the editor has read it.
   *
   * Nothing is saved here. An empty transform written to storage on the way to
   * the editor would leave a dead row behind if the tab were closed, and the
   * panel would be showing something that does nothing.
   */
  private async openAuthoring(): Promise<void> {
    const picked = this.picked
    if (!picked) return

    const key = crypto.randomUUID()
    const preset = matchPresetsFor(this.url)[0]?.pattern ?? this.url

    await browser.storage.session.set({
      [`wa-draft-${key}`]: {
        anchor: $state.snapshot(picked.anchor),
        match: preset,
        target: $state.snapshot(picked.target),
        url: this.url,
      },
    })

    await browser.tabs.create({
      url: browser.runtime.getURL(`src/editor/index.html?draft=${encodeURIComponent(key)}`),
    })

    this.step = 'list'
    await this.clearLock()
  }

  private enterDescribing(): void {
    this.step = 'describing'
    // The reset that makes the opt-in per-request rather than sticky.
    this.sendScreenshot = false
    this.scopeDepth = 0
    this.scopeCount = 1
    this.scopeContainer = null
    this.instruction = ''
    this.history = []
    this.followUp = ''
    this.references = []
    this.awaitingReference = false
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

  /** Moves the selection along the tree. Absolute, so it can go back down. */
  async retarget(path: TreePath): Promise<void> {
    if (this.tabId === null || samePath(path, this.currentPath)) return
    await send({ type: 'retarget', tabId: this.tabId, path }).catch(() => {})
    // The depth was measured from the old target; reset rather than silently
    // re-pointing it at a different container.
    await this.setScopeDepth(0)
  }

  /**
   * Changes how far up the chain the transform reaches, and redraws for it.
   *
   * Both the count and the container name come back from the page: what a
   * depth resolves to is a fact about the live DOM, and showing either without
   * having checked would be worse than showing neither.
   */
  async setScopeDepth(depth: number): Promise<void> {
    this.scopeDepth = depth
    if (this.tabId === null) return
    try {
      const resolved = await send<{ count: number; container: string | null }>({
        type: 'set-lock-scope',
        tabId: this.tabId,
        depth,
      })
      this.scopeCount = resolved.count
      this.scopeContainer = resolved.container
    } catch {
      this.scopeCount = 1
      this.scopeContainer = null
    }
  }

  /**
   * Applies a saved transform's scope depth through the page, as the slider
   * does, so the count and the container name come from the live DOM.
   *
   * Assigning only the number left the count at 1 and the container null while
   * the depth was not 0: the panel read "Every element like this one" and the
   * request carried a depth with no container to go with it.
   */
  private async restoreScopeDepth(transform: Transform): Promise<void> {
    await this.setScopeDepth(transform.scopeDepth ?? 0)
  }

  /**
   * Asks for one node's children in full.
   *
   * Nothing about the target changes, so this replaces the tree and leaves
   * everything else — the description being typed, the scope, the crop — as
   * it was.
   */
  async expand(path: TreePath): Promise<void> {
    if (this.tabId === null) return
    try {
      const rows = await send<TreeRow[] | null>({ type: 'expand-node', tabId: this.tabId, path })
      // The page answers null when it holds no element to expand. Storing it
      // made the list null, and the row paths computed from it threw.
      if (rows) this.tree = rows
    } catch {
      // The page moved on, or the node is gone. The list stands as it was:
      // a failed expansion is not worth an error card over.
    }
  }

  /** Draws a node on the page while its row is hovered. */
  async previewNode(path: TreePath | null): Promise<void> {
    if (this.tabId === null) return
    await send({
      type: 'highlight-node',
      tabId: this.tabId,
      path,
    }).catch(() => {})
  }

  /* ---------------------------------------------------------------- */
  /* Generating                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * The target as it stands now, not as it stood when it was picked.
   *
   * Refinement used to resend the context captured at confirm time, so once a
   * preview was applied the model was reading computed styles and matched
   * rules that its own last attempt had already changed — and then being asked
   * why the change had not taken. Falling back to the captured copy is
   * deliberate: a page that cannot answer is a reason to use what we have, not
   * to fail the request.
   */
  private async liveContext(picked: Picked): Promise<PageContext> {
    if (this.tabId === null) return picked.context
    try {
      const live = await send<PageContext | null>({
        type: 'recapture',
        tabId: this.tabId,
      })
      return live ?? picked.context
    } catch {
      return picked.context
    }
  }

  /**
   * Rebuilds a transform whose anchor still resolves but whose code stopped
   * working, from the intent it was written for.
   *
   * The three fields are deliberately treated differently. `intent` is the
   * user's, describes the destination rather than the route, and is kept
   * whatever the model returns. `rationale` describes an implementation that
   * no longer exists and is replaced wholesale. `anchor` is recaptured from
   * the element as it is now, since the old signals are what stopped holding.
   *
   * It lands in `refining` rather than saving: this is model-written code
   * replacing code that already runs on the user's page, so it goes through
   * the same reading and the same review as anything else. The existing id,
   * order and creation date ride along in the draft, so approving updates the
   * transform in place instead of leaving a duplicate behind it.
   */
  async repair(transform: Transform, brokenReason: string): Promise<void> {
    if (this.tabId === null) return

    const token = ++this.generation
    const current = () => token === this.generation

    this.step = 'generating'
    this.error = null
    this.startClock()

    try {
      this.stage = 'context'
      const found = await send<AnchoredElement | null>({
        type: 'context-for-anchor',
        tabId: this.tabId,
        anchor: transform.anchor,
      })
      if (!found) {
        throw new Error(
          `Web Alchemist cannot find the element ${transform.name} was written for on this page, so there is nothing to repair against. Pick it again to write a new transform.`,
        )
      }
      if (!current()) return

      this.picked = { ...found, cropDrawn: false }
      // What a regeneration from the refining panel will build on.
      this.matchPattern = transform.match
      this.intent = transform.intent
      this.instruction = transform.intent
      this.history = []
      this.references = []
      this.draft = transform
      await this.restoreScopeDepth(transform)
      if (!current()) return

      this.stage = 'sent'
      this.streamed = ''
      this.thinkingChars = 0
      this.streamedKind = transform.kind
      const result = await send<GenerationResult>({
        type: 'repair',
        transformId: transform.id,
        context: found.context,
        brokenReason,
      })
      if (!current()) return

      this.result = result
      // Not result.intent: the destination was never what broke.
      this.intent = transform.intent
      this.draft = this.buildDraft(result, found.anchor)

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
      /*
       * Back to the list, which is where a repair is started from, and there
       * is no half-finished description to preserve. The draft holds the saved
       * transform's id, so keeping it let the next new transform save over the
       * one that was being repaired. The error is recorded after the discard
       * so that it is still on screen once the list is shown.
       */
      await this.discard()
      this.fail(cause, () => this.repair(transform, brokenReason))
    } finally {
      this.stopClock()
    }
  }

  /**
   * Re-opens a saved transform in the authoring flow, to be changed rather
   * than rebuilt.
   *
   * It lands in `refining` with the stored code already in hand, because that
   * is the panel that asks "what should be different" — the same place a
   * generation arrives at, so the follow-up field, the review and the save
   * behave identically. Nothing is sent to the model here; the request only
   * happens when the user says what to change.
   *
   * The existing intent goes in as the instruction and the stored rationale
   * as the reply to it, so the first follow-up reads as the next turn of the
   * conversation that produced this code rather than the opening line of a
   * new one.
   */
  /**
   * Goes back to where the intent was written.
   *
   * Deliberately not the same as `editWithAi`. That one enters at `refining`,
   * with the existing code in hand and a conversation already in progress, and
   * asks what should be different about it. This one goes back to the beginning
   * of that conversation: the step where the intent was first stated, with the
   * element resolved and the sentence pre-filled, so changing it regenerates
   * from the new description rather than adjusting the old result.
   *
   * One is continuing the conversation; the other is starting it again from a
   * different premise. Collapsing them into a text field would lose the
   * difference — and the difference is the whole request.
   *
   * The draft carries the existing record, so approving updates in place and
   * keeps the id, order, creation date and enabled state, exactly as repair and
   * AI edit already do.
   */
  async editIntent(transform: Transform): Promise<void> {
    if (this.tabId === null) return

    const token = ++this.generation
    const current = () => token === this.generation

    this.step = 'generating'
    this.error = null
    this.stage = 'context'
    this.startClock()

    try {
      const found = await send<AnchoredElement | null>({
        type: 'context-for-anchor',
        tabId: this.tabId,
        anchor: transform.anchor,
      })
      if (!found) {
        throw new Error(
          `Web Alchemist cannot find the element ${transform.name} was written for on this page. Open a page it applies to, or pick the element again.`,
        )
      }
      if (!current()) return

      this.stopClock()
      this.picked = { ...found, cropDrawn: false }
      this.tree = found.tree ?? []
      this.draft = transform
      this.matchPattern = transform.match

      /*
       * enterDescribing clears the instruction, so the pre-fill has to follow
       * it rather than precede it. Everything else it resets — screenshot
       * opt-in, references, follow-up — should be reset, because this is the
       * start of a new description and not a continuation of the old one.
       */
      this.enterDescribing()
      this.instruction = transform.intent
      this.intent = transform.intent
      await this.restoreScopeDepth(transform)
      if (!current()) return

      /*
       * The saved copy comes off the page while this is open, for the reason
       * editWithAi suspends it: both it and any preview are injected the same
       * way, so leaving it on would let a rule the new version removed keep
       * applying underneath.
       */
      if (transform.kind === 'css') {
        await send({ type: 'suspend-transform', tabId: this.tabId, id: transform.id })
        this.suspendedId = transform.id
      }
    } catch (cause) {
      this.stopClock()
      if (!current()) return
      /*
       * Back to the list, as repair and editWithAi do. The step was set to
       * 'generating' at the top, and nothing else moves it on failure, so
       * without this the panel stayed on a stopped Generating checklist and
       * "Try again" ran a plain generate() against whatever was left picked.
       * Through discard because the failure can come after the draft was set
       * and the saved transform suspended.
       */
      await this.discard()
      this.fail(cause, () => this.editIntent(transform))
    }
  }

  async editWithAi(transform: Transform): Promise<void> {
    if (this.tabId === null) return

    const token = ++this.generation
    const current = () => token === this.generation

    this.step = 'generating'
    this.error = null
    this.stage = 'context'
    this.startClock()

    try {
      const found = await send<AnchoredElement | null>({
        type: 'context-for-anchor',
        tabId: this.tabId,
        anchor: transform.anchor,
      })
      if (!found) {
        throw new Error(
          `Web Alchemist cannot find the element ${transform.name} was written for on this page. Open a page it applies to, or pick the element again.`,
        )
      }
      if (!current()) return

      this.picked = { ...found, cropDrawn: false }
      this.matchPattern = transform.match
      this.intent = transform.intent
      this.instruction = transform.intent
      this.references = []
      this.followUp = ''
      this.draft = transform
      await this.restoreScopeDepth(transform)
      if (!current()) return

      this.result = {
        name: transform.name,
        kind: transform.kind,
        world: transform.world ?? 'USER_SCRIPT',
        capabilities: transform.capabilities,
        code: transform.code,
        rationale: transform.rationale,
        intent: transform.intent,
      }
      // Empty on purpose. The intent and the approach are already the current
      // instruction and the current result, and regenerate() moves that pair
      // into history when the first follow-up is sent. Seeding them here as
      // well showed the first exchange twice in the transcript and sent it to
      // the model twice.
      this.history = []

      /*
       * The saved copy comes off the page for the duration. Both it and any
       * preview are injected the same way, so leaving it on would let a rule
       * the new version removed keep applying underneath — a preview that
       * lies in exactly the direction that matters.
       */
      if (transform.kind === 'css') {
        await send({ type: 'suspend-transform', tabId: this.tabId, id: transform.id })
        this.suspendedId = transform.id
      }

      this.analysis =
        transform.kind === 'js'
          ? await send<ReviewResult>({
              type: 'analyse',
              code: transform.code,
              declaredCapabilities: transform.capabilities,
            })
          : { static: [], undeclaredCapabilities: [], passed: true }
      if (!current()) return

      await this.applyPreview(this.result)
      if (!current()) return
      this.step = 'refining'
      void this.checkVisionSupport()
    } catch (cause) {
      if (!current()) return
      // As in repair: the draft carries the saved id, and the transform was
      // suspended above, so both have to be undone before the list is shown.
      await this.discard()
      this.fail(cause, () => this.editWithAi(transform))
    } finally {
      this.stopClock()
    }
  }

  /**
   * What `regenerate` replaced, kept until the attempt it started ends.
   *
   * The follow-up, the instruction and the history are changed before the
   * request is sent, because generate reads them. If the attempt then fails or
   * is cancelled, the panel returns to refining and these values have to go
   * back: otherwise the follow-up box is empty, and the next attempt sends the
   * old result's rationale as the assistant's answer to a request it never
   * answered.
   */
  private refinement: {
    history: RefinementTurn[]
    instruction: string
    followUp: string
    /**
     * The result the attempt replaced, set when the new result is stored. The
     * marker has to outlive that point, until the new preview is on the page,
     * because Cancel during the preview stage must still return to the
     * previous result and not discard the run.
     */
    previous?: {
      result: GenerationResult | null
      draft: Transform | null
      analysis: ReviewResult | null
      intent: string
    }
  } | null = null

  private undoRefinement(): void {
    const held = this.refinement
    this.refinement = null
    if (!held) return
    if (held.previous) {
      this.result = held.previous.result
      this.draft = held.previous.draft
      this.analysis = held.previous.analysis
      this.intent = held.previous.intent
    }
    this.history = held.history
    this.instruction = held.instruction
    this.followUp = held.followUp
  }

  /**
   * `again` is what "Try again" repeats. A refinement passes itself, because
   * repeating plain generate() would send the restored instruction, not the
   * follow-up that failed.
   */
  async generate(again: () => Promise<void> = () => this.generate()): Promise<void> {
    const picked = this.picked
    if (!picked || !this.instruction.trim()) return

    const from = this.step
    const token = ++this.generation
    const current = () => token === this.generation

    this.stopSecondaryPicker()
    this.step = 'generating'
    this.error = null
    this.startClock()

    try {
      this.stage = 'context'
      const context: PageContext = { ...(await this.liveContext(picked)) }
      // Cancel can arrive while the page is being read; without this the
      // cancelled run still opened a port and sent the request.
      if (!current()) return
      if (this.references.length > 0) context.references = [...this.references]

      // Already captured and already on screen in the panel; nothing is taken
      // at request time that the user has not seen.
      if (this.sendScreenshot && this.visionSupported && this.shot) {
        context.screenshot = this.shot
      }

      this.streamed = ''
      this.thinkingChars = 0
      this.streamedKind = null
      const run = generateOverPort(
        {
          context,
          instruction: this.instruction,
          history: this.history,
          scopeDepth: this.scopeDepth,
          scopeContainer: this.scopeContainer,
          tabId: this.tabId ?? undefined,
        },
        {
          onSent: () => {
            if (current()) this.stage = 'sent'
          },
          onThinking: (characters) => {
            if (!current()) return
            this.stage = 'thinking'
            this.thinkingChars = characters
          },
          onChunk: (accumulated) => {
            if (!current()) return
            /*
             * Any text at all means the model has stopped reasoning and
             * started answering, so the stage advances here rather than below.
             * Gating it on the code field kept the panel on the previous stage
             * through the leading part of the JSON — name, kind, capabilities
             * and rationale all arrive before a single line of code does.
             */
            this.stage = 'streaming'

            // Only ever the two complete values: a partial read of "js" is "j",
            // and half a word would title the panel wrongly for a moment.
            const kind = extractPartialString(accumulated, 'kind')
            if (kind === 'css' || kind === 'js') this.streamedKind = kind

            // The response is a JSON object, so what arrives is a partial
            // document. Only the code field is worth showing.
            const code = extractPartialString(accumulated, 'code')
            if (code === null) return
            this.streamed = code
          },
        },
      )
      this.cancelGeneration = run.cancel
      const result = (await run.result) as GenerationResult
      this.cancelGeneration = null
      if (!current()) return

      /*
       * Nothing about the new result is stored until the analysis has come
       * back and the run is still current. Cancel is available during the
       * analysis, and it returns to the previous result; storing the new
       * result first would have left it paired with the old preview.
       */
      this.stage = 'analysis'
      const analysis: ReviewResult =
        result.kind === 'js'
          ? await send<ReviewResult>({
              type: 'analyse',
              code: result.code,
              declaredCapabilities: result.capabilities,
            })
          : { static: [], undeclaredCapabilities: [], passed: true }
      if (!current()) return

      if (this.refinement) {
        this.refinement.previous = {
          result: this.result,
          draft: this.draft,
          analysis: this.analysis,
          intent: this.intent,
        }
      }
      this.result = result
      this.intent = result.intent
      // Keep the user's scope choice across a regeneration; only seed it once.
      this.matchPattern ||=
        this.matchPresets.find((p) => p.recommended)?.pattern ??
        this.matchPresets[0]?.pattern ??
        ''
      this.draft = this.buildDraft(result, picked.anchor)
      this.analysis = analysis

      this.stage = 'preview'
      await this.applyPreview(result)
      if (!current()) {
        // Cancelled, discarded or reset while the preview was being applied.
        // The request to add the new CSS may have been processed after that
        // happened, and nothing else knows about it: discard and reset read
        // previewedCss, which was still empty while the request was in flight.
        await this.removeLatePreview()
        return
      }
      this.refinement = null
      this.step = 'refining'
    } catch (cause) {
      if (!current()) return
      // Back where they started, with what they typed intact — a failed
      // request should not cost the user their description.
      this.step = from === 'refining' ? 'refining' : 'describing'
      // A failure while the new preview was applied has already removed the
      // previous result's CSS, so it is put back along with the result.
      const replacedResult = this.refinement?.previous !== undefined
      this.undoRefinement()
      if (replacedResult) await this.removeLatePreview()
      this.fail(cause, again)
    } finally {
      this.stopClock()
      /*
       * The opt-in is spent by the attempt, not by the run. A failed attempt
       * still sent the image, so it is consumed either way — and the toggle is
       * visible on both the describing and refining panels, so an unticked box
       * is something the user can see rather than a silent downgrade.
       */
      this.clearShot()
    }
  }

  /**
   * Turns screenshots on: one permission prompt, then drag the region.
   *
   * captureVisibleTab accepts `hasPermission("<all_urls>")` or a live activeTab
   * grant, and nothing else — a specific host permission does not count, which
   * is why holding `*://example.com/*` lets us read the whole page but not
   * photograph it.
   *
   * `<all_urls>` does reach the permission set, but only when granted as an
   * *origin* at runtime; declaring it in the manifest does not work, because
   * origin controls keep manifest host permissions out of that set. That
   * distinction is the whole reason this looked like it needed a toolbar
   * click, and it did not.
   *
   * The request is the first await, so the gesture from the toggle is still
   * live when it runs.
   */
  /**
   * Captures the rectangle the user already drew when picking.
   *
   * A drawn crop is a region they chose deliberately, so asking them to draw a
   * second one to say "yes, that area" would be asking twice for the same
   * answer. Requesting a different area stays available separately.
   */
  async includePickedRegion(): Promise<void> {
    const picked = this.picked
    if (!picked || this.tabId === null) return
    if (!(await this.requestCaptureAccess())) return
    this.shotPreview = null
    this.shot = null
    await this.captureRegion(
      picked.crop,
      picked.viewportWidth,
      picked.scrolledTo,
      picked.devicePixelRatio,
    )
  }

  /**
   * The all-sites grant captureVisibleTab needs. First await, so the gesture
   * from the click that reached here is still live.
   */
  private async requestCaptureAccess(): Promise<boolean> {
    const granted = await browser.permissions.request({ origins: ['<all_urls>'] })
    if (!granted) {
      this.sendScreenshot = false
      this.show({
        kind: 'request-failed',
        message:
          'Firefox only lets an extension capture a page with access to all sites. Without it, screenshots cannot be taken; everything else still works.',
      })
    }
    return granted
  }

  async chooseScreenshotRegion(): Promise<void> {
    if (this.tabId === null) return
    try {
      if (!(await this.requestCaptureAccess())) return

      this.choosingRegion = true
      this.shotPreview = null
      this.shot = null
      this.sendScreenshot = false
      await send({ type: 'start-picking', tabId: this.tabId, mode: 'region' })
    } catch (cause) {
      this.choosingRegion = false
      this.fail(cause, () => this.chooseScreenshotRegion())
    }
  }

  private acceptShot(shot: { dataUrl: string; rect: Rect; clipped: boolean; moved?: boolean }): void {
    this.shot = shot
    this.shotPreview = shot.dataUrl
    this.shotClipped = shot.clipped
    this.shotMoved = shot.moved === true
    this.sendScreenshot = true
  }

  /** Takes the shot as soon as the region is drawn. */
  private async captureRegion(
    rect: Rect,
    viewportWidth: number,
    scrolledTo?: ScrollOffset,
    devicePixelRatio?: number,
  ): Promise<void> {
    if (this.tabId === null) return
    try {
      this.acceptShot(
        await send<{ dataUrl: string; rect: Rect; clipped: boolean; moved?: boolean }>({
          type: 'capture-region',
          tabId: this.tabId,
          rect,
          viewportWidth,
          url: this.url,
          ...(devicePixelRatio !== undefined ? { devicePixelRatio } : {}),
          ...(scrolledTo ? { scrolledTo } : {}),
        }),
      )
    } catch (cause) {
      this.fail(cause, () => this.captureRegion(rect, viewportWidth, scrolledTo, devicePixelRatio))
    }
  }

  /**
   * Forgets the image but keeps the grant.
   *
   * Used between attempts within one run. The opt-in is per request, so the
   * image is dropped every time — but re-prompting for an all-sites grant on
   * every refinement would be worse than the thing it protects against, so
   * the permission survives until the run ends.
   */
  private clearShot(): void {
    this.choosingRegion = false
    this.sendScreenshot = false
    this.shotPreview = null
    this.shot = null
  }

  /**
   * Turns screenshots off and hands the all-sites grant back.
   *
   * Holding `<all_urls>` is what lets captureVisibleTab work, and it is far
   * broader than this feature needs: while it is held, every per-site prompt
   * this extension would otherwise show is silently satisfied, because
   * `<all_urls>` subsumes any specific origin. So it is given back as soon as
   * the run that wanted it is over, rather than left standing.
   *
   * permissions.remove needs no user gesture, so this can run from a reset.
   */
  cancelScreenshot(): void {
    this.clearShot()
    // Held deliberately when the user has said so in settings; the point of
    // that setting is not being asked again.
    if (this.keepScreenshotPermission) return
    void browser.permissions.remove({ origins: ['<all_urls>'] }).catch(() => {})
  }

  /**
   * Points at a second element to talk about, without changing the target.
   *
   * No permission request here: the origin was granted before the first pick,
   * and this is the same page in the same run. The step deliberately stays on
   * 'refining' — the picker runs in the page while the panel keeps the
   * conversation, so cancelling in the page returns to exactly where they were.
   */
  async addReference(): Promise<void> {
    if (this.tabId === null || this.step !== 'refining') return
    this.awaitingReference = true
    try {
      await send({ type: 'start-picking', tabId: this.tabId, mode: 'reference' })
    } catch (cause) {
      this.awaitingReference = false
      this.fail(cause, () => this.addReference())
    }
  }

  removeReference(selector: string): void {
    this.references = this.references.filter((held) => held.selector !== selector)
  }

  private buildDraft(result: GenerationResult, anchor: Anchor): Transform {
    const now = Date.now()
    return {
      id: this.draft?.id ?? crypto.randomUUID(),
      name: result.name,
      // A repair of a disabled transform must not switch it back on, and a
      // regeneration must not either.
      enabled: this.draft?.enabled ?? true,
      /*
       * Appended, so a new transform wins conflicts against existing ones —
       * but only when it is new. A repair keeps its place in the order,
       * because that place is what decides which of two overlapping
       * transforms wins, and repairing one is no reason to change that.
       */
      order: this.draft?.order ?? now,
      match: this.matchPattern,
      kind: result.kind,
      origin: 'ai',
      ...(result.kind === 'js' ? { world: result.world } : {}),
      capabilities: result.capabilities,
      intent: this.intent,
      scopeDepth: this.scopeDepth,
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

  /**
   * Takes out CSS that a cancelled attempt applied after it was cancelled, and
   * for a refinement that went back to its previous result, puts that result's
   * CSS on the page again, since applyPreview had already removed it.
   */
  private async removeLatePreview(): Promise<void> {
    if (this.tabId === null) return
    await send({ type: 'clear-preview-css', tabId: this.tabId, css: '' }).catch(() => {})
    this.previewedCss = null
    const back = this.step === 'refining' ? this.result : null
    if (back?.kind === 'css') {
      await send({ type: 'preview-css', tabId: this.tabId, css: back.code }).catch(() => {})
      this.previewedCss = back.code
    }
  }

  /**
   * JS only. Registers the draft and reloads, so it runs the way it will run.
   *
   * The permission has to be asked for here, not left to the save step.
   * Registering a user script needs it, and previewing registers one — so
   * without this the preview failed with "Running JavaScript transforms needs
   * an extra permission. Grant it from the sidebar", which the sidebar then
   * offered no way to do.
   */
  async runJs(): Promise<void> {
    const draft = this.draft
    if (!draft || this.tabId === null || !this.analysis?.passed) return
    // Discard, a tab close and a new generation all bump the generation. The
    // reply to preview-js arrives after the registration already exists, so a
    // run that is no longer current has to take that registration out again.
    const token = this.generation
    const current = () => token === this.generation

    /*
     * The whole body is guarded, not just the send.
     *
     * permissions.request() used to sit outside this try, and every call site
     * invokes these methods as `void flow.runJs()`. A throw from the request
     * therefore became an unhandled rejection that reached nobody: the button
     * did nothing at all, with no error and no state change. Wrapping it does
     * not spend the user gesture — a try block introduces no await, so the
     * request is still issued synchronously from the click.
     */
    try {
      /*
       * The current page, not the transform's match pattern. A preview only
       * has to run on the tab in front of the user, and that origin was
       * granted back when picking started — so passing the pattern here would
       * prompt for a broader grant than the preview needs, at a point where
       * the user has not yet decided to keep anything.
       */
      const granted = await this.requestFor('js', '')
      if (!granted) {
        this.show({
          kind: 'request-failed',
          message:
            'Running a script needs Firefox’s user scripts permission. Nothing was run.',
        })
        return
      }

      // The background reloads the tab to run it; that reload is ours.
      this.ourReload = 'pending'
      await send({ type: 'preview-js', tabId: this.tabId, transform: draft })
      if (!current()) {
        // jsRan was still false when discard or tabClosed looked at it, so
        // neither sent the clear, and the saved script would stay paused.
        this.ourReload = 'none'
        await send({ type: 'clear-preview-js', id: draft.id }).catch(() => {})
        return
      }
      this.jsRan = true
    } catch (cause) {
      // Otherwise a reload that never came leaves us armed, and the next
      // genuine refresh is swallowed instead of resetting the panel.
      this.ourReload = 'none'
      this.fail(cause, () => this.runJs())
    }
  }

  /** Takes the outline off the page. The subject is no longer on screen. */
  private async clearLock(): Promise<void> {
    if (this.tabId === null) return
    await send({ type: 'clear-lock', tabId: this.tabId }).catch(() => {})
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
    // A script that has run has already altered the page, and a second one
    // would run on top of it. The panel hides Regenerate in this state, but
    // Ctrl+Enter in the follow-up field reached this method directly. The
    // caller has to go through reloadAndRetry, which clears jsRan first.
    if (this.jsRan && this.result.kind === 'js') return

    this.refinement = {
      history: this.history,
      instruction: this.instruction,
      followUp: this.followUp,
    }
    this.history = [
      ...this.history,
      { role: 'user', content: this.instruction },
      { role: 'assistant', content: this.result.rationale.approach },
    ]
    this.instruction = text
    this.followUp = ''
    await this.generate(() => this.regenerate())
  }

  /**
   * JS only, and only after a preview has run. The script has already altered
   * the page, so a second attempt would compound the first — the page has to
   * go back to its original state before anything is worth looking at again.
   */
  async reloadAndRetry(): Promise<void> {
    if (this.tabId === null) return
    await this.clearPreview()
    this.ourReload = 'pending'
    await browser.tabs.reload(this.tabId)
    await this.regenerate()
  }

  async discard(): Promise<void> {
    await this.clearPreview()
    await this.resumeSuspended()
    await this.clearLock()
    this.reset()
  }

  /**
   * Puts a suspended transform back on the page.
   *
   * Idempotent, and safe to call when nothing was suspended, because every
   * way out of a run calls it and they are not mutually exclusive — a save
   * runs through the same path a discard does.
   */
  private async resumeSuspended(): Promise<void> {
    const id = this.suspendedId
    this.suspendedId = null
    if (id === null || this.tabId === null) return
    await send({ type: 'suspend-transform', tabId: this.tabId, id: null }).catch(() => {})
  }

  /** Drops the connection as well as ignoring the answer. */
  cancelGenerating(): void {
    this.cancelGeneration?.()
    this.cancelGeneration = null
    /*
     * A refinement has a result, a preview and a conversation worth keeping,
     * so cancelling it goes back to refining with the follow-up text restored
     * for editing. Discarding the run here threw all of that away for a
     * request that was only slow. A first generation has nothing to return to.
     */
    if (this.refinement && this.result) {
      // Ends the attempt: its callbacks and its result are ignored from here.
      this.generation += 1
      this.stopClock()
      this.clearShot()
      this.undoRefinement()
      this.step = 'refining'
      return
    }
    void this.discard()
  }

  /* ---------------------------------------------------------------- */
  /* Saving and review                                                 */
  /* ---------------------------------------------------------------- */

  toSaving(): void {
    this.stopSecondaryPicker()
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
      this.fail(cause, () => this.toReview())
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
   * Asks for what has to be granted before this transform can actually work.
   *
   * The origin grant is what lets `insertCSS` run on later visits. Without it
   * the transform saves, appears in the list, and silently never applies —
   * which is worse than refusing to save it.
   *
   * This is two calls, not one, and that is forced on us. Firefox keeps
   * `userScripts` in OPTIONAL_ONLY_PERMISSIONS, and ext-permissions.js rejects
   * any request carrying it alongside another permission, *an origin*, or a
   * data collection entry:
   *
   *   Cannot request permission userScripts with another permission
   *
   * That check runs before the one that drops already-granted entries, so a
   * combined request throws even when everything in it is already held. Asking
   * for both at once could never have worked.
   *
   * Both calls are issued before the first await. permissions.request() only
   * works while the click that reached here is still live, and awaiting one
   * would spend the gesture the other needs — so they start together and are
   * awaited together. In practice this shows one prompt, not two: a request
   * whose contents are already granted is filtered to nothing and resolves
   * true without a doorhanger.
   */
  requestFor(kind: TransformKind, match: string): Promise<boolean> {
    // A blank pattern would yield `*:///*`, which Firefox rejects outright and
    // which would take the whole request down with it.
    const origin = match
      ? originPermissionFor(match)
      : (originPermissionForUrl(this.url) ?? '')

    const forOrigin = origin
      ? browser.permissions.request({ origins: [origin] })
      : Promise.resolve(true)

    // 'userScripts' is absent from the OptionalPermission union in
    // @types/firefox-webext-browser, and a union cannot be widened by
    // declaration merging. Same cast as registry.ts, for the same reason.
    const forScripts =
      kind === 'js'
        ? browser.permissions.request({
            permissions: ['userScripts'],
          } as unknown as browser.permissions.Permissions)
        : Promise.resolve(true)

    return Promise.all([forOrigin, forScripts]).then(
      ([originGranted, scriptsGranted]) => originGranted && scriptsGranted,
    )
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
    try {
      const granted = await this.requestFor(draft.kind, this.matchPattern)
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

      // The preview and the saved transform would otherwise both be applied,
      // stacking the same rules twice.
      await this.clearPreview()
      // Before the save, so what goes back on the page is the new version
      // rather than the one that was taken off.
      await this.resumeSuspended()
      await this.clearLock()
      await send({
        type: 'save-transform',
        transform,
        // So it applies to the page now, rather than on the next load.
        ...(this.tabId === null ? {} : { tabId: this.tabId }),
      })
      this.reset()
      this.onSaved()
    } catch (cause) {
      this.fail(cause, () => this.save())
    }
  }

  /* ---------------------------------------------------------------- */
  /* Errors and lifecycle                                              */
  /* ---------------------------------------------------------------- */

  /**
   * What "Try again" and the rate-limit countdown repeat.
   *
   * Recorded together with the error. Both used to call generate() whatever
   * had failed, so a rate-limited review or a failed save started a new paid
   * generation, and a failed delete did nothing. `null` means there is nothing
   * to repeat, and the card then offers no retry.
   */
  private retryAction = $state<(() => Promise<void>) | null>(null)

  /** Whether the current error has a request that can be repeated. */
  get canRetry(): boolean {
    return this.retryAction !== null
  }

  /** Records an error that has no request to repeat. */
  show(error: FlowError, retry: (() => Promise<void>) | null = null): void {
    this.error =
      error.kind === 'request-failed' && error.descriptionKept === undefined
        ? { ...error, descriptionKept: DESCRIPTION_STEPS.includes(this.step) }
        : error
    /*
     * The retry belongs to the tab the failure happened on. Without this, a
     * retry or a countdown left on the list survived a tab switch and then ran
     * a paid request on the newly bound tab with the old transform. bindTab
     * and pageReloading also clear the card; this covers a path that reaches
     * retry() some other way.
     */
    const tab = this.tabId
    this.retryAction =
      retry === null ? null : async () => (this.tabId === tab ? retry() : undefined)
  }

  /**
   * Records the failure of a request, and `retry`, the call that repeats it.
   * Public so the list view can report a failed delete the same way.
   */
  fail(cause: unknown, retry: (() => Promise<void>) | null = null): void {
    if (!(cause instanceof BackgroundError)) {
      this.show({ kind: 'request-failed', message: String(cause) }, retry)
      return
    }

    switch (cause.kind) {
      case 'no-credential':
        this.show({ kind: 'no-provider', message: cause.message })
        return
      case 'auth':
        this.show({ kind: 'credential-expired', message: cause.message })
        return
      case 'rate-limit':
        this.show(
          {
            kind: 'rate-limited',
            message: cause.message,
            // A countdown to a retry that has no action would end by silently
            // removing the card, so only a repeatable request gets one.
            retryInSeconds: retry === null ? null : (cause.retryInSeconds ?? null),
          },
          retry,
        )
        if (cause.retryInSeconds !== undefined && retry !== null) this.startRetryCountdown()
        return
      default:
        this.show({ kind: 'request-failed', message: cause.message }, retry)
    }
  }

  dismissError(): void {
    this.cancelRetryCountdown()
    this.error = null
    this.retryAction = null
  }

  async retry(): Promise<void> {
    const action = this.retryAction
    this.cancelRetryCountdown()
    this.error = null
    this.retryAction = null
    await action?.()
  }

  /* ---------------------------------------------------------------- */
  /* The rate-limit countdown                                          */
  /* ---------------------------------------------------------------- */

  private retryTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Waits the time the provider asked for, then retries.
   *
   * #35's point is that the manual button was standing in for this. Waiting is
   * what the provider asked for, and a person watching a panel is worse at
   * timing it than a timer — they either retry too early and are refused again,
   * or wait far longer than necessary.
   *
   * Cancellable, because an automatic request is only acceptable if it can be
   * stopped. Dismissing the card, retrying by hand, or resetting the flow all
   * stop it.
   */
  private startRetryCountdown(): void {
    this.cancelRetryCountdown()
    this.retryTimer = setInterval(() => {
      const error = this.error
      if (!error || error.kind !== 'rate-limited' || error.retryInSeconds === null) {
        this.cancelRetryCountdown()
        return
      }

      const left = error.retryInSeconds - 1
      if (left > 0) {
        this.error = { ...error, retryInSeconds: left }
        return
      }

      this.cancelRetryCountdown()
      void this.retry()
    }, 1000)
  }

  cancelRetryCountdown(): void {
    if (this.retryTimer === null) return
    clearInterval(this.retryTimer)
    this.retryTimer = null
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

  /**
   * Takes the page out of a reference or region pick that the panel started.
   *
   * Those picks run in the page while the panel stays on refining or
   * describing, so acting in the panel (Discard, Keep it, Generate) does not
   * end them by itself, and the page stayed dimmed and swallowed the next
   * click. Nothing is sent when no such pick is active, so a stop-picking
   * message is not sent on every reset. The flags are cleared here as well,
   * because the page's own "picking-cancelled" event no longer reaches a
   * panel that has moved on.
   */
  private stopSecondaryPicker(): void {
    const active = this.awaitingReference || this.choosingRegion
    this.awaitingReference = false
    this.choosingRegion = false
    if (active && this.tabId !== null) {
      void send({ type: 'stop-picking', tabId: this.tabId }).catch(() => {})
    }
  }

  reset(): void {
    this.stopSecondaryPicker()
    this.stopClock()
    // The countdown's own comment says resetting the flow stops it, but this
    // did not. A card and a timer that outlive the run it belonged to end by
    // calling retry() with nothing to repeat.
    this.dismissError()
    this.refinement = null
    this.keptInstruction = null
    this.rePickFrom = null
    this.generation += 1
    // The run is over, so the all-sites grant it may have taken goes back.
    this.cancelScreenshot()
    this.step = 'list'
    this.hover = null
    this.picked = null
    this.tree = []
    this.scopeDepth = 0
    this.scopeCount = 1
    this.scopeContainer = null
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
    this.thinkingChars = 0
    this.streamedKind = null
    this.references = []
    this.awaitingReference = false
    this.streamed = ''
    this.ourReload = 'none'
  }
}
