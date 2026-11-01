/**
 * Restricting a transform to the container of one tab (#127).
 *
 * The extension does not hold the contextualIdentities permission, because
 * installing an extension that holds it turns on Firefox's container feature
 * for every user. Without it there is no list of container names, so the
 * editor offers two choices, "Every tab" and the container of the tab the
 * transform was made in, and stores that tab's cookie store id. Reading a
 * tab's cookieStoreId needs the cookies permission, which is optional and is
 * requested only when a person chooses the restriction.
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

/** The two choices the editor offers. */
export const EVERY_TAB_LABEL = 'Every tab'
export const TAB_CONTAINER_LABEL = 'Only in the container of the tab this transform was made in'

/** The sentence the editor shows next to the restriction. */
export const CONTAINER_SCOPE_NOTE =
  'Applies to CSS transforms only. A JavaScript transform runs in every container, because Firefox cannot limit a registered user script to one. The container is read from the tab the sidebar was showing when this editor opened, and reading it needs the cookies permission, which is requested when this is saved.'

/** The permission that lets the extension read a tab's container. */
export const COOKIES_PERMISSION = {
  permissions: ['cookies'],
} as browser.permissions.Permissions

/** Shown next to a restriction that cannot be checked because the permission is gone. */
export const CONTAINER_UNREADABLE_NOTE =
  'This transform is restricted to a container, but the cookies permission is not granted, so Firefox does not report which container a tab is in and the transform does not apply in any tab. Saving it with the cookies permission, or choosing "Every tab", fixes this.'

export const CONTAINER_TAB_UNKNOWN =
  'The tab this editor was opened from has closed or cannot be read, so its container is not known. Open the editor again from the sidebar.'

export type ContainerChoice = 'every-tab' | 'tab-container'

/**
 * The container to store for a save, or the reason one cannot be chosen.
 *
 * `stored` is the value already on the record. Keeping the restriction as it
 * is needs no read of any tab. A new restriction takes the cookie store of the
 * tab the editor was opened from, and is refused when that cannot be read, so
 * that a transform is never saved restricted to nothing.
 */
export function containerForSave(
  choice: ContainerChoice,
  stored: string | undefined,
  tabCookieStoreId: string | undefined,
): { cookieStoreId: string | undefined } | { error: string } {
  if (choice === 'every-tab') return { cookieStoreId: undefined }
  if (stored !== undefined) return { cookieStoreId: stored }
  if (tabCookieStoreId === undefined) return { error: CONTAINER_TAB_UNKNOWN }
  return { cookieStoreId: tabCookieStoreId }
}

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
