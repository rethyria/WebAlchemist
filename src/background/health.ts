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

/** Exposed so a manual check can bypass the per-session record. */
export function forgetSession(url: string): void {
  const host = hostOf(url)
  if (host) checkedThisSession.delete(host)
}
