/**
 * The message handlers that decide whether code or CSS may be saved, previewed
 * or applied, with the browser APIs they use passed in.
 *
 * These steps used to sit inside index.ts, which registers listeners and
 * touches `browser` when it loads, so no test could import it. The result was
 * that removing a check from the save path, the CSS preview path or the CSS
 * injection path failed no test (found in the review of 4dab39a to a60086e).
 * Here each handler takes the storage, tab and injection functions it needs as
 * a `deps` argument, so a test can supply stubs and assert that an unapproved
 * save is refused, that a failing preview is never injected, and that stored
 * CSS which no longer passes is left out. The checks themselves are the real
 * ones (static analysis, the CSS gate, the approval records); only the browser
 * is replaced.
 */

import { appliesInContainer } from '@shared/container'
import type { Message } from '@shared/messages'
import type { ReviewInstruction } from './providers/types'
import type { ReviewResult, Settings, Transform } from '@shared/types'
import { isApproved, mayBeSaved, recordApproval, spendApproval, type ApprovalVerdict } from './approvals'
import { blockedStates, problemWithStoredCode, runStaticAnalysis } from './code-gate'
import { assertPreviewable, checkCssForPage, checkCssTransform } from './css-gate'

type Of<T extends Message['type']> = Extract<Message, { type: T }>

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export interface SaveDeps {
  getAllTransforms: () => Promise<Transform[]>
  getSettings: () => Promise<Settings>
  /** The URL of a tab, or undefined when there is none or it has closed. */
  tabUrl: (tabId: number | undefined) => Promise<string | undefined>
  /** Throws a message when a record is not usable, before any other check reads its fields. */
  assertValidTransform: (value: unknown) => void
  /** Stores the transform and returns the record as stored, which is what is registered and applied. */
  saveTransform: (transform: Transform, options?: { clearContainer?: boolean }) => Promise<Transform>
  registerTransform: (transform: Transform) => Promise<unknown>
  /** Refreshes the badge for a transform that was saved. */
  transformEdited: (id: string) => Promise<void>
  /**
   * Work that follows a save: repainting the other tabs that match the old or
   * the new pattern, and checking the site again. `before` is the record as it
   * was stored before the save, or undefined for a new transform.
   */
  afterSave?: (saved: Transform, before: Transform | undefined) => Promise<void>
  /** Brings a tab up to date after a change. */
  reapply: (tabId: number | undefined) => Promise<void>
}

/**
 * Saves a transform after the checks for its kind.
 *
 * Re-runs the gate here rather than trusting that the caller did, exactly as
 * preview-js does. This stopped being a formality when transform code became
 * hand-editable: the sidebar is no longer only ever sending back something it
 * just analysed, so the last point before code is persisted and registered has
 * to check it for itself.
 */
