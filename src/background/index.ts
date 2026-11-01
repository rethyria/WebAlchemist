/**
 * Background script. Owns credentials, provider calls, persistence, script
 * registration, and the safety pipeline.
 *
 * Nothing here hands a credential to another context. The sidebar and content
 * script talk to this module; only this module talks to a provider.
 */

import type {
  ContentEvent,
  ContentMessage,
  Message,
  MessageResponse,
} from '@shared/messages'
import { exactPagePattern, matchesUrl, originPermissionForUrl } from '@shared/match'
import { CAPTURE_GRANT_KEY } from '@shared/capture-grant'
import { appliesInContainer } from '@shared/container'
import { refuseInPrivateWindow, requireNormalWindow } from './private-window'
import { regionAtScroll, viewportChanged, type ScrollOffset, type Viewport } from '@shared/region'
import type {
  Accent,
  GenerationResult,
  ModelReview,
  PageContext,
  Rect,
  ReviewResult,
  Settings,
  Transform,
  TransformRuntimeState,
} from '@shared/types'
import { AWAITING_APPROVAL_NOTE, NEEDS_REGENERATING_NOTE, needsRegenerating } from '@shared/transform-state'
import type { RefinementTurn, ReviewInstruction } from './providers/types'
import { overlayPaletteFor } from '@shared/accents'
import * as badge from './badge'
import { openPanel } from './open-panel'
import { panelPageKey, panelPagesFromStorage } from '@shared/panel-binding'
import { SCREENSHOTS_UNAVAILABLE } from '@shared/android-limits'
import { ownersWithRunTabs, recordRunTab, takeRunTabs } from './run-tabs'
import { isUrlOff, setHostOff } from './site-off'
import { excludedHostOf, getExcludedSites, setExcludedSites } from './excluded-sites'
import { excludedHostFor, excludedSiteMessage } from '@shared/excluded-sites'
import { hostOfUrl } from '@shared/site-off'
import { isSidebarPortName, ownerOfSidebarPort, panelOwner } from '@shared/sidebar-port'
import { isApproved, spendApproval } from './approvals'
import { encryptExport, openExport } from './export-crypto'
import { blockedStates, runStaticAnalysis, staticProblem } from './code-gate'
import { assertPreviewable, checkCssForPage, checkCssTransform, pageUrlFor, sameCssContext } from './css-gate'
import {
  applyCssTransforms as applyCssTransformsFor,
  fromExtensionPage,
  handleApproveCode,
  handleBlockedCount,
  handlePreviewCss,
  handleReview,
  handleSaveSettings,
  handleSaveTransform,
  type CssApplyDeps,
  type SaveDeps,
} from './handlers'
import { documentOf, forgetTab, inTabQueue, startDocument } from './tab-queue'
import { reconcile as reconcileContentScripts } from './content-scripts'
import {
  addPreviewedScript,
  archiveApplied,
  archivePreview,
  forgetArchive,
  forgetCss,
  forgetSuspended,
  previewedScriptIds,
  previewedTabIds,
  previewScriptWindow,
  previewWindow,
  suspendedTabIds,
  suspendedWindow,
  takeArchivedApplied,
  takeArchivedPreview,
  readCss,
  readSuspended,
  removePreviewedScript,
  writeCss,
  writePreviewWindow,
  writeSuspended,
} from './css-state'
import { forgetSession, forgetSessionChecksFor, markChecked, runHealthCheck, shouldCheck } from './health'
import { withKeepalive } from './keepalive'
import { isContentEvent as isContentEventType, isExtensionPage } from './sender'
import { connect as connectOAuth } from './oauth'
import { resolveActiveProvider, ProviderError } from './providers'
import { createUsageRecorder } from './usage'
import {
  hasUserScriptsPermission,
  registerPreview,
  registerTransform,
  reregisterAll,
  unregisterPreview,
  unregisterTransform,
} from './registry'
import {
  assertValidTransform,
  bindStoredCredentials,
  clearCredential,
  deleteTransform,
  disableVault,
  discardVault,
  enableVault,
  exportTransforms,
  getAllCredentialStatuses,
  getAllTransforms,
  getVersions,
  getCredentialStatus,
  getSettings,
  getUsage,
  handleVaultIdleAlarm,
  importTransforms,
  previewImport,
  lockVault,
  reorderTransforms,
  saveSettings,
  changeSettings,
  foldUnsavedUsage,
  resetModelChosenMain,
  saveTransform,
  saveCredentialFor,
  unlockVault,
  updateTransform,
  vaultState,
} from './storage'

/*
 * One chain for the work that changes which scripts are registered and which
 * of them are previews. A rebuild reads the previewed ids and then lists what
 * the browser holds; a preview that registers itself between those two reads
 * is in the list but not in the ids, and the rebuild removed it as stale. The
 * chain is in memory, as the per-tab one is: a task cannot outlive a
 * suspension, and the rebuild at the next start recomputes from storage.
 */
let registryTail: Promise<unknown> = Promise.resolve()

function inRegistryQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = registryTail.then(task)
  registryTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * Ends a script preview: registers the saved script again and drops the id
 * from the previewed list, in one queued task. Run apart, a rebuild between
 * the two steps still lists the id as previewed and unregisters the restored
 * saved script (#91).
 */
function endPreviewScript(id: string): Promise<void> {
  return inRegistryQueue(async () => {
    await unregisterPreview(id)
    await removePreviewedScript(id)
  })
}

/**
 * Moves JavaScript transforms that run in MAIN with no record of the user's
 * approval to the isolated world, once. The caller rebuilds the registrations
 * afterwards. A failure is logged and does not stop start-up; the flag is set
 * only after the transforms were written, so the next start tries again.
 */
async function migrateModelChosenWorlds(): Promise<void> {
  try {
    await resetModelChosenMain()
  } catch (error) {
    console.error('Resetting the world of transforms failed:', error instanceof Error ? error.message : 'unknown error')
  }
}

/** Rebuilds registrations from storage, leaving preview scripts registered. */
function reregister(): Promise<void> {
  return inRegistryQueue(async () => {
    const { endedPreviews } = await reregisterAll(await previewedScriptIds())
    for (const id of endedPreviews) await removePreviewedScript(id)
  })
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

browser.runtime.onInstalled.addListener(async (details) => {
  // First, before anything that reads settings or credentials. Keys stored
  // before bindings existed are bound now, while the settings are still the
  // ones they were entered under. A sealed vault is locked after a restart; its
  // keys are bound when it is unlocked. A failure is logged and does not stop
  // the registrations below; the pass runs again at the next unlock or update.
  // Only the message is logged, never a credential.
  if (details.reason === 'update' || details.reason === 'install') {
    await bindStoredCredentials().catch((error: unknown) => {
      console.error(
        'Binding stored credentials failed:',
        error instanceof Error ? error.message : 'unknown error',
      )
    })
  }
  await foldUnsavedUsage().catch(() => undefined)
  // Before the registrations below are rebuilt, so a moved transform is
  // registered for the isolated world. Runs once; see resetModelChosenMain.
  if (details.reason === 'update') await migrateModelChosenWorlds()
  // The platform wipes every userScripts registration on update, and drops
  // dynamic content scripts too. Without this, transforms silently stop
  // working after an extension update — with no error, which is the worst
  // possible failure mode.
  if (details.reason === 'update' || details.reason === 'install') {
    await reregister()
    await reconcileContentScripts()
  }
})

// Folds the usage of discarded drafts. See foldUnsavedUsage for why only here.
browser.runtime.onStartup.addListener(() => void foldUnsavedUsage().catch(() => undefined))

/*
 * Both directions matter. Firefox drops user script registrations when the
 * permission is revoked and does not restore them when it is granted again;
 * content script registration has to follow the set of origins we hold, which
 * changes in both directions from about:addons as well as from our own
 * request at save time.
 */
// Registered at the top level so the browser can deliver an alarm that wakes a
// stopped background page.
browser.alarms.onAlarm.addListener((alarm) => void handleVaultIdleAlarm(alarm))

browser.permissions.onAdded.addListener(async (permissions) => {
  const granted = permissions.permissions as string[] | undefined
  // A JavaScript transform whose origin was revoked is not registered, and
  // granting the origin again (from the sidebar's "Grant access") is not a
  // userScripts grant, so it has to trigger registration too. reregister
  // is idempotent, so running it for an origin that changes nothing is safe.
  if (granted?.includes('userScripts') || (permissions.origins?.length ?? 0) > 0) {
    await reregister()
  }
  await reconcileContentScripts()
})

browser.permissions.onRemoved.addListener(async () => {
  await reconcileContentScripts()
  await removeCssWithoutAccess()
})

/**
 * Takes applied CSS out of the open tabs for which the extension no longer has
 * host access. Reapplying the transforms would not do it: the list is the same
 * and the CSS already applied equals what would be applied, so nothing changes.
 * A tab whose removal fails keeps its record, so that the record still says what
 * is in the page.
 */
async function removeCssWithoutAccess(): Promise<void> {
  for (const tab of await browser.tabs.query({})) {
    const tabId = tab.id
    if (tabId === undefined || !tab.url) continue
    const origin = originPermissionForUrl(tab.url)
    if (origin === null) continue
    await inTabQueue(tabId, async () => {
      const applied = await readCss('applied', tabId)
      if (applied === undefined) return
      if (await browser.permissions.contains({ origins: [origin] }).catch(() => true)) return
      try {
        await browser.scripting.removeCSS({ target: { tabId }, css: applied, origin: 'USER' })
        await forgetCss('applied', tabId)
      } catch {
        // Still in the page, so the record stays.
      }
    })
  }
}

/**
 * The operating system, read once so that the toolbar handler can decide
 * without waiting. See open-panel.ts for why the handler must not wait.
 *
 * A handler that runs after the event page wakes can run before the read has
 * finished, and would see undefined, which reads as "not Android". Those
 * handlers await `platformReady` first. The toolbar handler does not.
 */
let platformOs: string | undefined
const platformReady: Promise<void> = browser.runtime
  .getPlatformInfo()
  .then((info) => {
    platformOs = info.os
  })
  .catch(() => {})

/**
 * Clicking the toolbar button opens the sidebar on desktop, and opens the panel
 * in a tab bound to the clicked tab on Firefox for Android.
 */
browser.action.onClicked.addListener((tab) => {
  void openPanel(tab, {
    os: () => platformOs,
    hasSidebar: () => typeof browser.sidebarAction?.open === 'function',
    openSidebar: () => browser.sidebarAction.open(),
    extensionBase: () => browser.runtime.getURL(''),
    listTabs: () => browser.tabs.query({}),
    createTab: (url) => browser.tabs.create({ url, active: true }),
    activateTab: (id) => browser.tabs.update(id, { active: true }),
    reloadTab: (id) => browser.tabs.reload(id),
    recordedPage: async (panelTabId) => {
      const key = panelPageKey(panelTabId)
      const value = (await browser.storage.session.get(key))[key]
      return typeof value === 'number' ? value : undefined
    },
    recordPanel: (panelTabId, pageTabId) =>
      browser.storage.session.set({ [panelPageKey(panelTabId)]: pageTabId }),
  })
})

/* ------------------------------------------------------------------ */
/* SPA navigation                                                      */
/* ------------------------------------------------------------------ */

/**
 * pushState fires no event in page context, and monkey-patching History would
 * require the MAIN world. webNavigation gives us the same signal from outside
 * the page, with no page-visible footprint.
 */
browser.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return
  await sendToContent(details.tabId, { type: 'url-changed', url: details.url })

  /*
   * The same evaluation a full page load gets, without discarding what is
   * applied. The document survives a route change, so the stylesheet stays in
   * the page and `applyCssTransforms` compares against it: it does nothing when
   * the same CSS still applies, and removes it when the new route no longer
   * matches a transform's pattern. Before this, a single-page app that moved
   * from a matching route to a non-matching one kept the CSS and the badge
   * count, and a move the other way gained neither.
   */
  if (!(await urlChangedSinceLastEvaluation(details.tabId, details.url))) return
  await evaluateTab(details.tabId, details.url, { navigated: false })
})

