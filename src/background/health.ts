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
import { errorTokensFor } from './error-tokens'
import type { Settings, Transform, TransformRuntimeState } from '@shared/types'

/**
 * The record of what `once-per-session` has already checked, one
 * `storage.session` key per check.
 *
 * It was a module variable, on the reasoning that a session ends when the
 * browser closes and that is when it should be forgotten. That reasoning held
 * for the browser closing and missed the event page being suspended after 30
 * seconds idle, which also emptied it: a site was then checked again after every
 * idle period instead of once per browser session. `storage.session` lasts
 * exactly as long as the browser session and survives a suspension, so it
 * matches the wording of the setting. It is not `storage.local`, which would
 * carry the record across restarts and hide a transform that broke overnight.
 *
 * One key per check rather than one list under one key: two tabs finishing at
 * the same moment would each read the list, add their own entry and write it
 * back, and one entry would be lost.
 *
 * The key is the host plus the ids of the transforms checked. The host alone
 * treated `example.com/a*` and `example.com/b*` as one site and checked only
 * whichever path was opened first; the ids alone would treat two sites that a
 * wildcard transform matches as one.
 */
function sessionKey(url: string, transforms: Transform[]): string | null {
  const host = hostOf(url)
  if (!host) return null
  return `wa-health-checked:${host}:${transforms.map((t) => t.id).sort().join(',')}`
}

export async function shouldCheck(
  settings: Settings,
  url: string,
  transforms: Transform[],
): Promise<boolean> {
  switch (settings.healthCheckMode) {
    case 'every-load':
      return true
    case 'manual':
      return false
    case 'once-per-session': {
      const key = sessionKey(url, transforms)
      if (!key) return false
      return !((await browser.storage.session.get(key))[key] as boolean | undefined)
    }
  }
}

/**
 * Records a check, once a result has arrived. Not before: a check that got no
 * answer, because the content script did not respond within 5 seconds, told the
 * user nothing, and marking it would have suppressed every later attempt this
 * session.
 */
export async function markChecked(url: string, transforms: Transform[]): Promise<void> {
  const key = sessionKey(url, transforms)
  if (key) await browser.storage.session.set({ [key]: true })
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
  /**
   * Reports whether the navigation that started this check is still the tab's
   * current one. A check started by a page load has to stop answering for that
   * page as soon as the tab leaves it: the ping loop below is satisfied by
   * whichever document answers first, so after a navigation it would run the
   * old page's transforms against the new page and report them broken.
   */
  isCurrent: () => boolean = () => true,
): Promise<TransformRuntimeState[] | null> {
  if (transforms.length === 0) return null

  if (!(await waitForContentScript(tabId, isCurrent))) return null
  if (!isCurrent()) return null

  try {
    const errorTokens = await errorTokensFor(transforms.filter((t) => t.kind === 'js').map((t) => t.id))
    const message: ContentMessage = { type: 'run-health-check', transforms, errorTokens }
    const response = (await browser.tabs.sendMessage(tabId, message)) as
      | { type: 'health-check-result'; states: TransformRuntimeState[] }
      | undefined
    // The page may also have navigated while the content script was checking.
    if (!isCurrent()) return null
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
async function waitForContentScript(
  tabId: number,
  isCurrent: () => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    if (!isCurrent()) return false
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
export async function forgetSession(url: string, transforms: Transform[]): Promise<void> {
  const key = sessionKey(url, transforms)
  if (key) await browser.storage.session.remove(key)
}
