/**
 * Deciding when to check whether transforms still work.
 *
 * The check itself lives in the content script — it resolves each transform's
 * anchor against the page, with a grace period so a slow SPA is not reported
 * as broken before it has rendered. This module only decides *when* to ask.
 *
 * That decision is a real cost trade-off rather than a preference. Resolving
 * an anchor walks candidate elements and scores them across several signals,
 * on every matching page load. `once-per-session` exists because on a site the
 * user opens fifty tabs of, the fiftieth check tells them nothing the first
 * did not.
 */

import type { ContentMessage } from '@shared/messages'
import type { Settings, Transform, TransformRuntimeState } from '@shared/types'

/**
 * Hosts already checked this session, for `once-per-session`.
 *
 * Deliberately in memory: a session ends when the browser closes, and that is
 * exactly when this should be forgotten. Persisting it would mean a transform
 * that broke overnight goes unnoticed until the user clears something they
 * cannot see.
 */
const checkedThisSession = new Set<string>()

export function shouldCheck(settings: Settings, url: string): boolean {
  switch (settings.healthCheckMode) {
    case 'every-load':
      return true
    case 'manual':
      return false
    case 'once-per-session': {
      const host = hostOf(url)
      if (!host || checkedThisSession.has(host)) return false
      checkedThisSession.add(host)
      return true
    }
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Asks the page to check, and hands the result to whoever is listening.
 *
 * Failure here is silent by design. The content script is absent on origins
 * the user has not granted, and a tab the user navigated away from mid-check
 * is not an error worth reporting — in both cases the honest outcome is simply
 * no result, not a warning about the extension's own plumbing.
 */
export async function runHealthCheck(
  tabId: number,
  transforms: Transform[],
): Promise<TransformRuntimeState[] | null> {
  if (transforms.length === 0) return null

  if (!(await waitForContentScript(tabId))) return null

  const message: ContentMessage = { type: 'run-health-check', transforms }
  try {
    const response = (await browser.tabs.sendMessage(tabId, message)) as
      | { type: 'health-check-result'; states: TransformRuntimeState[] }
      | undefined
    return response?.states ?? null
  } catch {
    return null
  }
}

const READY_ATTEMPTS = 20
const READY_INTERVAL_MS = 250

/**
 * Waits until the page can answer, because at the moment we ask it usually
 * cannot.
 *
 * This is the fix for a bug that made the whole automatic health check dead
 * code. The check is triggered from `webNavigation.onCommitted`, which fires
 * when the navigation commits — before the document has parsed, and well before
 * a `document_idle` content script exists. So `sendMessage` threw "could not
 * establish connection" every single time, `runHealthCheck` caught it and
 * returned null, and the caller treated null as "nothing to report".
 *
 * It failed silently and looked exactly like a page whose transforms were all
 * fine. Measured rather than reasoned about: an extension page listening for
 * `health-check-result` recorded zero on first navigation and zero on reload,
 * while the same check asked directly a few seconds later returned `broken`.
 *
 * Polling `ping` rather than moving to `onCompleted`: `onCompleted` would fix
 * the common case and still lose the ones that matter most — a slow page, or an
 * origin whose content script was registered moments ago and has not been
 * injected into the already-open tab yet.
 *
 * Giving up after five seconds is not an error. The content script is genuinely
 * absent on origins the user has not granted, and silence is the honest answer
 * there.
 */
async function waitForContentScript(tabId: number): Promise<boolean> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    try {
      if (await browser.tabs.sendMessage(tabId, { type: 'ping' } as ContentMessage)) return true
    } catch {
      // Not listening yet, or not there at all. The next attempt tells us which.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_INTERVAL_MS))
  }
  return false
}

/** Exposed so a manual check can bypass the per-session record. */
export function forgetSession(url: string): void {
  const host = hostOf(url)
  if (host) checkedThisSession.delete(host)
}