/**
 * replaceState and pushState with the URL the tab already has fire the same
 * event as a real route change. Evaluating each one costs a storage read, a
 * badge update and, in every-load mode, a full health check, for a page that
 * has not changed. The last evaluated URL is kept in storage.session so the
 * comparison still works after the event page is suspended; a missing entry
 * counts as a change.
 */
async function urlChangedSinceLastEvaluation(tabId: number, url: string): Promise<boolean> {
  const key = `wa-last-url-${tabId}`
  const previous = (await browser.storage.session.get(key))[key]
  if (previous === url) return false
  await browser.storage.session.set({ [key]: url })
  return true
}

browser.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return
  // The page reloaded, so nothing we injected survives — forget it rather
  // than trying to remove a stylesheet that is already gone.
  //
  // The counter moves before anything is awaited, so a task still queued for
  // the old document sees that it is out of date. The forget steps are queued
  // behind it for the same reason every other CSS change is: one that finished
  // late would store a string for a document that is gone.
  const restored = details.transitionQualifiers?.includes('forward_back') ?? false
  startDocument(details.tabId)
  /*
   * Read before the write below replaces it: this is the URL of the document
   * the tab is leaving, which is what a preview made on it is filed under.
   */
  const leftUrlKey = `wa-last-url-${details.tabId}`
  const leaving = browser.storage.session.get(leftUrlKey)
  /*
   * Written before the first await. A page can call replaceState while it
   * loads, and that event records its own URL. This write used to come after
   * the queued forget steps, so it could land after the replaceState's and
   * overwrite the newer URL with the commit's; a later route back to the
   * commit URL then looked unchanged and was skipped.
   */
  const recorded = browser.storage.session.set({ [leftUrlKey]: details.url })
  let orphaned: string | undefined
  await inTabQueue(details.tabId, async () => {
    // Filed under the address of the document being left, as a preview is, for
    // the case that the tab comes back to it from the back-forward cache.
    const leftUrl = (await leaving)[leftUrlKey]
    const appliedCss = await readCss('applied', details.tabId)
    if (appliedCss !== undefined && typeof leftUrl === 'string') {
      await archiveApplied(details.tabId, { url: leftUrl, css: appliedCss })
    }
    await forgetCss('applied', details.tabId)
    if (restored) {
      // A restored document still has the stylesheet it had when it was left,
      // and it was chosen under the settings of that time. It is taken out
      // before the CSS for the present settings is applied, so a site whose
      // setting was tightened while the page was cached does not keep CSS that
      // the new setting refuses (#80). Nothing is removed when the browser
      // loaded the page afresh: removing a stylesheet that is not there does nothing.
      const before = await takeArchivedApplied(details.tabId, details.url)
      if (before) await removePreviewCss(details.tabId, before.css)
    }
    /*
     * A preview belongs to the document it was inserted into. When the tab
     * leaves that document its string is filed under the document's URL
     * instead of being kept as the tab's current preview, because the stored
     * string is only useful for removal if the document that has the stylesheet
     * is the one the tab shows.
     *
     * A document that returns from the back-forward cache is restored as it
     * was, preview stylesheet included, so its filed string becomes the tab's
     * preview again and can still be removed. For a document loaded afresh
     * nothing is restored and the filed string is never used. The applied
     * string cannot be handled this way: it is forgotten on every commit so the
     * CSS is inserted again, since comparing with the stored string would skip
     * inserting into a document that does not have it.
     */
    const url = (await leaving)[leftUrlKey]
    const css = await readCss('preview', details.tabId)
    if (css !== undefined && typeof url === 'string') {
      await archivePreview(details.tabId, {
        url,
        css,
        windowId: await previewWindow(details.tabId),
      })
    }
    await forgetCss('preview', details.tabId)
    if (restored) {
      const back = await takeArchivedPreview(details.tabId, details.url)
      if (back && ownerIsGone(back.windowId)) {
        // The sidebar that made the preview closed while the page was cached,
        // and the cached document still has the stylesheet. Making it the tab's
        // preview again would leave a preview nothing owns, so it is removed
        // below, outside this task because removal is queued too (#80).
        orphaned = back.css
      } else if (back && (await restoredPreviewRefused(details.tabId, details.url, back.css))) {
        // The kill switch, the site's off switch, the excluded list or the CSS
        // setting refuses it now, as it would refuse a new preview (#146).
        orphaned = back.css
      } else if (back) {
        await writeCss('preview', details.tabId, back.css)
        await writePreviewWindow(details.tabId, back.windowId)
      }
    }
  })
  if (orphaned !== undefined) await clearPreviewCss(details.tabId, orphaned)
  await recorded
  await evaluateTab(details.tabId, details.url, { navigated: true })
})

/**
 * Applies CSS, updates the badge and starts the health check for a top frame
 * whose URL just changed, by page load or by history state.
 *
 * `navigated` is true for a new document. A new document starts with no known
 * breakage, so the badge's broken state is reset. A route change keeps the
 * document, and the broken state is kept until a health check replaces it,
 * because clearing it would hide a problem that is still on the page when the
 * configured mode runs no new check.
 */
async function evaluateTab(
  tabId: number,
  url: string,
  { navigated }: { navigated: boolean },
): Promise<void> {
  // Taken before any await, so a check that is still running for an earlier
  // evaluation of this tab is already out of date by the time this one reads
  // storage.
  const evaluation = beginEvaluation(tabId)
  const transforms = await inTabContainer(tabId, await transformsForUrl(url))

  /*
   * Before the early return below, not after. A tab that navigates from a site
   * with transforms to one without has to lose its badge, and that is the
   * `transforms.length === 0` case — the one the early return skips.
   */
  const settings = await getSettings()
  if (navigated) await badge.tabNavigated(tabId, transforms.length, settings.accent)
  else await badge.transformCountChanged(
    tabId,
    transforms.map((t) => t.id),
    settings.accent,
  )

  // A route change may leave nothing to apply, and the previous route's CSS
  // has to come out. On a new document nothing was applied, so this is a no-op.
  if (!navigated || transforms.length > 0) {
    await applyCssTransforms(tabId, () => cssTransformsFor(tabId, url), url)
  }

  if (transforms.length === 0) return
  if (!(await shouldCheck(settings, url, transforms))) return

  // Deliberately not awaited alongside the CSS application: the check waits up
  // to three seconds for a slow page to settle, and CSS must not queue behind
  // it. A visible delay before the page restyles would be a worse bug than a
  // late health result.
  void checkAndPublish(tabId, url, transforms, () => isLatestEvaluation(tabId, evaluation))
}

/*
 * Which evaluation of each tab is the latest, so a health check can tell that
 * the page it was started for has been replaced. A counter rather than the URL:
 * a reload keeps the URL and still replaces the document. In memory because a
 * check cannot outlive a suspension anyway, and after one the missing entry
 * makes every old check count as out of date, which is the safe answer.
 */
const evaluations = new Map<number, number>()

function beginEvaluation(tabId: number): number {
  const next = (evaluations.get(tabId) ?? 0) + 1
  evaluations.set(tabId, next)
  return next
}

function isLatestEvaluation(tabId: number, evaluation: number): boolean {
  return evaluations.get(tabId) === evaluation
}

/* ------------------------------------------------------------------ */
/* Message routing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Content events are ignored here, not relayed.
 *
 * `runtime.sendMessage` from a content script already reaches every extension
 * page, the sidebar included — it does not need forwarding. Re-sending them
 * delivered each one twice, which a retarget test caught: every pick appeared
 * as two identical events.
 *
 * They still have to be recognised, so `handle()` does not fall through its
 * switch and answer a page-side event with a bare `{ ok: true }`.
 */
function isContentEvent(message: Message | ContentEvent): message is ContentEvent {
  return isContentEventType(message) || message.type === 'health-check-result'
}

browser.runtime.onMessage.addListener(
  (
    message: Message | ContentEvent,
    sender,
  ): Promise<MessageResponse<unknown>> | undefined => {
    if (isContentEvent(message)) return undefined

    // Everything past this point is privileged. See sender.ts for why the
    // check is on the URL.
    if (!isExtensionPage(sender)) {
      return Promise.resolve({
        ok: false,
        error: { message: 'This message is only accepted from the extension\'s own pages.' },
      })
    }

    return handle(message, sender).then(
      (data) => ({ ok: true, data }),
      (error: unknown) => ({
        ok: false,
        error:
          error instanceof ProviderError
            ? {
                message: error.message,
                kind: error.kind,
                retryable: error.retryable,
                // Only present when the provider said. Absent and zero mean
                // different things — see providers/retry-after.ts.
                ...(error.retryInSeconds === undefined
                  ? {}
                  : { retryInSeconds: error.retryInSeconds }),
              }
            : { message: error instanceof Error ? error.message : String(error) },
      }),
    )
  },
)