export async function handleSaveTransform(message: Of<'save-transform'>, deps: SaveDeps): Promise<true> {
  // First, so a record with a missing field is refused with a message before
  // analysis reads fields it may not have. saveTransform checks again; this is
  // only the earlier point.
  deps.assertValidTransform(message.transform)
  const before = (await deps.getAllTransforms()).find((t) => t.id === message.transform.id)

  if (message.transform.kind === 'js') {
    const analysis = runStaticAnalysis(message.transform.code, message.transform.capabilities)
    if (!analysis.passed) {
      throw new Error('Static analysis rejected this code, so it was not saved.')
    }

    /*
     * The code must be the code that was approved. Static analysis alone
     * cannot say that: it passes for any code that is not caught, and the
     * review and the panel's approval are what the user relied on. A transform
     * whose code is unchanged from what is stored is let through, so a rename
     * or a toggle does not need a new review, and capabilities that were only
     * reduced are covered by the approval for the larger set (see approvals.ts).
     */
    const stored = (await deps.getAllTransforms()).find((t) => t.id === message.transform.id)
    if (!(await mayBeSaved(stored, message.transform, message.approvalToken))) {
      throw new Error(
        'This code was not approved in this browser session, so it was not saved. Review it again and save.',
      )
    }
  }

  if (message.transform.kind === 'css') {
    /*
     * The approval panel's CSS check is advisory, so the editor, a rename and
     * any later caller all arrive here, and this is the last point before the
     * CSS is stored and injected on every visit.
     *
     * A transform whose code and approvals are unchanged is let through, so
     * renaming or reordering a stored transform is not refused because of a
     * rule that was already there. It still does not apply: the same check runs
     * again every time stored CSS is injected.
     */
    const stored = (await deps.getAllTransforms()).find((t) => t.id === message.transform.id)
    const unchanged =
      stored !== undefined &&
      stored.code === message.transform.code &&
      // The CSS check depends on the site, through the per-site setting and the
      // origin that same-origin addresses are judged against, so moving the CSS
      // to another match pattern is not a rename.
      stored.match === message.transform.match &&
      JSON.stringify(stored.approvedCssUrls ?? []) ===
        JSON.stringify(message.transform.approvedCssUrls ?? [])
    if (!unchanged) {
      const check = checkCssTransform(
        message.transform,
        await deps.getSettings(),
        await deps.tabUrl(message.tabId),
      )
      if (!check.passed) {
        throw new Error(
          check.static[0]?.explanation ??
            'This CSS loads external addresses that were not approved, so it was not saved.',
        )
      }
    }
  }

  /*
   * The record of the user's approval of MAIN is decided here and not taken
   * from the message. It is set when this save carried an approval token for
   * code in MAIN, which the editor and the panel obtain only after showing the
   * risks, and it is kept when the stored record already had it. The notice
   * that the migration reset the world is cleared by any save.
   */
  const { mainApprovedByUser: _sent, worldResetFromModel: _notice, ...incoming } = message.transform
  let outgoing: Transform = incoming
  if (incoming.kind === 'js' && incoming.world === 'MAIN') {
    const stored = before
    const grantedNow = await isApproved(
      message.approvalToken,
      incoming.code,
      incoming.world,
      incoming.capabilities,
      { transformId: incoming.id, match: incoming.match },
    )
    const keptFromStored = stored?.world === 'MAIN' && stored.mainApprovedByUser === true
    if (grantedNow || keptFromStored) outgoing = { ...incoming, mainApprovedByUser: true }
  }

  // Register what was stored, not what was sent: a save keeps the stored
  // `enabled`, and the copy that arrived may hold an older value.
  const saved = await deps.saveTransform(outgoing, {
    clearContainer: message.clearContainer === true,
  })
  if (saved.kind === 'js') {
    await deps.registerTransform(saved)
  }
  // Spent only now that the save succeeded, so a failed save can be retried
  // with the same token, and a successful one cannot be repeated with it.
  if (message.transform.kind === 'js' && message.approvalToken) {
    await spendApproval(message.approvalToken)
  }
  await deps.transformEdited(saved.id)
  await deps.afterSave?.(saved, before)
  // Apply it now rather than on the next navigation. The preview was just taken
  // down, so without this the page visibly reverts on save.
  await deps.reapply(message.tabId)
  return true
}

/* ------------------------------------------------------------------ */
/* Previewing CSS                                                      */
/* ------------------------------------------------------------------ */

export interface PreviewCssDeps {
  getSettings: () => Promise<Settings>
  tabUrl: (tabId: number | undefined) => Promise<string | undefined>
  /** Injects the CSS into the tab as that tab's preview, replacing an earlier one. */
  setPreviewCss: (tabId: number, css: string) => Promise<void>
}

/**
 * Applies CSS to a page as a preview, only when it passes the check. It is
 * checked before anything is injected and enforced here rather than in the
 * sidebar: the sidebar's own check is only a courtesy to the user.
 */
export async function handlePreviewCss(message: Of<'preview-css'>, deps: PreviewCssDeps): Promise<true> {
  assertPreviewable(message.css, await deps.getSettings(), await deps.tabUrl(message.tabId), message.approvedUrls)
  await deps.setPreviewCss(message.tabId, message.css)
  return true
}

/* ------------------------------------------------------------------ */
/* Review and approval                                                 */
/* ------------------------------------------------------------------ */

export interface ReviewDeps {
  /** Static analysis, then the model review when analysis passes. */
  runReview: (
    code: string,
    intent: string,
    intentEditedByUser: boolean,
    instructions: ReviewInstruction[],
    declared: Transform['capabilities'],
    /** The transform the call is for, so its cost is added to that transform. */
    transformId?: string,
    /** True when `intent` came from an imported file. */
    intentImported?: boolean,
  ) => Promise<ReviewResult>
  recordApproval?: typeof recordApproval
}

