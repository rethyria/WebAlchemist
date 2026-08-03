/**
 * Background script. Owns credentials, provider calls, persistence, script
 * registration, and the safety pipeline.
 *
 * Nothing here hands a credential to another context. The sidebar and content
 * script talk to this module; only this module talks to a provider.
 */

import { analyseJavaScript, applyCapabilityPolicy } from '@safety/static-analysis'
import type { ContentMessage, Message, MessageResponse } from '@shared/messages'
import { matchesUrl } from '@shared/match'
import type { GenerationResult, ReviewResult, Transform } from '@shared/types'
import { resolveActiveProvider, ProviderError } from './providers'
import {
  hasUserScriptsPermission,
  registerTransform,
  requestUserScriptsPermission,
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
  // The platform wipes every userScripts registration on update. Without this,
  // JS transforms silently stop working after an extension update.
  if (details.reason === 'update' || details.reason === 'install') {
    await reregisterAll()
  }
})

// Firefox drops registrations when the permission is revoked and does not
// restore them when it is granted again.
browser.permissions.onAdded.addListener(async (permissions) => {
  const granted = permissions.permissions as string[] | undefined
  if (granted?.includes('userScripts')) await reregisterAll()
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
})

/* ------------------------------------------------------------------ */
/* Message routing                                                     */
/* ------------------------------------------------------------------ */

browser.runtime.onMessage.addListener(
  (message: Message, sender): Promise<MessageResponse<unknown>> =>
    handle(message, sender).then(
      (data) => ({ ok: true, data }),
      (error: unknown) => ({
        ok: false,
        error:
          error instanceof ProviderError
            ? { message: error.message, kind: error.kind, retryable: error.retryable }
            : { message: error instanceof Error ? error.message : String(error) },
      }),
    ),
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

    case 'request-origin-permission':
      return browser.permissions.request({ origins: [message.origin] })

    case 'request-userscripts-permission': {
      const granted = await requestUserScriptsPermission()
      if (granted) await reregisterAll()
      return granted
    }

    case 'preview-css':
      await browser.scripting.insertCSS({
        target: { tabId: message.tabId },
        css: message.css,
        origin: 'USER',
      })
      return true

    case 'clear-preview-css':
      await browser.scripting.removeCSS({
        target: { tabId: message.tabId },
        css: message.css,
        origin: 'USER',
      })
      return true

    case 'capture-region':
      return captureRegion(sender.tab?.id, message.rect)

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
  declared: Transform['capabilities'],
): Promise<ReviewResult> {
  const outcome = analyseJavaScript(code)
  const { findings, undeclared } = applyCapabilityPolicy(outcome, declared)
  const blocked = findings.some((f) => f.severity === 'block')

  if (blocked) {
    return { static: findings, undeclaredCapabilities: undeclared, passed: false }
  }

  const provider = await resolveActiveProvider()
  // No page content crosses into this call. That is the entire basis of the
  // reviewer's independence — see REVIEW_SYSTEM_PROMPT.
  const model = await provider.review({ code, intent })

  return {
    static: findings,
    undeclaredCapabilities: undeclared,
    model,
    passed: model.verdict === 'match',
  }
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
  tabId: number | undefined,
  rect: { x: number; y: number; width: number; height: number },
): Promise<{ dataUrl: string; clipped: boolean }> {
  if (tabId === undefined) throw new Error('No tab to capture.')

  // captureVisibleTab only sees the viewport, so a target taller than the
  // viewport is clipped. We say so rather than silently sending a partial crop.
  const full = await browser.tabs.captureVisibleTab({ format: 'png' })
  const clipped = rect.height > window.innerHeight || rect.y < 0

  // Cropping happens here so the full-viewport capture never leaves this scope.
  const blob = await (await fetch(full)).blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(rect.width, rect.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not prepare the image.')
  context.drawImage(
    bitmap,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  )
  const cropped = await canvas.convertToBlob({ type: 'image/png' })

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the image.'))
    reader.readAsDataURL(cropped)
  })

  return { dataUrl, clipped }
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

// Registration state can drift if the browser restarted with stale scripts.
void (async () => {
  if (await hasUserScriptsPermission()) await reregisterAll()
})()