async function handle(
  message: Message,
  sender: browser.runtime.MessageSender,
): Promise<unknown> {
  // The CSP probe messages are handled only in a probe build. The condition is
  // a build-time constant, so a release build contains neither the message
  // names nor the probe's code, and answers these messages like any message
  // that has no handler (#60). They are not cases of the switch below, because
  // a case label would keep the message name in the release build.
  if (import.meta.env.VITE_CSP_PROBE === '1') {
    if (message.type === 'clear-csp-probe') {
      await unregisterTransform('wa-csp-probe')
      return true
    }
    if (message.type === 'run-csp-probe') {
      // Registered, never saved. It must not appear in the user's transform
      // list, and it must come back out when the run is over.
      const { buildProbeTransform } = await import('./csp-probe')
      await registerTransform(buildProbeTransform(), { skipAnalysis: true })
      await browser.tabs.update(message.tabId, { url: 'http://localhost:8787/' })
      return true
    }
  }
  switch (message.type) {
    case 'get-settings':
      return getSettings()

    case 'get-transforms-for-url':
      return matchingTransforms(message.url)

    case 'get-all-transforms':
      return getAllTransforms()

    case 'get-transform': {
      const all = await getAllTransforms()
      return all.find((t) => t.id === message.id) ?? null
    }

    /*
     * Saving from the editor: it is its own tab, so there is no page to hand
     * back the way the panel does. Every tab the transform matches is brought
     * up to date instead, which is what "saved" has to mean when the thing
     * being edited is somewhere else entirely.
     */
    case 'reapply-everywhere': {
      const all = await getAllTransforms()
      const saved = all.find((t) => t.id === message.id)
      if (!saved) return false

      if (saved.kind === 'js') {
        // Registration carries the code, so a changed script has to be
        // re-registered; the page picks it up on its next load either way.
        // Queued with the start-up rebuild so the two cannot interleave (#91).
        await inRegistryQueue(async () => {
          if (saved.enabled) await registerTransform(saved)
          else await unregisterTransform(saved.id)
        })
      }

      /*
       * Every open tab, not only those the new pattern matches. The editor can
       * change the pattern, and a tab that matched the old one no longer does:
       * filtering by the saved record left the stylesheet applied there and
       * the badge count unchanged until the tab navigated. `reapply` already
       * works out what each tab should show, so a tab it has nothing to do for
       * costs one storage read.
       */
      const tabs = await browser.tabs.query({})
      for (const tab of tabs) {
        if (tab.id === undefined || !tab.url) continue
        await reapply(tab.id)
      }
      return true
    }

    case 'get-blocked-states':
      return blockedStates(await matchingTransforms(message.url), await getSettings(), message.url)

    case 'get-blocked-count':
      return handleBlockedCount({ getAllTransforms, getSettings })

    case 'get-credential-statuses':
      return getAllCredentialStatuses()

    case 'get-vision-support': {
      const provider = await resolveActiveProvider()
      return withKeepalive(() => provider.supportsVision())
    }

    case 'repair': {
      await requireNormalWindow(message.tabId)
      await refuseExcludedUrl(message.context.url)
      const transforms = await getAllTransforms()
      const existing = transforms.find((t) => t.id === message.transformId)
      if (!existing) throw new Error('That transform no longer exists.')
      // A repair sends the stored description to the model without showing it.
      // For an imported transform that description was written by the author
      // of the file, so it goes through Edit description, which shows it first.
      if (existing.origin === 'imported') {
        throw new Error(
          'This transform came from an imported file. Use Edit description to read its description before it is used.',
        )
      }

      const usage = createUsageRecorder(existing.id)
      let result: GenerationResult
      try {
        const provider = await resolveActiveProvider(usage.listener)
        result = await withKeepalive(() =>
          provider.generate({
            context: message.context,
            instruction: existing.intent,
            history: [],
            repair: {
              intent: existing.intent,
              previousCode: existing.code,
              previousRationale: existing.rationale,
              brokenReason: message.brokenReason,
            },
          }),
        )
      } finally {
        // In `finally` so a billed call that then failed to parse is counted.
        await usage.settled()
      }
      return { result, usage: await usage.settled() }
    }

    case 'review':
      return handleReview(message, fromExtensionPage(sender, browser.runtime.getURL('')), {
        runReview,
      })

    case 'approve-code':
      return handleApproveCode(message, fromExtensionPage(sender, browser.runtime.getURL('')))

    case 'get-usage':
      return getUsage()

    case 'analyse':
      return runStaticAnalysis(message.code, message.declaredCapabilities)

    case 'analyse-css': {
      const tab =
        message.tabId === undefined
          ? undefined
          : await browser.tabs.get(message.tabId).catch(() => undefined)
      return checkCssForPage(
        message.css,
        await getSettings(),
        pageUrlFor(message.match, tab?.url),
        message.approvedUrls,
      )
    }

    case 'save-transform':
      await refuseInPrivateWindow(message.tabId)
      return handleSaveTransform(
        message.source ? { ...message, transform: { ...message.transform, producedBy: message.source } } : message,
        saveDeps,
      )

    case 'get-transform-versions':
      return getVersions(message.id)

    case 'restore-transform-version': {
      await refuseInPrivateWindow(message.tabId)
      const current = (await getAllTransforms()).find((t) => t.id === message.id)
      if (!current) throw new Error('That transform no longer exists.')
      const version = (await getVersions(message.id)).find((v) => v.id === message.versionId)
      if (!version) throw new Error('That version is no longer kept.')
      // The same handler as any other save, with no exemption, so a restored
      // script meets the static analysis as it is now (the rules may have
      // changed since it was saved) and needs an approval token for its code,
      // world, capabilities and match. The editor obtains the token from
      // approve-code. The current state becomes a version in turn, so a
      // restore can be undone.
      const { world: _world, producedBy: _producedBy, ...rest } = current
      return handleSaveTransform(
        {
          type: 'save-transform',
          transform: {
            ...rest,
            code: version.code,
            rationale: version.rationale,
            match: version.match,
            capabilities: version.capabilities,
            ...(version.world === undefined ? {} : { world: version.world }),
            ...(version.producedBy === undefined ? {} : { producedBy: version.producedBy }),
          },
          ...(message.tabId === undefined ? {} : { tabId: message.tabId }),
          ...(message.approvalToken ? { approvalToken: message.approvalToken } : {}),
        },
        saveDeps,
      )
    }

    case 'delete-transform': {
      const doomed = (await getAllTransforms()).find((t) => t.id === message.id)
      // Both steps in one queued task: a rebuild that ran between them would
      // read the script from storage and register it again (#91).
      await inRegistryQueue(async () => {
        await unregisterTransform(message.id)
        await deleteTransform(message.id)
      })
      const { accent } = await getSettings()
      await badge.transformEdited(message.id, accent)
      await repaintOtherTabs([doomed?.match], accent)
      // Take it off the page now. Without this a deleted CSS transform stayed
      // applied until the next navigation — the row vanished from the list
      // while the change it made was still on screen, which reads as the
      // delete having failed.
      await reapply(message.tabId)
      return true
    }

    case 'reorder-transforms':
      await reorderTransforms(message.orderedIds)
      // Order decides which transform wins a conflict, so a reorder can change
      // what the page looks like. Same omission delete had: without this the
      // new precedence only took effect on the next navigation.
      await reapply(message.tabId)
      return true

    case 'set-enabled': {
      // Turning on a transform with no code would store enabled: true while
      // nothing runs, which the list then shows as a working transform.
      let approvedMain = false
      if (message.enabled) {
        const stored = (await getAllTransforms()).find((t) => t.id === message.id)
        if (stored && needsRegenerating(stored)) throw new Error(NEEDS_REGENERATING_NOTE)
        // JavaScript restored from a backup runs only after the user approved
        // this code. The token ties the approval to the stored code, world,
        // capabilities, id and match pattern, as for a save (#124).
        if (stored?.awaitsApproval) {
          const approved = await isApproved(
            message.approvalToken,
            stored.code,
            stored.world,
            stored.capabilities,
            { transformId: stored.id, match: stored.match },
          )
          if (!approved || !runStaticAnalysis(stored.code, stored.capabilities).passed) {
            throw new Error(AWAITING_APPROVAL_NOTE)
          }
          await spendApproval(message.approvalToken!)
          // The token is tied to the world, and the panel showed the risks of
          // MAIN before it was requested, so this is the user's approval of
          // MAIN. A restored record has no such record until now (#124, #53).
          approvedMain = stored.world === 'MAIN'
        }
      }
      // One queued update rather than a read followed by saveTransform: the
      // read has to be inside the queue or a concurrent save is overwritten.
      const next = await updateTransform(message.id, {
        enabled: message.enabled,
        // Cleared once the approval has been used.
        ...(message.enabled ? { awaitsApproval: null } : {}),
        ...(approvedMain ? { mainApprovedByUser: true } : {}),
      })
      if (!next) throw new Error('That transform no longer exists.')
      if (next.kind === 'js') {
        await inRegistryQueue(async () => {
          if (next.enabled) await registerTransform(next)
          else await unregisterTransform(next.id)
        })
      }
      // A toggle that takes effect on the next reload is not a toggle.
      await reapply(message.tabId)
      return true
    }

    case 'save-settings': {
      return handleSaveSettings(message, {
        saveSettings,
        reregisterAll: (before) => afterSettingsWritten(before.aiJsKillSwitch),
        reapplyAllTabs,
      })
    }

    case 'count-js-tabs':
      return countTabsWithJavaScript(() => true)

    case 'get-excluded-sites':
      return getExcludedSites()

    case 'set-excluded-sites': {
      const before = await getExcludedSites()
      const after = await setExcludedSites(message.sites)
      // Registrations carry the list in `excludeMatches`, so they are rebuilt,
      // and the content script registrations with them. Open tabs that the
      // change covers lose or regain their CSS and badge count (#131).
      await reregister()
      await reconcileContentScripts()
      const changed = (url: string) =>
        excludedHostFor(before, url) !== excludedHostFor(after, url)
      const nowExcluded = (url: string) => excludedHostFor(after, url) !== null
      await clearCssPreviewsOn(nowExcluded)
      await reapplyOpenTabs(changed)
      return after
    }

    case 'page-has-sensitive-fields':
      // Only an answer of false means the page has no such fields. No answer
      // (no content script, or the page did not reply) is reported as a page
      // with them, so that the panel asks before sending text it could not check (#131).
      return (await askContent(message.tabId, { type: 'sensitive-fields' })) !== false

    case 'get-site-off':
      return isUrlOff(message.url)

    case 'set-site-off': {
      const host = hostOfUrl(message.url)
      if (host === null) throw new Error('That page is not a website, so it cannot be turned off.')
      await setHostOff(host, message.off)
      await reregister()
      const onHost = (url: string) => hostOfUrl(url) === host
      if (message.off) await clearCssPreviewsOn(onHost)
      await reapplyOpenTabs(onHost)
      // Only when turning off. The user chose this site, and a page that was
      // broken by a transform needs the reload to get rid of its scripts. When
      // turning back on, nothing is reloaded and the tabs are counted.
      const tabs = await tabsWithJavaScript(onHost)
      if (message.off) for (const id of tabs) await browser.tabs.reload(id).catch(() => {})
      return { reloadTabs: message.off ? 0 : tabs.length, reloaded: message.off ? tabs.length : 0 }
    }

    case 'patch-settings': {
      // Read inside the settings queue, so this change keeps its place there
      // relative to a save sent at the same time (#85).
      let switchBefore = false
      const saved = await changeSettings(message.change, (before) => {
        switchBefore = before.aiJsKillSwitch
      })
      if (message.change.kind === 'fields') await afterSettingsWritten(switchBefore)
      return saved
    }

    case 'set-credential': {
      // The destination the key is bound to comes from the saved provider, not
      // from the message.
      const provider = (await getSettings()).providers.find((p) => p.id === message.providerId)
      if (!provider) throw new Error('That provider is no longer configured.')
      await saveCredentialFor(provider, message.credential)
      return true
    }

    case 'clear-credential':
      await clearCredential(message.providerId)
      return true

    case 'connect-oauth': {
      const settings = await getSettings()
      const provider = settings.providers.find((p) => p.id === message.providerId)
      if (!provider) throw new Error('That provider is no longer configured.')

      /*
       * Anthropic is refused here as well as in the adapter. Anthropic
       * restricted OAuth to Claude Code and Claude.ai and disabled third-party
       * tokens; a flow that appeared to work would be one that violated their
       * terms. Refusing at the point of use rather than only hiding the button
       * means it stays refused if the button is ever shown by mistake.
       */
      if (provider.type === 'anthropic') {
        throw new Error(
          'Anthropic does not offer sign-in to third-party applications. Use an API key.',
        )
      }
      if (!provider.oauth) {
        throw new Error(
          'This provider has no sign-in endpoints configured. Add them in settings first.',
        )
      }

      await saveCredentialFor(provider, await connectOAuth(provider.oauth))
      return getCredentialStatus(message.providerId)
    }

    case 'vault-state':
      return vaultState()

    case 'enable-vault':
      await enableVault(message.passphrase)
      return true

    case 'disable-vault':
      return disableVault(message.passphrase)

    case 'unlock-vault':
      return unlockVault(message.passphrase)

    case 'lock-vault':
      await lockVault()
      return true

    case 'discard-vault':
      await discardVault()
      return true

    case 'preview-css': {
      // Taken before the first check reads the tab, so that a navigation after
      // the check is seen when the preview is about to be inserted.
      const checkedDocument = documentOf(message.tabId)
      await refuseWhenOff(message.tabId)
      return handlePreviewCss(message, {
        getSettings,
        tabUrl: tabUrlOf,
        setPreviewCss: async (tabId, css) =>
          setPreviewCss(tabId, css, await ownerOfTab(tabId), checkedDocument),
      })
    }

    case 'clear-preview-css':
      await clearPreviewCss(message.tabId, message.css)
      return true

    case 'preview-js': {
      // Re-run static analysis here rather than trusting that the caller did.
      // This is the last point before arbitrary generated code is registered to
      // run on a real page, so it is the one that has to hold.
      const analysis = runStaticAnalysis(
        message.transform.code,
        message.transform.capabilities,
      )
      if (!analysis.passed) {
        throw new Error('Static analysis rejected this code, so it was not run.')
      }
      /*
       * Registered for the page in this tab only. The draft's own match pattern
       * is usually the whole site with its subdomains, and a preview that used
       * it ran unreviewed code on every other tab of the site that loaded
       * while the preview was registered (#55). The address is read from the
       * tab here and not taken from the message.
       */
      const tabUrl = await tabUrlOf(message.tabId)
      const previewMatch = exactPagePattern(tabUrl)
      if (tabUrl === undefined || previewMatch === null) {
        throw new Error('This page cannot be previewed, so the script was not run.')
      }
      // The sidebar names the address it showed the user. A tab that has since
      // moved to another page is not the page the code was reviewed for.
      if (withoutFragment(message.expectedUrl) !== withoutFragment(tabUrl)) {
        throw new Error('The tab has moved to another page, so the script was not run.')
      }
      // The draft's own pattern says where the code is meant to run, and the
      // preview is only for a page that pattern covers (#55).
      if (!matchesUrl(message.transform.match, tabUrl)) {
        throw new Error("This page is not one that the transform's sites cover, so the script was not run.")
      }
      await refuseExcludedUrl(tabUrl)
      // The model review must have matched this code, world, capabilities, id
      // and pattern. Static analysis alone is not the review. The token is not
      // spent: the save that follows uses it.
      if (
        !(await isApproved(
          message.approvalToken,
          message.transform.code,
          message.transform.world,
          message.transform.capabilities,
          { transformId: message.transform.id, match: message.transform.match },
          { verdict: 'match' },
        ))
      ) {
        throw new Error('The model review did not match this code, so the script was not run.')
      }
      const previewTransform = { ...message.transform, match: previewMatch }

      // Recorded before registering: registerPreview pauses the saved script
      // first, so a close of the sidebar during or after a failed registration
      // has to find the id in storage to restore it. Registration runs in the
      // same queue as the start-up rebuild, so the rebuild cannot remove a
      // preview that is being added (#91).
      const owner = await ownerOfTab(message.tabId)
      await inRegistryQueue(async () => {
        await addPreviewedScript(message.transform.id, owner)
        try {
          await registerPreview(previewTransform)
        } catch (cause) {
          await removePreviewedScript(message.transform.id)
          throw cause
        }
      })
      try {
        await browser.tabs.reload(message.tabId)
      } catch (cause) {
        // The preview is registered and the saved script paused, but the
        // sidebar treats a rejected request as "nothing ran" and never sends a
        // clear, so the registration is removed here.
        await endPreviewScript(message.transform.id).catch(() => {})
        throw cause
      }
      return true
    }

    case 'clear-preview-js':
      await endPreviewScript(message.id)
      return true

    case 'start-picking': {
      await platformReady
      await refuseInPrivateWindow(message.tabId)
      // The panel checks this first so that no permission is requested; this
      // is the check for any other caller of the message.
      await refuseExcludedTab(message.tabId)
      await recordRunTabOf(message.tabId)
      // Inject only when nothing is answering. executeScript re-runs the file
      // unconditionally, and a second instance brings a second overlay and a
      // second set of listeners — see the guard in the content script.
      const alive = await askContent(message.tabId, { type: 'ping' })
      if (alive !== true) {
        await browser.scripting.executeScript({
          target: { tabId: message.tabId },
          files: ['src/content/index.js'],
        })
      }

      // Resolved here rather than in the content script: settings live in the
      // background, and the overlay has no way to read a CSS variable of ours.
      const settings = await getSettings()
      const dark = matchMedia('(prefers-color-scheme: dark)').matches
      await sendToContent(message.tabId, {
        type: 'start-picking',
        palette: overlayPaletteFor(settings.accent, dark),
        mode: message.mode ?? 'target',
        // A finger cannot hover or press keys; the content script switches to taps.
        touch: platformOs === 'android',
      })
      return true
    }

    /*
     * Answered by the content script from the live DOM, so the reply carries
     * the page as it stands — including any preview already applied to it.
     * Null when the element has gone, which the caller treats as a reason to
     * keep the context it already has rather than as a failure.
     */
    case 'recapture':
      await refuseInPrivateWindow(message.tabId)
      return askContent(message.tabId, { type: 'recapture' })

    case 'context-for-anchor': {
      await refuseInPrivateWindow(message.tabId)
      await recordRunTabOf(message.tabId)
      // The page keeps the palette from the last start-picking, and a page
      // that has had no pick has none, so Edit description drew no outline.
      const settings = await getSettings()
      const dark = matchMedia('(prefers-color-scheme: dark)').matches
      return askContent(message.tabId, {
        type: 'context-for-anchor',
        anchor: message.anchor,
        palette: overlayPaletteFor(settings.accent, dark),
      })
    }

    case 'suspend-transform': {
      const tab = await browser.tabs.get(message.tabId).catch(() => undefined)
      const url = tab?.url
      if (!url) return false
      // Recorded before applying: every later evaluation of this tab reads the
      // record, so a route change cannot bring the paused version back.
      if (message.id === null) await forgetSuspended(message.tabId)
      else await writeSuspended(message.tabId, message.id, await ownerOfTab(message.tabId))
      await applyCssTransforms(message.tabId, () => cssTransformsFor(message.tabId, url), url)
      return true
    }

    case 'find-conflicts':
      // No content script on this page means no answer, not an error: the
      // list is still perfectly usable without the overlap noted on it.
      return (await askContent(message.tabId, {
        type: 'find-conflicts',
        specs: message.specs,
      })) ?? []

    case 'stop-picking':
      await sendToContent(message.tabId, { type: 'cancel-picking' })
      return true

    case 'picker-key':
      await sendToContent(message.tabId, { type: 'picker-key', action: message.action })
      return true

    case 'retarget':
      await sendToContent(message.tabId, {
        type: 'retarget',
        path: message.path,
      })
      return true

    case 'highlight-node':
      await sendToContent(message.tabId, {
        type: 'highlight-node',
        path: message.path,
      })
      return true

    case 'expand-node':
      return askContent(message.tabId, { type: 'expand-node', path: message.path })

    case 'set-lock-scope': {
      // Both numbers come from the page: what the depth resolves to is a fact
      // about the live DOM, not something worth estimating in the panel.
      const reply = (await askContent(message.tabId, {
        type: 'set-lock-scope',
        depth: message.depth,
      })) as { count?: number; container?: string | null } | undefined
      return { count: reply?.count ?? 1, container: reply?.container ?? null }
    }

    case 'clear-lock':
      await sendToContent(message.tabId, { type: 'clear-lock' })
      return true


    case 'check-now': {
      // A manual check must actually run, even under once-per-session where
      // this host has already been seen.
      //
      // The evaluation counter is taken first, as evaluateTab does, so a
      // navigation that happens while the check runs makes this one out of
      // date. Without it a late result painted "!" on the page the tab had
      // moved to.
      const evaluation = beginEvaluation(message.tabId)
      const isCurrent = () => isLatestEvaluation(message.tabId, evaluation)
      const transforms = await inTabContainer(message.tabId, await transformsForUrl(message.url))
      await forgetSession(message.url, transforms)
      const settings = await getSettings()
      const health = await runHealthCheck(message.tabId, transforms, isCurrent)
      // A transform whose code is refused is listed as broken whatever the page
      // check found, so the result carries it too.
      const blocked = blockedStates(transforms, settings, message.url)
      const states = mergeBlocked(health ?? [], blocked)
      // Without this a manual check showed its result in the panel only: a
      // broken transform it found left the badge unchanged, and a clean result
      // did not clear an earlier "!". No result means no change, and neither
      // does a result for a page the tab has left.
      if ((health || blocked.length > 0) && isCurrent()) {
        const { accent } = await getSettings()
        if (isCurrent()) await badge.healthChecked(message.tabId, brokenIds(states), accent)
      }
      return states
    }

    case 'capture-region':
      await platformReady
      if (platformOs === 'android') throw new Error(SCREENSHOTS_UNAVAILABLE)
      await refuseInPrivateWindow(message.tabId)
      return captureWithLockDown(
        message.tabId,
        message.rect,
        message.viewportWidth,
        message.url,
        message.scrolledTo,
        message.devicePixelRatio,
      )


    case 'export-transforms': {
      const bundle = await exportTransforms(message.mode ?? 'share')
      return message.passphrase === undefined ? bundle : encryptExport(bundle, message.passphrase)
    }

    case 'preview-import': {
      const settings = await getSettings()
      return previewImport(await openExport(message.bundle, message.passphrase), {
        cssProblem: (t) => cssProblemOf(t, settings),
        jsProblem: (t) => staticProblem(t.code, t.capabilities),
      })
    }

    case 'import-transforms': {
      /*
       * Shared CSS arrives with its code, so it gets the same check as CSS
       * written here. One that fails is imported without code, the way shared
       * JavaScript is, so the row is kept and nothing runs. The check uses the
       * importer's own settings for the site, so a site set to allow more is
       * not held to the default. Every imported record is disabled (see
       * sanitiseIncoming).
       */
      const settings = await getSettings()
      const result = await importTransforms(
        await openExport(message.bundle, message.passphrase),
        {
          cssProblem: (t) => cssProblemOf(t, settings),
          jsProblem: (t) => staticProblem(t.code, t.capabilities),
        },
        message.restoreSettings === true,
      )
      await reregister()
      return result
    }
  }
}

