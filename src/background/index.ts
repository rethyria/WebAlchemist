/**
 * Background script. Owns credentials, provider calls, persistence, script
 * registration, and the safety pipeline.
 *
 * Nothing here hands a credential to another context. The sidebar and content
 * script talk to this module; only this module talks to a provider.
 */

import { analyseJavaScript, applyCapabilityPolicy } from '@safety/static-analysis'
import type {
  ContentEvent,
  ContentMessage,
  Message,
  MessageResponse,
} from '@shared/messages'
import { matchesUrl } from '@shared/match'
import type {
  PageContext,
  Rect,
  ReviewResult,
  Transform,
} from '@shared/types'
import type { RefinementTurn } from './providers/types'
import { overlayPaletteFor } from '@shared/accents'
import { reconcile as reconcileContentScripts } from './content-scripts'
import { buildProbeTransform } from './csp-probe'
import { forgetSession, runHealthCheck, shouldCheck } from './health'
import { resolveActiveProvider, ProviderError } from './providers'
import {
  hasUserScriptsPermission,
  registerTransform,
  reregisterAll,
  unregisterTransform,
} from './registry'
import {
  clearCredential,
  deleteTransform,
  exportTransforms,
  getAllCredentialStatuses,
  getAllTransforms,
  getSettings,
  importTransforms,
  reorderTransforms,
  saveSettings,
  saveTransform,
  setCredential,
} from './storage'

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

browser.runtime.onInstalled.addListener(async (details) => {
  // The platform wipes every userScripts registration on update, and drops
  // dynamic content scripts too. Without this, transforms silently stop
  // working after an extension update — with no error, which is the worst
  // possible failure mode.
  if (details.reason === 'update' || details.reason === 'install') {
    await reregisterAll()
    await reconcileContentScripts()
  }
})

/*
 * Both directions matter. Firefox drops user script registrations when the
 * permission is revoked and does not restore them when it is granted again;
 * content script registration has to follow the set of origins we hold, which
 * changes in both directions from about:addons as well as from our own
 * request at save time.
 */
browser.permissions.onAdded.addListener(async (permissions) => {
  const granted = permissions.permissions as string[] | undefined
  if (granted?.includes('userScripts')) await reregisterAll()
  await reconcileContentScripts()
})

browser.permissions.onRemoved.addListener(async () => {
  await reconcileContentScripts()
})

/** Clicking the toolbar button opens the sidebar rather than a popup. */
browser.action.onClicked.addListener(() => {
  void browser.sidebarAction.open()
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
})

browser.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return
  const transforms = await transformsForUrl(details.url)
  if (transforms.length === 0) return

  await applyCssTransforms(details.tabId, transforms)

  const settings = await getSettings()
  if (!shouldCheck(settings, details.url)) return

  // Deliberately not awaited alongside the CSS application: the check waits up
  // to three seconds for a slow page to settle, and CSS must not queue behind
  // it. A visible delay before the page restyles would be a worse bug than a
  // late health result.
  void checkAndPublish(details.tabId, transforms)
})

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
  return (
    message.type === 'element-hovered' ||
    message.type === 'element-picked' ||
    message.type === 'picking-cancelled' ||
    message.type === 'health-check-result'
  )
}

browser.runtime.onMessage.addListener(
  (
    message: Message | ContentEvent,
    sender,
  ): Promise<MessageResponse<unknown>> | undefined => {
    if (isContentEvent(message)) return undefined

    return handle(message, sender).then(
      (data) => ({ ok: true, data }),
      (error: unknown) => ({
        ok: false,
        error:
          error instanceof ProviderError
            ? { message: error.message, kind: error.kind, retryable: error.retryable }
            : { message: error instanceof Error ? error.message : String(error) },
      }),
    )
  },
)