/**
 * Runs the review and records the approval, in the background where the review
 * happened and not by the sidebar after the fact. Any verdict counts: a
 * disagreement is shown to the user, who may still choose to save, so what is
 * recorded is that this code was reviewed and shown. Nothing is recorded when
 * static analysis rejected the code and no review ran, and nothing is recorded
 * for a message from a content script, whose sender is a web page.
 */
export async function handleReview(
  message: Of<'review'>,
  trusted: boolean,
  deps: ReviewDeps,
): Promise<ReviewResult> {
  const record = deps.recordApproval ?? recordApproval
  const result = await deps.runReview(
    message.code,
    message.intent,
    message.intentEditedByUser ?? false,
    message.instructions,
    message.declaredCapabilities,
    message.transformId,
    message.intentImported ?? false,
  )
  if (result.model && trusted) {
    const verdict: ApprovalVerdict = result.model.verdict
    const approvalToken = await record(message.code, message.world, message.declaredCapabilities, verdict, {
      transformId: message.transformId,
      match: message.match,
    })
    return { ...result, approvalToken }
  }
  return result
}

/** Records that the user wrote this code and is saving it, when it passes static analysis. */
export async function handleApproveCode(
  message: Of<'approve-code'>,
  trusted: boolean,
  deps: Pick<ReviewDeps, 'recordApproval'> = {},
): Promise<{ approvalToken: string }> {
  if (!trusted) throw new Error('Only the extension can approve code.')
  const analysis = runStaticAnalysis(message.code, message.declaredCapabilities)
  if (!analysis.passed) {
    throw new Error('Static analysis rejected this code, so it was not approved.')
  }
  const approvalToken = await (deps.recordApproval ?? recordApproval)(
    message.code,
    message.world,
    message.declaredCapabilities,
    'user-written',
    { transformId: message.transformId, match: message.match },
  )
  return { approvalToken }
}

/**
 * True when a message came from one of this extension's own pages (the
 * sidebar, the editor, the options page) and not from a content script, whose
 * sender URL is the web page it runs in. `extensionUrl` is the extension's base
 * URL, as `browser.runtime.getURL('')` returns it.
 */
export function fromExtensionPage(sender: { url?: string | undefined }, extensionUrl: string): boolean {
  return sender.url?.startsWith(extensionUrl) === true
}

/* ------------------------------------------------------------------ */
/* Blocked transforms                                                  */
/* ------------------------------------------------------------------ */

/**
 * The number of enabled transforms, on any site, that the checks applied now
 * keep from running. A transform that the re-check blocks is otherwise shown
 * only as a broken row on a page it matches, so a user who does not visit that
 * page never learns of it. A disabled transform is not counted: it is not
 * running by the user's choice, and the check runs again when it is enabled.
 */
export async function handleBlockedCount(deps: {
  getAllTransforms: () => Promise<Transform[]>
  getSettings: () => Promise<Settings>
}): Promise<number> {
  const enabled = (await deps.getAllTransforms()).filter((t) => t.enabled)
  return blockedStates(enabled, await deps.getSettings()).length
}

/* ------------------------------------------------------------------ */
/* Saving settings                                                     */
/* ------------------------------------------------------------------ */

export interface SettingsDeps {
  /**
   * Stores the settings and returns the ones that were stored before. The read
   * is made inside the settings queue, not before it: a read made first would
   * delay this save behind a change that was sent after it (#85).
   */
  saveSettings: (settings: Settings) => Promise<Settings>
  /** Re-registers every script, which applies the kill switch. `before` is what was stored before the save. */
  reregisterAll: (before: Settings) => Promise<unknown>
  /** Recomputes the CSS and scripts of every open tab. */
  reapplyAllTabs: () => Promise<void>
}