/** The first reason CSS fails the check for the settings given, or null when it passes. */
function cssProblemOf(t: Pick<Transform, 'code' | 'match'>, settings: Settings): string | null {
  const check = checkCssTransform(t, settings)
  if (check.passed) return null
  return (
    check.static.find((f) => f.severity === 'block')?.explanation ??
    'It loads addresses outside the site that were not approved.'
  )
}

/**
 * A transform that may not run is listed as broken whatever the page check
 * found: its anchor can resolve perfectly well while its code is the problem.
 */
function mergeBlocked(
  states: TransformRuntimeState[],
  blocked: TransformRuntimeState[],
): TransformRuntimeState[] {
  const ids = new Set(blocked.map((b) => b.id))
  return [...states.filter((s) => !ids.has(s.id)), ...blocked]
}

/**
 * Runs a check and forwards the result to an open sidebar.
 *
 * Nothing is persisted. Broken-ness is a fact about the page as it is right
 * now, not a property of the transform — storing it would mean showing a stale
 * warning about a site that has since been fixed.
 */
function brokenIds(states: TransformRuntimeState[]): string[] {
  return states.filter((state) => state.status === 'broken').map((state) => state.id)
}

async function checkAndPublish(
  tabId: number,
  url: string,
  transforms: Transform[],
  isCurrent: () => boolean,
): Promise<void> {
  const settings = await getSettings()
  const blocked = blockedStates(transforms, settings, url)
  const health = await runHealthCheck(tabId, transforms, isCurrent)
  if (health) await markChecked(url, transforms)
  // No health result because the page was replaced means there is nothing
  // current to publish, blocked transforms included.
  if (!health && (blocked.length === 0 || !isCurrent())) return
  const states = mergeBlocked(health ?? [], blocked)

  // Checked again after each await: the tab can navigate while the settings
  // are read or the badge is written, and a result for the old page must not
  // reach the badge or the sidebar.
  if (!isCurrent()) return
  await badge.healthChecked(tabId, brokenIds(states), settings.accent)

  if (!isCurrent()) return
  await browser.runtime
    .sendMessage({ type: 'health-check-result', tabId, states })
    .catch(() => {})
}