async function handle(
  message: Message,
  sender: browser.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'get-settings':
      return getSettings()

    case 'get-transforms-for-url':
      return transformsForUrl(message.url)

    case 'get-credential-statuses':
      return getAllCredentialStatuses()

    case 'get-vision-support': {
      const provider = await resolveActiveProvider()
      return provider.supportsVision()
    }

    case 'generate': {
      const provider = await resolveActiveProvider()
      return provider.generate({
        context: message.context,
        instruction: message.instruction,
        history: message.history,
      })
    }

    case 'repair': {
      const transforms = await getAllTransforms()
      const existing = transforms.find((t) => t.id === message.transformId)
      if (!existing) throw new Error('That transform no longer exists.')

      const provider = await resolveActiveProvider()
      return provider.generate({
        context: message.context,
        instruction: existing.intent,
        history: [],
        repair: {
          intent: existing.intent,
          previousCode: existing.code,
          previousRationale: existing.rationale,
          brokenReason: message.brokenReason,
        },
      })
    }

    case 'review':
      return runReview(message.code, message.intent, message.declaredCapabilities)

    case 'analyse':
      return runStaticAnalysis(message.code, message.declaredCapabilities)

    case 'save-transform': {
      await saveTransform(message.transform)
      if (message.transform.kind === 'js') {
        await registerTransform(message.transform)
      }
      return true
    }

    case 'delete-transform':
      await unregisterTransform(message.id)
      await deleteTransform(message.id)
      return true

    case 'reorder-transforms':
      await reorderTransforms(message.orderedIds)
      return true

    case 'set-enabled': {
      const all = await getAllTransforms()
      const target = all.find((t) => t.id === message.id)
      if (!target) throw new Error('That transform no longer exists.')
      const next = { ...target, enabled: message.enabled }
      await saveTransform(next)
      if (next.kind === 'js') {
        if (next.enabled) await registerTransform(next)
        else await unregisterTransform(next.id)
      }
      return true
    }

    case 'save-settings':
      await saveSettings(message.settings)
      // The kill switch changes which scripts may run.
      await reregisterAll()
      return true

    case 'set-credential':
      await setCredential(message.providerId, message.credential)
      return true

    case 'clear-credential':
      await clearCredential(message.providerId)
      return true

    case 'preview-css':
      await setPreviewCss(message.tabId, message.css)
      return true

    case 'clear-preview-css':
      await setPreviewCss(message.tabId, null)
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
      await registerTransform(message.transform)
      previewedScripts.add(message.transform.id)
      await browser.tabs.reload(message.tabId)
      return true
    }

    case 'clear-preview-js':
      await unregisterTransform(message.id)
      previewedScripts.delete(message.id)
      return true

    case 'start-picking': {
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
      })
      return true
    }

    case 'stop-picking':
      await sendToContent(message.tabId, { type: 'cancel-picking' })
      return true

    case 'retarget':
      await sendToContent(message.tabId, {
        type: 'retarget',
        levelsUp: message.levelsUp,
      })
      return true

    case 'highlight-ancestor':
      await sendToContent(message.tabId, {
        type: 'highlight-ancestor',
        levelsUp: message.levelsUp,
      })
      return true

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

    case 'run-csp-probe': {
      // Registered, never saved. It must not appear in the user's transform
      // list, and it must come back out when the run is over.
      await registerTransform(buildProbeTransform())
      await browser.tabs.update(message.tabId, { url: 'http://localhost:8787/' })
      return true
    }

    case 'clear-csp-probe':
      await unregisterTransform('wa-csp-probe')
      return true

    case 'check-now': {
      // A manual check must actually run, even under once-per-session where
      // this host has already been seen.
      forgetSession(message.url)
      const transforms = await transformsForUrl(message.url)
      return (await runHealthCheck(message.tabId, transforms)) ?? []
    }

    case 'capture-region':
      return captureRegion(message.rect, message.viewportWidth)

    case 'export-transforms':
      return exportTransforms()

    case 'import-transforms': {
      const result = await importTransforms(
        message.bundle as Awaited<ReturnType<typeof exportTransforms>>,
      )
      await reregisterAll()
      return result
    }
  }
}

/**
 * Runs a check and forwards the result to an open sidebar.
 *
 * Nothing is persisted. Broken-ness is a fact about the page as it is right
 * now, not a property of the transform — storing it would mean showing a stale
 * warning about a site that has since been fixed.
 */