/** The per-site CSS settings as one string, so two tables compare equal whatever their key order. */
function policyFingerprint(policy: Settings['cssUrlPolicy'] | undefined): string {
  return JSON.stringify(Object.entries(policy ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/**
 * Saves settings. When the per-site CSS settings changed, every open tab is
 * reapplied: a tab keeps the CSS that was injected under the old settings
 * until something reapplies it, so tightening a site's setting left the CSS
 * that the new setting refuses on other open tabs of that site (found in the
 * review of 4dab39a). Other settings do not change what CSS is injected.
 */
export async function handleSaveSettings(message: Of<'save-settings'>, deps: SettingsDeps): Promise<true> {
  const previous = await deps.saveSettings(message.settings)
  // The kill switch changes which scripts may run.
  await deps.reregisterAll(previous)
  if (policyFingerprint(message.settings.cssUrlPolicy) !== policyFingerprint(previous.cssUrlPolicy)) {
    await deps.reapplyAllTabs()
  }
  return true
}

/* ------------------------------------------------------------------ */
/* Applying stored CSS                                                 */
/* ------------------------------------------------------------------ */

export interface CssApplyDeps {
  getSettings: () => Promise<Settings>
  insertCss: (tabId: number, css: string) => Promise<void>
  removeCss: (tabId: number, css: string) => Promise<void>
  /**
   * The cookie store id (container) of a tab, or undefined when it cannot be
   * read. Used for the per-transform container restriction (#127).
   */
  tabCookieStore: (tabId: number) => Promise<string | undefined>
  /**
   * What is currently injected in each tab. Kept because removeCSS matches on
   * content: taking a stylesheet back out requires the exact string that went
   * in. Without it, saving or toggling could only add, never replace. It is
   * kept in storage.session in the extension (see css-state.ts), so a
   * suspension of the background page does not lose it.
   */
  applied: {
    read: (tabId: number) => Promise<string | undefined>
    write: (tabId: number, css: string) => Promise<void>
    forget: (tabId: number) => Promise<void>
  }
}

/**
 * Injects the CSS of the enabled CSS transforms into a tab, replacing what was
 * injected before.
 *
 * Stored CSS is checked again here, against the page it is about to be
 * injected into. It was checked when saved, but the rules and the site's
 * setting can change afterwards, and CSS saved before the check existed was
 * never checked at all. One that fails is left out, and the rest still apply.
 * The panel lists it as not running (see blockedStates).
 */
export async function applyCssTransforms(
  deps: CssApplyDeps,
  tabId: number,
  transforms: Transform[],
  tabUrl: string,
  /**
   * Asked just before the insert. The caller uses it to refuse an insert for a
   * page the tab has since left; the check is the caller's because the tab and
   * document counters live in the background script (#57).
   */
  stillCurrent: () => Promise<boolean> = async () => true,
): Promise<void> {
  const settings = await deps.getSettings()
  // The container is read only when a CSS transform has a restriction, so a
  // user with none needs neither the read nor the cookies permission. A
  // restricted transform is left out when the container is unknown.
  const restricted = transforms.some((t) => t.kind === 'css' && t.cookieStoreId !== undefined)
  const tabStore = restricted ? await deps.tabCookieStore(tabId) : undefined
  const included = transforms
    .filter((t) => t.kind === 'css' && t.enabled)
    .filter((t) => appliesInContainer(t, tabStore))
    .filter((t) => problemWithStoredCode(t, settings, tabUrl) === null)
    .sort((a, b) => a.order - b.order)
  // The separator carries the position only. A transform's name is not put in
  // the CSS, because a name containing a comment terminator would end the
  // comment and let the rest of the name be read as CSS (#145).
  let css = included.map((t, i) => `/* transform ${i + 1} */\n${t.code}`).join('\n\n')

  // Second barrier: the joined string is what the page receives, so it is
  // checked as a whole, for this page and its site mode. A failure refuses the
  // whole insert.
  if (css) {
    const approved = included.flatMap((t) => t.approvedCssUrls ?? [])
    if (!checkCssForPage(css, settings, tabUrl, approved).passed) css = ''
  }

  const previous = await deps.applied.read(tabId)
  if (previous !== undefined && previous !== css) {
    await deps.removeCss(tabId, previous).catch(() => {})
    await deps.applied.forget(tabId)
  }

  if (!css || previous === css) return
  if (!(await stillCurrent())) return

  try {
    await deps.insertCss(tabId, css)
    await deps.applied.write(tabId, css)
  } catch {
    // No host permission for this origin yet, which is expected until the user
    // saves their first transform for the site.
  }
}