/* ------------------------------------------------------------------ */
/* Previews                                                            */
/* ------------------------------------------------------------------ */

/*
 * Preview state lives here rather than in the sidebar because the sidebar can
 * disappear without warning — a closed panel runs no teardown, and the page
 * would be left carrying an unsaved change the user was told was discarded.
 *
 * Holding the exact injected string matters: removeCSS matches on content, so
 * the only way to take a preview back out is to have kept what went in. It is
 * kept in storage.session (see css-state.ts) because this page is suspended
 * after 30 idle seconds and a module-level map would not survive that.
 */

async function removePreviewCss(tabId: number, css: string): Promise<void> {
  await browser.scripting
    .removeCSS({ target: { tabId }, css, origin: 'USER' })
    .catch(() => {})
}

async function windowOfTab(tabId: number): Promise<number | undefined> {
  return (await browser.tabs.get(tabId).catch(() => undefined))?.windowId
}

/**
 * The owner of what the panel does to a page tab: the panel tab bound to it
 * when there is one, and otherwise the window the page is in, whose docked
 * sidebar is the owner. One window can hold several panel tabs, so a window id
 * cannot tell their runs apart. Undefined when neither is known.
 */
async function ownerOfTab(tabId: number): Promise<number | undefined> {
  const panels = panelPagesFromStorage(await browser.storage.session.get(null))
  for (const [panel, page] of panels) if (page === tabId) return panelOwner(panel)
  return windowOfTab(tabId)
}

function setPreviewCss(
  tabId: number,
  css: string,
  windowId: number | undefined,
  /** The document the CSS was checked for. A preview is refused for any other. */
  checkedDocument: number,
): Promise<void> {
  return inTabQueue(tabId, async () => {
    // The check read the tab's address for one document. The CSS may pass for
    // that page and fail for the one the tab shows now, and insertCSS would put
    // it into whichever is there.
    if (documentOf(tabId) !== checkedDocument) {
      throw new Error('The page changed while the preview was being prepared, so it was not shown.')
    }
    const existing = await readCss('preview', tabId)
    if (existing) {
      await removePreviewCss(tabId, existing)
      await forgetCss('preview', tabId)
    }
    await browser.scripting.insertCSS({ target: { tabId }, css, origin: 'USER' })
    await writeCss('preview', tabId, css)
    await writePreviewWindow(tabId, windowId)
  })
}

/**
 * Takes a preview out. `carried` is the string the sidebar says it inserted;
 * the stored copy is removed as well when it differs, so a mismatch between
 * the two cannot leave a stylesheet behind.
 */
function clearPreviewCss(tabId: number, carried?: string): Promise<void> {
  return inTabQueue(tabId, async () => {
    const stored = await readCss('preview', tabId)
    const strings = new Set([carried, stored].filter((css): css is string => !!css))
    for (const css of strings) await removePreviewCss(tabId, css)
    await forgetCss('preview', tabId)
  })
}

/**
 * Takes out the previews, and lifts the pauses on transforms, that belong to
 * windows for which `ownerIsGone` is true. A preview with no recorded window
 * has no owner and is always taken out.
 */
async function clearPreviewsWhere(
  ownerIsGone: (windowId: number | undefined) => boolean,
): Promise<void> {
  for (const tabId of await previewedTabIds()) {
    if (ownerIsGone(await previewWindow(tabId))) await clearPreviewCss(tabId)
  }
  for (const id of await previewedScriptIds()) {
    if (!ownerIsGone(await previewScriptWindow(id))) continue
    await endPreviewScript(id)
  }
  // A pause belongs to the window whose sidebar set it: that sidebar is the one
  // that resumes it, and a sidebar that closed cannot. The window stored with
  // the pause is used; the tab's current window is only the answer for a pause
  // stored without one.
  for (const tabId of await suspendedTabIds()) {
    const owner = (await suspendedWindow(tabId)) ?? (await ownerOfTab(tabId))
    if (!ownerIsGone(owner)) continue
    await forgetSuspended(tabId)
    await reapply(tabId)
  }
}

/**
 * Takes out the CSS previews in the tabs whose address passes `include`. Used
 * when a switch that stops transforms changes: a preview is a stylesheet on a
 * real page, so it is covered by the switch as much as a saved one (#121).
 */
async function clearCssPreviewsOn(include: (url: string) => boolean): Promise<void> {
  for (const tabId of await previewedTabIds()) {
    const url = (await browser.tabs.get(tabId).catch(() => undefined))?.url
    if (url && include(url)) await clearPreviewCss(tabId)
  }
}

/**
 * Whether a preview restored from the back-forward cache would be refused as a
 * new preview for the same page: the switches, the excluded list, and the CSS
 * check for the page and its site setting. Approvals given for the original
 * preview are not kept in the archive, so CSS that needs approved addresses is
 * refused here too.
 */
async function restoredPreviewRefused(tabId: number, url: string, css: string): Promise<boolean> {
  try {
    await refuseWhenOff(tabId)
    assertPreviewable(css, await getSettings(), url, undefined)
    return false
  } catch {
    return true
  }
}

/**
 * Throws when the switches say nothing may run on the tab's page, so that a
 * preview is refused instead of being shown on a site the user turned off.
 */
