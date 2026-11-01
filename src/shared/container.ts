/**
 * Restricting a transform to one Firefox container (#127).
 *
 * The restriction applies to CSS transforms only. CSS is applied by the
 * background script, which can read the tab's container before it inserts the
 * stylesheet. JavaScript transforms are registered with the userScripts API,
 * and the MDN reference for userScripts.RegisteredUserScript (read in
 * November 2026) lists no cookieStoreId property, so a registration cannot be
 * limited to a container. The user script world also runs with messaging off,
 * so the script cannot ask the background which container it is in. A
 * JavaScript transform therefore runs in every container whatever this field
 * holds, and the editor does not offer the restriction for one.
 */

import type { Transform } from './types'

/** The cookie store of a tab that is not in any container. */
export const DEFAULT_COOKIE_STORE = 'firefox-default'

/** The sentence the editor shows next to the restriction. */
export const CONTAINER_SCOPE_NOTE =
  'Applies to CSS transforms only. A JavaScript transform runs in every container, because Firefox cannot limit a registered user script to one.'

/**
 * Whether a transform may apply in a tab of the given container.
 *
 * A transform with a restriction does not apply when the tab's container is
 * unknown, so that a failure to read it never lets a restricted transform run
 * in the wrong container.
 */
export function appliesInContainer(
  transform: Pick<Transform, 'cookieStoreId'>,
  tabCookieStoreId: string | undefined,
): boolean {
  if (transform.cookieStoreId === undefined) return true
  return transform.cookieStoreId === tabCookieStoreId
}
