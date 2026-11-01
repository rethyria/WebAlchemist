import { COOKIES_PERMISSION } from './container'
import { originPermissionFor } from './match'
import type { TransformKind } from './types'

/**
 * The permission requests a save has to make, as the argument lists for
 * `permissions.request`.
 *
 * `userScripts` is never combined with another entry in one request. Firefox
 * rejects a request that carries it together with an origin, even when both
 * are already held (see `Flow.requestFor`), so it is always its own request.
 */
export function permissionRequestsFor(
  kind: TransformKind,
  origin: string | null,
  needsCookies = false,
): browser.permissions.Permissions[] {
  const requests: browser.permissions.Permissions[] = []
  if (origin) requests.push({ origins: [origin] })
  // 'userScripts' is absent from the OptionalPermission union in
  // @types/firefox-webext-browser, and a union cannot be widened by
  // declaration merging. Same cast as registry.ts, for the same reason.
  if (kind === 'js') {
    requests.push({ permissions: ['userScripts'] } as unknown as browser.permissions.Permissions)
  }
  // Only for a container restriction that has to read a tab's container.
  if (needsCookies) requests.push(COOKIES_PERMISSION)
  return requests
}

/**
 * Issues every request before awaiting any of them, and resolves true only
 * when all were granted.
 *
 * `permissions.request` only succeeds while the user gesture behind the click
 * is live, and awaiting one request spends the gesture the next one needs. The
 * obvious sequential loop would therefore show the first prompt and refuse the
 * second. Requests that are already held resolve true without a prompt.
 */
export function requestAll(
  request: (permissions: browser.permissions.Permissions) => Promise<boolean>,
  requests: browser.permissions.Permissions[],
): Promise<boolean> {
  const pending = requests.map((one) => request(one))
  return Promise.all(pending).then((results) => results.every(Boolean))
}

/**
 * The origin the editor has to request for a save, or null when none is needed.
 *
 * Creating always requests it. The sidebar's draft starts with a pattern that
 * covers the domain and its subdomains, while picking an element granted only
 * the exact host, so an unchanged pattern is still wider than what is held.
 * Skipping the request when the pattern was not edited left the transform
 * working on the picked host and nowhere else it claimed to apply (#102).
 * Requesting something already held resolves true without a prompt.
 *
 * Editing an existing transform requests only when the pattern changed,
 * because the saved pattern was already requested when it was saved.
 */
export function editorOriginToRequest(
  creating: boolean,
  wanted: string,
  savedMatch: string,
): string | null {
  if (!creating && wanted === savedMatch) return null
  return originPermissionFor(wanted)
}