async function refuseWhenOff(tabId: number): Promise<void> {
  if ((await getSettings()).aiJsKillSwitch) {
    throw new Error(
      'Running transforms is switched off in the settings, so the preview was not shown. Turn that setting off to preview.',
    )
  }
  const url = (await browser.tabs.get(tabId).catch(() => undefined))?.url
  if (url) await refuseExcludedUrl(url)
  if (url && (await isUrlOff(url))) {
    throw new Error(
      'Web Alchemist is turned off on this site, so the preview was not shown. Turn it on for this site to preview.',
    )
  }
}

/**
 * Sidebar ports connected to this run of the background page, with the window
 * each one names. A port that names no window maps to undefined.
 */
const sidebarPorts = new Map<browser.runtime.Port, number | undefined>()

/**
 * Whether the sidebar that owns a preview is gone. A port that names no window
 * could own anything, so while one is connected no preview is called
 * abandoned; a preview with no recorded window is abandoned when no sidebar at
 * all is connected.
 */
function ownerIsGone(windowId: number | undefined): boolean {
  const connected = [...sidebarPorts.values()]
  if (connected.includes(undefined)) return false
  if (windowId === undefined) return connected.length === 0
  return !connected.includes(windowId)
}

/**
 * How long a freshly started background page waits for a sidebar to connect
 * before it treats stored previews as abandoned. A sidebar that is still open
 * reconnects within a fraction of a second of the page starting (see
 * sidebar-port.ts in the sidebar); a panel closed during a suspension never
 * does.
 */
export const SIDEBAR_RECONNECT_GRACE_MS = 3000

/**
 * A panel closed while this page was suspended sent no disconnect that anyone
 * received, so its previews are still in the tabs and in storage.session when
 * the page next starts. If no sidebar has connected shortly after start-up, no
 * panel is open to own them, and they are removed.
 */
void (async () => {
  const stored =
    (await previewedTabIds()).length > 0 ||
    (await previewedScriptIds()).length > 0 ||
    (await suspendedTabIds()).length > 0 ||
    (await ownersWithRunTabs()).length > 0
  if (!stored) return
  await new Promise((resolve) => setTimeout(resolve, SIDEBAR_RECONNECT_GRACE_MS))
  await clearPreviewsWhere(ownerIsGone)
  // The picker overlay and the lock outline are in the page, not in storage, so
  // a panel closed during a suspension left them there (#108). A window whose
  // sidebar did not reconnect has no panel to cancel them.
  for (const owner of await ownersWithRunTabs()) {
    if (ownerIsGone(owner)) await clearPageOverlays(owner)
  }
})()

/** Throws the message to show when the address is on the excluded list. */
function withoutFragment(url: string): string {
  const at = url.indexOf('#')
  return at === -1 ? url : url.slice(0, at)
}

async function refuseExcludedUrl(url: string): Promise<void> {
  const host = await excludedHostOf(url)
  if (host !== null) throw new Error(excludedSiteMessage(host))
}

async function refuseExcludedTab(tabId: number): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  if (tab?.url) await refuseExcludedUrl(tab.url)
}

/**
 * Records the tab of a run under its owner, so closing that window's sidebar or
 * that panel tab can clean it. Nothing is recorded when the owner cannot be
 * found, which is a page whose window id the browser did not report and that
 * has no panel tab.
 */
async function recordRunTabOf(tabId: number): Promise<void> {
  const owner = await ownerOfTab(tabId)
  if (owner !== undefined) await recordRunTab(owner, tabId).catch(() => {})
}

/**
 * Removes the picker and the lock outline from the tabs this owner's panel
 * used. Both messages are harmless on a page that has neither.
 */
async function clearPageOverlays(owner: number): Promise<void> {
  for (const tabId of await takeRunTabs(owner)) {
    await sendToContent(tabId, { type: 'cancel-picking' })
    await sendToContent(tabId, { type: 'clear-lock' })
  }
}

const ALL_SITES = { origins: ['<all_urls>'] }

/**
 * Hands the all-sites screenshot grant back. The panel does this itself when a
 * run ends, but a panel that closes mid-run runs no code, and the grant would
 * stay: while it is held, every per-site permission prompt is satisfied
 * without asking. The setting that keeps the grant is honoured.
 */
async function handBackCaptureGrant(): Promise<void> {
  await browser.storage.local.set({ [CAPTURE_GRANT_KEY]: false })
  if ((await getSettings()).keepScreenshotPermission) return
  await browser.permissions.remove(ALL_SITES).catch(() => {})
}

/**
 * After a browser restart the grant is still held, and so is the record that
 * the panel took it for a run (storage.local). Only that record allows the
 * removal: an all-sites grant the user gave outside the panel has no record
 * and is left alone. If a panel reconnects within the grace period a run may
 * be in progress and the grant stays; if none does, nobody is left to use it
 * or give it back.
 */
void (async () => {
  const recorded = (await browser.storage.local.get(CAPTURE_GRANT_KEY))[CAPTURE_GRANT_KEY]
  if (recorded !== true) return
  if (!(await browser.permissions.contains(ALL_SITES))) {
    await browser.storage.local.set({ [CAPTURE_GRANT_KEY]: false })
    return
  }
  if ((await getSettings()).keepScreenshotPermission) return
  await new Promise((resolve) => setTimeout(resolve, SIDEBAR_RECONNECT_GRACE_MS))
  if (sidebarPorts.size > 0) return
  await handBackCaptureGrant()
})()

/**
 * The sidebar holds a port open for exactly as long as it is on screen. Its
 * disconnect is the only reliable signal that the panel closed — which is the
 * moment every preview has to come back out.
 */
browser.runtime.onConnect.addListener((port) => {
  // Both ports start paid model calls or clear previews, so neither is open to
  // a content script. The port is closed so the sender sees a disconnect.
  if (!isExtensionPage(port.sender)) {
    port.disconnect()
    return
  }

  if (isSidebarPortName(port.name)) {
    // The window id for a docked sidebar, or the panel tab's own key for a
    // panel open in a tab.
    const windowId = ownerOfSidebarPort(port.name)
    sidebarPorts.set(port, windowId)
    port.onDisconnect.addListener(() => {
      sidebarPorts.delete(port)
      // The grant is not tied to a window, so it is handed back only when no
      // panel is left that could be in the middle of a run.
      if (sidebarPorts.size === 0) {
        void (async () => {
          const held = (await browser.storage.local.get(CAPTURE_GRANT_KEY))[CAPTURE_GRANT_KEY]
          if (held === true) await handBackCaptureGrant()
        })()
      }
      // Only what this window's sidebar made. Another window's panel may still
      // be open, and its preview must stay: removing every preview whenever the
      // last panel closed was right for one window and wrong for two. While
      // another port for the same window is connected the panel is still open.
      if (windowId === undefined) {
        void clearPreviewsWhere(ownerIsGone)
      } else if (![...sidebarPorts.values()].includes(windowId)) {
        // Exactly this window, not every window whose sidebar is not connected
        // at this moment: right after a start-up the other windows' sidebars
        // have not reconnected yet, and they are still open.
        void clearPreviewsWhere((owner) => owner === windowId)
        void clearPageOverlays(windowId)
      }
    })
    return
  }

  if (port.name === 'wa-generate') {
    /*
     * One controller for the port. The sidebar closing, or the panel dropping
     * the port for any other reason, means nobody can receive the result, and a
     * request left running is still billed. Aborting it stops the HTTP request
     * and, for the streaming call, the stream.
     */
    const controller = new AbortController()
    port.onDisconnect.addListener(() => controller.abort())
    port.onMessage.addListener((message) => {
      void runGeneration(port, message as GenerateOverPort, controller.signal)
    })
  }
})

interface GenerateOverPort {
  context: PageContext
  instruction: string
  /** True when `instruction` is an imported transform's description, unchanged. See GenerateRequest. */
  instructionImported?: boolean
  /** The imported description behind a follow-up. See GenerateRequest. */
  importedDescription?: string
  history: RefinementTurn[]
  scopeDepth?: number
  scopeContainer?: string | null
  /*
   * Only the badge uses this. A sidebar's port sender carries no tab — the
   * panel belongs to a window, not a page — so the tab being worked on has to
   * be stated rather than inferred. Optional because a generation is still
   * valid without a badge to update.
   */
  tabId?: number
  /** The transform being authored or repaired, for attributing cost. */
  transformId?: string
}

/**
 * Generation over a port rather than a one-shot message.
 *
 * The port is how progress is reported: sendMessage is one request and one
 * response, so a panel fed by it can show nothing in between.
 *
 * It is *not* what keeps the background alive. This comment used to claim it
 * was, and the claim was wrong in a way that cost a whole class of requests:
 * Firefox exempts only native messaging ports from idle suspension, so an
 * extension-to-extension port is suspended on schedule no matter how much
 * traffic crosses it — and until the model's first output token, no traffic
 * crosses it at all. That is withKeepalive's job; see keepalive.ts.
 */
