/**
 * The record that the all-sites grant for screenshots is held for a run.
 *
 * Screenshots need the `<all_urls>` origin grant, which only the panel can
 * request, because the request needs a user gesture. Handing the grant back
 * when the run ends was also done only in the panel, so a panel that closed
 * during a run never handed it back. The panel writes this record when it
 * asks for the grant and clears it when it gives the grant back, and the
 * background script reads it when the panel's port disconnects.
 *
 * It lives in `storage.local`, so it survives both the background page being
 * suspended and a browser restart, as the grant itself does. At start-up the
 * background script removes the all-sites grant only when this record says the
 * panel took it for a run. A grant the user gave outside the panel has no
 * record and is never removed.
 */

export const CAPTURE_GRANT_KEY = 'wa-capture-grant-held'

/** Written before the permission request, so the record exists as soon as the grant can. */
export function recordCaptureGrant(held: boolean): Promise<void> {
  return browser.storage.local.set({ [CAPTURE_GRANT_KEY]: held })
}
