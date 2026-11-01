/**
 * Applies the CSS URL policy: works out the page and the site's mode, then runs
 * the check in `@safety/css-check`.
 *
 * Kept apart from the check itself so that the check stays free of browser
 * APIs and testable on its own, and apart from index.ts because four places
 * need it: saving, previewing, re-applying stored CSS, and importing.
 */

import { checkCss, hostOfPattern, modeForHost } from '@safety/css-check'
import type { CssUrlMode, ReviewResult, Settings, Transform } from '@shared/types'
import { t } from '@shared/i18n'

/**
 * The page a check resolves relative URLs against.
 *
 * A real page URL when there is one. The editor has none, so the host in the
 * match pattern stands in: it is the best available answer to "which origin is
 * this for", and the check is repeated against the real URL on every visit.
 */
export function pageUrlFor(match: string, tabUrl?: string): string | undefined {
  if (tabUrl) return tabUrl
  const host = hostOfPattern(match)
  return host ? `https://${host}/` : undefined
}

export function modeForPage(settings: Settings, pageUrl: string | undefined): CssUrlMode {
  if (!pageUrl) return 'block'
  try {
    return modeForHost(settings.cssUrlPolicy, new URL(pageUrl).hostname)
  } catch {
    return 'block'
  }
}

/**
 * Whether stored CSS is filtered the same way for two addresses: the same
 * per-site mode and the same origin, which is what a same-origin address is
 * judged against. Two addresses that differ only in path or fragment give the
 * same filtered CSS; a move to another origin or to a site with another
 * setting does not.
 */
export function sameCssContext(settings: Settings, a: string, b: string): boolean {
  if (modeForPage(settings, a) !== modeForPage(settings, b)) return false
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return a === b
  }
}

/** The check in the shape the approval panel already renders for JavaScript. */
export function checkCssForPage(
  css: string,
  settings: Settings,
  pageUrl: string | undefined,
  approvedUrls: readonly string[] | undefined,
): ReviewResult {
  const result = checkCss(css, {
    mode: modeForPage(settings, pageUrl),
    ...(pageUrl === undefined ? {} : { pageUrl }),
    ...(approvedUrls === undefined ? {} : { approvedUrls }),
  })
  return {
    static: result.findings,
    undeclaredCapabilities: [],
    pendingUrls: result.pendingUrls,
    passed: result.passed,
  }
}

/** Checks a stored or about-to-be-stored CSS transform. */
export function checkCssTransform(
  transform: Pick<Transform, 'code' | 'match' | 'approvedCssUrls'>,
  settings: Settings,
  tabUrl?: string,
): ReviewResult {
  return checkCssForPage(
    transform.code,
    settings,
    pageUrlFor(transform.match, tabUrl),
    transform.approvedCssUrls,
  )
}

/**
 * Throws unless CSS may be applied to the page as a preview.
 *
 * A preview is the one place CSS reaches the live page before the user has
 * read it or approved it. A request a rule causes is sent at once, and
 * discarding the preview afterwards does not take it back, so a rule that
 * fails the check is never applied. CSS that is only waiting for the user to
 * approve external addresses fails here too, since those approvals are given
 * in the approval panel, after the preview.
 */
export function assertPreviewable(
  css: string,
  settings: Settings,
  tabUrl: string | undefined,
  approvedUrls: readonly string[] | undefined,
): void {
  const check = checkCssForPage(css, settings, tabUrl, approvedUrls)
  if (check.passed) return
  throw new Error(
    check.static[0]?.explanation ??
      t('bgThisCssLoadsAddressesOutsideThe'),
  )
}