async function checkAndPublish(tabId: number, transforms: Transform[]): Promise<void> {
  const states = await runHealthCheck(tabId, transforms)
  if (!states) return
  await browser.runtime
    .sendMessage({ type: 'health-check-result', states })
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
 * the only way to take a preview back out is to have kept what went in.
 */
const previewedCss = new Map<number, string>()
const previewedScripts = new Set<string>()

async function setPreviewCss(tabId: number, css: string | null): Promise<void> {
  const existing = previewedCss.get(tabId)
  if (existing) {
    await browser.scripting
      .removeCSS({ target: { tabId }, css: existing, origin: 'USER' })
      .catch(() => {})
    previewedCss.delete(tabId)
  }
  if (css === null) return

  await browser.scripting.insertCSS({ target: { tabId }, css, origin: 'USER' })
  previewedCss.set(tabId, css)
}

async function clearAllPreviews(): Promise<void> {
  for (const tabId of [...previewedCss.keys()]) {
    await setPreviewCss(tabId, null)
  }
  for (const id of [...previewedScripts]) {
    await unregisterTransform(id)
    previewedScripts.delete(id)
  }
}

/**
 * The sidebar holds a port open for exactly as long as it is on screen. Its
 * disconnect is the only reliable signal that the panel closed — which is the
 * moment every preview has to come back out.
 */
browser.runtime.onConnect.addListener((port) => {
  if (port.name === 'wa-sidebar') {
    port.onDisconnect.addListener(() => {
      void clearAllPreviews()
    })
    return
  }

  if (port.name === 'wa-generate') {
    port.onMessage.addListener((message) => {
      void runGeneration(port, message as GenerateOverPort)
    })
  }
})

interface GenerateOverPort {
  context: PageContext
  instruction: string
  history: RefinementTurn[]
  scopeDepth?: number
  scopeContainer?: string | null
}

/**
 * Generation over a port rather than a one-shot message.
 *
 * Two reasons, and the second is the one that was breaking things:
 *
 *   1. It is the only way to report progress. sendMessage is one request and
 *      one response, so a panel fed by it can show nothing between them.
 *   2. A connected port keeps the background alive. MV3 makes the background a
 *      non-persistent event page, and Firefox will suspend it underneath a
 *      long-running fetch — which appeared as "Could not establish connection.
 *      Receiving end does not exist." after a long wait, with the request
 *      already paid for.
 */
async function runGeneration(
  port: browser.runtime.Port,
  request: GenerateOverPort,
): Promise<void> {
  try {
    const provider = await resolveActiveProvider()
    port.postMessage({ type: 'sent' })

    const result = provider.generateStream
      ? await provider.generateStream(request, (accumulated) => {
          port.postMessage({ type: 'chunk', text: accumulated })
        })
      : await provider.generate(request)

    port.postMessage({ type: 'done', result })
  } catch (error) {
    port.postMessage({
      type: 'error',
      error:
        error instanceof ProviderError
          ? { message: error.message, kind: error.kind, retryable: error.retryable }
          : { message: error instanceof Error ? error.message : String(error) },
    })
  }
}

browser.tabs.onRemoved.addListener((tabId) => {
  previewedCss.delete(tabId)
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
/**
 * The deterministic half, on its own. Separated because it is free and local,
 * which is what lets it gate the preview — the model review costs a call and
 * only happens once, at approval.
 */
function runStaticAnalysis(
  code: string,
  declared: Transform['capabilities'],
): ReviewResult {
  const outcome = analyseJavaScript(code)
  const { findings, undeclared } = applyCapabilityPolicy(outcome, declared)
  return {
    static: findings,
    undeclaredCapabilities: undeclared,
    passed: !findings.some((f) => f.severity === 'block'),
  }
}

async function runReview(
  code: string,
  intent: string,
  declared: Transform['capabilities'],
): Promise<ReviewResult> {
  const analysis = runStaticAnalysis(code, declared)
  if (!analysis.passed) return analysis

  const provider = await resolveActiveProvider()
  // No page content crosses into this call. That is the entire basis of the
  // reviewer's independence — see REVIEW_SYSTEM_PROMPT.
  const model = await provider.review({ code, intent })

  return { ...analysis, model, passed: model.verdict === 'match' }
}

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */

async function transformsForUrl(url: string): Promise<Transform[]> {
  const all = await getAllTransforms()
  return all.filter((t) => t.enabled && matchesUrl(t.match, url))
}

/**
 * CSS is applied by the background script rather than the content script:
 * insertCSS at the USER origin needs no page-side code, survives re-renders
 * without observers, and cannot be tampered with from the page.
 */
async function applyCssTransforms(tabId: number, transforms: Transform[]): Promise<void> {
  const css = transforms
    .filter((t) => t.kind === 'css')
    .sort((a, b) => a.order - b.order)
    .map((t) => `/* ${t.name} */\n${t.code}`)
    .join('\n\n')

  if (!css) return

  try {
    await browser.scripting.insertCSS({ target: { tabId }, css, origin: 'USER' })
  } catch {
    // No host permission for this origin yet, which is expected until the user
    // saves their first transform for the site.
  }
}

async function captureRegion(
  rect: Rect,
  viewportWidth: number,
): Promise<{ dataUrl: string; clipped: boolean }> {
  const full = await browser.tabs.captureVisibleTab({ format: 'png' })

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
  if (await hasUserScriptsPermission()) await reregisterAll()
  await reconcileContentScripts()
})()