async function runGeneration(
  port: browser.runtime.Port,
  request: GenerateOverPort,
  signal: AbortSignal,
): Promise<void> {
  const { tabId } = request
  // Before the badge changes and before anything is sent to a provider.
  try {
    await requireNormalWindow(tabId)
  } catch (error) {
    port.postMessage({ type: 'error', error: { message: (error as Error).message } })
    return
  }
  const accent = (await getSettings()).accent

  /*
   * Every message to the panel goes through here. After the port disconnects
   * postMessage throws, and a chunk arriving then would end the stream as a
   * side effect of the exception; the `catch` below would then call it again
   * and the second throw became an unhandled rejection, since this function is
   * started with `void`. A message nobody can receive is dropped instead.
   */
  const post = (message: unknown): void => {
    if (signal.aborted) return
    try {
      port.postMessage(message)
    } catch {
      // The port closed between the check and the call.
    }
  }

  if (tabId !== undefined) {
    await restoreBadgeFacts(tabId, accent)
    await badge.generationStarted(tabId, accent)
  }
  const usage = createUsageRecorder(request.transformId)

  try {
    await refuseExcludedUrl(request.context.url)
    if (signal.aborted) return
    const provider = await resolveActiveProvider(usage.listener)
    if (signal.aborted) return
    post({ type: 'sent' })

    const withSignal = { ...request, signal }
    const result = await withKeepalive(() =>
      provider.generateStream
        ? provider.generateStream(
            withSignal,
            (accumulated) => {
              post({ type: 'chunk', text: accumulated })
            },
            (characters) => {
              post({ type: 'thinking', characters })
            },
          )
        : provider.generate(withSignal),
    )

    post({ type: 'done', result, usage: await usage.settled() })
  } catch (error) {
    // An aborted request fails with an error about the abort; the panel that
    // would show it is gone.
    post({
      type: 'error',
      error:
        error instanceof ProviderError
          ? {
              message: error.message,
              kind: error.kind,
              retryable: error.retryable,
              ...(error.retryInSeconds === undefined
                ? {}
                : { retryInSeconds: error.retryInSeconds }),
            }
          : { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    // A call that was billed and then failed to parse is still counted. After
    // `done` this has nothing left to wait for.
    await usage.settled()
    // In `finally` so a failed generation does not leave the tab showing `··`
    // for as long as the tab is open.
    if (tabId !== undefined) {
      await restoreBadgeFacts(tabId, accent)
      await badge.generationEnded(tabId, accent)
    }
  }
}

/**
 * Repaints the tabs that match one of `patterns` and that the badge knows
 * nothing about, after a save or a delete.
 *
 * `badge.transformEdited` removes the edited transform from the broken set of
 * every tab it has facts for, and a suspension empties those facts while the
 * "!" Firefox drew stays on the tab. The edit would then leave "!" on every
 * tab except the one the edit was made from. Asking the browser which tabs
 * match recovers the tabs the in-memory facts have forgotten. Both the old and
 * the new pattern are used, since an edit can move a transform off a tab.
 * Tabs the badge does have facts for were already updated.
 */
async function repaintOtherTabs(
  patterns: (string | undefined)[],
  accent: Accent,
): Promise<void> {
  const wanted = patterns.filter((p): p is string => !!p)
  if (wanted.length === 0) return
  for (const tab of await browser.tabs.query({})) {
    if (tab.id === undefined || !tab.url) continue
    const url = tab.url
    if (!wanted.some((pattern) => matchesUrl(pattern, url))) continue
    await restoreBadgeFacts(tab.id, accent)
  }
}

/**
 * Rebuilds the matching count for a tab the badge knows nothing about.
 *
 * The badge's facts are in memory and a suspension erases them, while the badge
 * Firefox draws survives. A generation that starts after a suspension would
 * otherwise get a fresh entry with a count of zero, and when it ended the badge
 * was repainted from that entry and cleared on a page that still has
 * transforms. Recounting from the tab's URL is cheap and gives the right count;
 * persisting every tab's facts in `storage.session` was the other option and
 * was not taken because the broken set would still be unknown after a
 * suspension, so the extra storage would not make the badge complete.
 *
 * Called at the end as well as the start, in case a suspension falls between
 * them.
 */
async function restoreBadgeFacts(tabId: number, accent: Accent): Promise<void> {
  if (badge.hasFacts(tabId)) return
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  const transforms = tab?.url ? await inTabContainer(tabId, await transformsForUrl(tab.url)) : []
  await badge.transformCountChanged(
    tabId,
    transforms.map((t) => t.id),
    accent,
  )
}

browser.tabs.onRemoved.addListener(async (tabId) => {
  badge.tabClosed(tabId)
  await inTabQueue(tabId, async () => {
    await forgetCss('preview', tabId)
    await forgetCss('applied', tabId)
    forgetTab(tabId)
    await forgetArchive(tabId)
    await browser.storage.session.remove(`wa-last-url-${tabId}`)
    await forgetSuspended(tabId)
    // A closed panel tab no longer owns the page it was bound to.
    await browser.storage.session.remove(panelPageKey(tabId))
  })
  evaluations.delete(tabId)
})

/* ------------------------------------------------------------------ */
/* Safety pipeline                                                     */
/* ------------------------------------------------------------------ */

/**
 * Runs the three checks in cost order: deterministic first, model last.
 *
 * The model review is skipped entirely when static analysis has already found
 * something blocking — there is nothing to learn from a second opinion on code
 * that is already rejected, and the call is not free.
 */
async function runReview(
  code: string,
  intent: string,
  intentEditedByUser: boolean,
  instructions: ReviewInstruction[],
  declared: Transform['capabilities'],
  transformId?: string,
  intentImported = false,
): Promise<ReviewResult> {
  const analysis = runStaticAnalysis(code, declared)
  if (!analysis.passed) return analysis

  const usage = createUsageRecorder(transformId)
  const provider = await resolveActiveProvider(usage.listener)
  // No page content crosses into this call. That is the entire basis of the
  // reviewer's independence — see REVIEW_SYSTEM_PROMPT.
  //
  // This one does not stream, so it is silent for its whole duration, and it
  // arrives over sendMessage rather than a port — a pending listener promise
  // resets the idle timer exactly once, giving it 60 seconds before the page
  // is suspended and the caller is told the receiving end does not exist.
  let model: ModelReview
  try {
    model = await withKeepalive(() => provider.review({ code, intent, intentEditedByUser, intentImported, instructions }))
  } finally {
    // In `finally` so a billed response that failed to parse is still counted.
    await usage.settled()
  }

  const report = await usage.settled()
  return {
    ...analysis,
    model,
    passed: model.verdict === 'match',
    ...(report ? { usage: report } : {}),
  }
}

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */

/**
 * Everything saved for this page, enabled or not.
 *
 * The list needs the disabled ones — they are what the toggles turn back on.
 * Filtering them out here made a transform vanish from the panel the moment
 * it was switched off, which looked like it had been deleted.
 */
async function matchingTransforms(url: string): Promise<Transform[]> {
  const all = await getAllTransforms()
  return all.filter((t) => matchesUrl(t.match, url))
}

/** The subset that should actually run. */
async function transformsForUrl(url: string): Promise<Transform[]> {
  // Nothing runs while the kill switch is on, the site is turned off or the
  // site is on the excluded list (#131), so nothing is applied, counted on the
  // badge or health-checked.
  if (
    (await getSettings()).aiJsKillSwitch ||
    (await isUrlOff(url)) ||
    (await excludedHostOf(url)) !== null
  ) {
    return []
  }
  return (await matchingTransforms(url)).filter((t) => t.enabled)
}

/**
 * What follows a settings write that may have changed the kill switch. The
 * switch changes which scripts may run, so registrations are rebuilt. When it
 * changed, CSS is also taken out of (or put back into) the open tabs.
 * Unregistering a script does not undo code that already ran in an open tab, so
 * those tabs are not touched here: the page that changed the setting asks for
 * their number with count-js-tabs and tells the user to reload them. They are
 * not reloaded, because that would discard unsaved text on every open site
 * because of one setting.
 */
async function afterSettingsWritten(switchBefore: boolean): Promise<void> {
  await reregister()
  const switchNow = (await getSettings()).aiJsKillSwitch
  if (switchNow && !switchBefore) await clearCssPreviewsOn(() => true)
  if (switchNow !== switchBefore) await reapplyOpenTabs(() => true)
}

/** Reapplies CSS and the badge in every open tab whose address passes `include`. */
async function reapplyOpenTabs(include: (url: string) => boolean): Promise<void> {
  for (const tab of await browser.tabs.query({})) {
    if (tab.id === undefined || !tab.url || !include(tab.url)) continue
    await reapply(tab.id)
  }
}

/**
 * Open tabs, whose address passes `include`, that match an enabled JavaScript
 * transform and so may have run it. The browser does not report which tabs ran
 * a script, so this is the set a registered script would have run in.
 */
async function tabsWithJavaScript(include: (url: string) => boolean): Promise<number[]> {
  const scripts = (await getAllTransforms()).filter((t) => t.kind === 'js' && t.enabled && t.code)
  const ids: number[] = []
  for (const tab of await browser.tabs.query({})) {
    if (tab.id === undefined || !tab.url || !include(tab.url)) continue
    const url = tab.url
    if (scripts.some((t) => matchesUrl(t.match, url))) ids.push(tab.id)
  }
  return ids
}

async function countTabsWithJavaScript(include: (url: string) => boolean): Promise<number> {
  return (await tabsWithJavaScript(include)).length
}

/**
 * The transforms whose CSS belongs in the tab right now: the enabled ones for
 * the URL, without the one the sidebar has paused for an edit preview.
 */
async function cssTransformsFor(tabId: number, url: string): Promise<Transform[]> {
  const [all, suspended] = await Promise.all([transformsForUrl(url), readSuspended(tabId)])
  return suspended === undefined ? all : all.filter((t) => t.id !== suspended)
}

/**
 * Leaves out the CSS transforms restricted to a container other than the
 * tab's. JavaScript transforms are kept, because a user script registration
 * cannot be limited to a container (see shared/container.ts). The CSS apply
 * path filters by container itself in handlers.ts; this is for the badge and
 * the health check.
 */
async function inTabContainer(tabId: number, transforms: Transform[]): Promise<Transform[]> {
  if (!transforms.some((t) => t.kind === 'css' && t.cookieStoreId !== undefined)) return transforms
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  return transforms.filter((t) => t.kind !== 'css' || appliesInContainer(t, tab?.cookieStoreId))
}

/**
 * CSS is applied by the background script rather than the content script:
 * insertCSS at the USER origin needs no page-side code, survives re-renders
 * without observers, and cannot be tampered with from the page. The logic,
 * including the check of stored CSS, is in handlers.ts so it can be tested.
 */
function applyCssTransforms(
  tabId: number,
  load: () => Promise<Transform[]>,
  /** The URL the transforms are being chosen for. */
  url: string,
): Promise<void> {
  // Taken now, not when the task runs: a document that commits while this is
  // queued makes it out of date.
  const document = documentOf(tabId)
  return inTabQueue(tabId, async () => {
    if (documentOf(tabId) !== document) return
    // Read inside the queue. A list read before waiting would be older than the
    // task ahead of this one, and a save finishing in between would be undone.
    await applyCss(tabId, await load(), { document, url })
  })
}

/**
 * Whether the tab still shows the document and URL the CSS was chosen for.
 *
 * The task checks the document when it starts, and then waits on storage and
 * on removing the previous stylesheet. A tab that navigates during those waits
 * would receive the stylesheet chosen for the page it left, because insertCSS
 * targets the whole tab. Checked again immediately before the insert, by the
 * counter that moves when a document commits and by the URL the browser reports
 * for the tab, which also catches a navigation whose commit event has not
 * reached this page yet. insertCSS in Firefox accepts no document id, so this
 * narrows the window and does not close it: one await remains between this
 * check and the insert.
 */
async function tabStillShows(
  tabId: number,
  expected: { document: number; url: string },
): Promise<boolean> {
  if (documentOf(tabId) !== expected.document) return false
  const current = (await browser.tabs.get(tabId).catch(() => undefined))?.url
  // A tab whose URL cannot be read is one the extension has no access to, and
  // the insert fails there anyway.
  if (current !== undefined && current !== expected.url) {
    // Not compared as strings: a page that sets location.hash while it loads
    // reports a URL with a fragment that the commit event did not have, and
    // skipping the insert there left the page with no CSS (#57). The CSS is
    // still right when the same transforms match both URLs and the CSS is
    // filtered the same way for both: the filter depends on the site's CSS
    // setting and on the origin, so a move to another origin is not the same page.
    const all = await getAllTransforms()
    const same = all.every(
      (t) => matchesUrl(t.match, current) === matchesUrl(t.match, expected.url),
    )
    if (!same) return false
    if (!sameCssContext(await getSettings(), current, expected.url)) return false
  }
  return documentOf(tabId) === expected.document
}

/**
 * Applies the CSS through the shared handler, which checks every stored
 * stylesheet before it is inserted. `tabStillShows` is passed as the last check
 * before the insert, so a tab that navigated during the waits gets nothing.
 */
async function applyCss(
  tabId: number,
  transforms: Transform[],
  expected: { document: number; url: string },
): Promise<void> {
  await applyCssTransformsFor(cssApplyDeps, tabId, transforms, expected.url, () =>
    tabStillShows(tabId, expected),
  )
}

const cssApplyDeps: CssApplyDeps = {
  getSettings,
  insertCss: (tabId, css) => browser.scripting.insertCSS({ target: { tabId }, css, origin: 'USER' }),
  removeCss: (tabId, css) => browser.scripting.removeCSS({ target: { tabId }, css, origin: 'USER' }),
  tabCookieStore: async (tabId) => (await browser.tabs.get(tabId).catch(() => undefined))?.cookieStoreId,
  // Read from storage.session: see css-state.ts for why a module variable is not enough.
  applied: {
    read: (tabId) => readCss('applied', tabId),
    write: (tabId, css) => writeCss('applied', tabId, css),
    forget: (tabId) => forgetCss('applied', tabId),
  },
}

/** Recomputes and applies whatever should be running in this tab right now. */
async function reapply(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  if (!tab?.url) return
  const url = tab.url
  await applyCssTransforms(tabId, () => cssTransformsFor(tabId, url), url)
  const transforms = await inTabContainer(tabId, await transformsForUrl(url))

  // Every mutation that changes what runs — save, delete, reorder, toggle —
  // reaches here, which is why the count is refreshed here rather than at each
  // of the four call sites.
  const settings = await getSettings()
  await badge.transformCountChanged(
    tabId,
    transforms.map((t) => t.id),
    settings.accent,
  )
}

/** Recomputes what runs in every open tab, for a change that is not tied to one transform. */
async function reapplyAllTabs(): Promise<void> {
  for (const tab of await browser.tabs.query({})) await reapply(tab.id)
}

/** The URL of a tab, or undefined when there is no such tab or it has no URL. */
async function tabUrlOf(tabId: number | undefined): Promise<string | undefined> {
  if (tabId === undefined) return undefined
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  return tab?.url
}

const saveDeps: SaveDeps = {
  getAllTransforms,
  getSettings,
  tabUrl: tabUrlOf,
  assertValidTransform,
  saveTransform,
  // Queued with the rebuild so a rebuild between the save and the
  // registration cannot read the old script from storage (#91).
  registerTransform: (transform) => inRegistryQueue(() => registerTransform(transform)),
  transformEdited: async (id) => badge.transformEdited(id, (await getSettings()).accent),
  afterSave: async (saved, before) => {
    const { accent } = await getSettings()
    await repaintOtherTabs([saved.match, before?.match], accent)
    // After a repair the next load has to check again, even in once-per-session mode.
    await forgetSessionChecksFor(saved.id)
  },
  reapply,
}

/* ------------------------------------------------------------------ */
/* Screenshots                                                         */
/* ------------------------------------------------------------------ */

/**
 * The toolbar-click handshake.
 *
 * captureVisibleTab requires `hasPermission("<all_urls>")` or an activeTab
 * grant. The first is unreachable in MV3 — hasPermission is a literal lookup
 * in the permission set, and granted host patterns live in allowedOrigins,
 * never in that set — and the second is only ever produced by a browser-action
 * click (ext-browserAction.js), never by anything in the sidebar. So the panel
 * arms a capture, asks for one click, and this runs while the grant is live.
 *
 * Holding the image here rather than handing it straight to the panel keeps it
 * out of storage and out of the panel's state until a request actually wants
 * it, and lets the tab own its lifetime.
 */
/**
 * Captures with the target outline taken down.
 *
 * The outline is a real element in the page, so capturing with it up puts our
 * own highlight into the image the model is asked to read — drawn over the very
 * thing being described. Down for the shot, back up after, rebuilt rather than
 * restored so the boxes return where the elements are now.
 */
async function captureWithLockDown(
  tabId: number,
  rect: Rect,
  viewportWidth: number,
  url: string,
  scrolledTo?: ScrollOffset,
  devicePixelRatio?: number,
): Promise<{ dataUrl: string; rect: Rect; clipped: boolean; moved: boolean }> {
  /*
   * A rectangle stored from a pick is in viewport coordinates, so it is moved
   * by however far the page has scrolled since. Asked of the page, because
   * the background cannot read it. Without a reply the rectangle is used as
   * it is, which is what happened before and is right when nothing scrolled.
   */
  let target = rect
  let moveClipped = false
  let pageScrolled = false
  // The width the rectangle is scaled by when the capture is cropped.
  let width = viewportWidth
  if (scrolledTo) {
    const now = (await askContent(tabId, { type: 'get-viewport' })) as Viewport | undefined
    if (now) {
      if (viewportChanged({ width: viewportWidth, devicePixelRatio }, now)) {
        throw new Error(
          'The window size or zoom changed after you drew the area, so it no longer matches the page. Draw the area again.',
        )
      }
      width = now.width
      const moved = regionAtScroll(rect, scrolledTo, now)
      if (!moved) {
        throw new Error(
          'The area you drew is no longer on screen. Scroll it back into view, or draw it again.',
        )
      }
      target = moved.rect
      moveClipped = moved.clipped
      pageScrolled = now.x !== scrolledTo.x || now.y !== scrolledTo.y
    }
  }
  await sendToContent(tabId, { type: 'set-lock-visible', visible: false })
  try {
    const shot = await captureRegion(tabId, url, target, width)
    return { ...shot, clipped: shot.clipped || moveClipped, rect: target, moved: pageScrolled }
  } finally {
    await sendToContent(tabId, { type: 'set-lock-visible', visible: true })
  }
}

/** True when both addresses have the same origin and path. */
function samePage(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false
  try {
    const x = new URL(a)
    const y = new URL(b)
    return x.origin === y.origin && x.pathname === y.pathname
  } catch {
    return a === b
  }
}

async function captureRegion(
  tabId: number,
  url: string,
  rect: Rect,
  viewportWidth: number,
): Promise<{ dataUrl: string; clipped: boolean }> {
  // captureVisibleTab photographs whichever tab is active in a window, which
  // after the user switches tabs is not the run's tab, and can be a different
  // site they are signed in to. It is read again here, just before the call,
  // rather than once when the request arrived.
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  if (!tab || tab.windowId === undefined) {
    throw new Error('The page this run is about is no longer open, so nothing was captured.')
  }
  if (!tab.active) {
    throw new Error(
      'The page this run is about is not the tab in front, so nothing was captured. Switch back to it and try again.',
    )
  }
  // Origin and path, not the whole address: a page that changes its fragment or
  // query while it is in use (scroll-spy navigation, a video player writing the
  // playback time) is still the same page, and comparing the whole address
  // refused every capture on such pages.
  if (!samePage(tab.url, url)) {
    throw new Error(
      'The page this run is about has moved to another address, so nothing was captured.',
    )
  }
  const full = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' })

  // The tab can change while the capture runs. The image is dropped if it no
  // longer shows the page this run is about.
  const after = await browser.tabs.get(tabId).catch(() => undefined)
  if (!after?.active || !samePage(after.url, url)) {
    throw new Error(
      'The tab changed while the screenshot was being taken, so the image was discarded. Try again.',
    )
  }

  // Cropping happens here so the full-viewport capture never leaves this scope.
  const blob = await (await fetch(full)).blob()
  const bitmap = await createImageBitmap(blob)

  // The capture comes back in device pixels; the rectangle was measured in CSS
  // pixels. On a HiDPI display those differ, and cropping without the
  // correction silently returns the wrong part of the page.
  const scale = bitmap.width / Math.max(1, viewportWidth)

  // captureVisibleTab only sees the viewport, so a region taller or wider than
  // it comes back cut. Clamp to what actually exists and say that we did,
  // rather than drawing past the edge and sending transparent padding.
  const source = {
    x: Math.max(0, rect.x * scale),
    y: Math.max(0, rect.y * scale),
    width: rect.width * scale,
    height: rect.height * scale,
  }
  const width = Math.min(source.width, bitmap.width - source.x)
  const height = Math.min(source.height, bitmap.height - source.y)
  const clipped = width < source.width - 1 || height < source.height - 1

  const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not prepare the image.')
  context.drawImage(bitmap, source.x, source.y, width, height, 0, 0, width, height)
  const cropped = await canvas.convertToBlob({ type: 'image/png' })

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the image.'))
    reader.readAsDataURL(cropped)
  })

  return { dataUrl, clipped }
}

/** Same as sendToContent, but keeps the content script's reply. */
async function askContent(tabId: number, message: ContentMessage): Promise<unknown> {
  try {
    return await browser.tabs.sendMessage(tabId, message)
  } catch {
    return undefined
  }
}

async function sendToContent(tabId: number, message: ContentMessage): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, message)
  } catch {
    // No content script in that tab, which is normal — it is only injected
    // under activeTab or on origins the user has granted.
  }
}

/** Exposed for tests and for the sidebar's manual health-check action. */
export { transformsForUrl, runReview }

// Registration state can drift if the browser restarted with stale scripts,
// or if a permission changed while the background script was not alive.
void (async () => {
  // Runs once, and before the rebuild, for an install that never saw an
  // update event with the migration in it.
  await migrateModelChosenWorlds()
  if (await hasUserScriptsPermission()) await reregister()
  await reconcileContentScripts()
})()
