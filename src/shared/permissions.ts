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
): browser.permissions.Permissions[] {
  const requests: browser.permissions.Permissions[] = []
  if (origin) requests.push({ origins: [origin] })
  // 'userScripts' is absent from the OptionalPermission union in
  // @types/firefox-webext-browser, and a union cannot be widened by
  // declaration merging. Same cast as registry.ts, for the same reason.
  if (kind === 'js') {
    requests.push({ permissions: ['userScripts'] } as unknown as browser.permissions.Permissions)
  }
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
