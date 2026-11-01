import { t } from './i18n'
/**
 * Features that Firefox for Android does not provide, and the plain messages
 * shown in their place (#128).
 *
 * The list comes from Mozilla's browser compatibility data as remembered when
 * this was written, not from a device. `tabs.captureVisibleTab` and the
 * `identity` sign-in flow are the two the extension depends on that are
 * believed to be missing or incomplete there.
 */

export const SCREENSHOTS_UNAVAILABLE =
  t('screenshotsUnavailable')

export const ACCOUNT_SIGN_IN_UNAVAILABLE =
  t('accountSignInUnavailable')

/** Whether the browser provides the sign-in flow that `identity.launchWebAuthFlow` runs. */
export function hasAccountSignIn(api: { identity?: { launchWebAuthFlow?: unknown } | undefined }): boolean {
  return typeof api.identity?.launchWebAuthFlow === 'function'
}
