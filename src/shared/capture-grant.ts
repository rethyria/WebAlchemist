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
 * It lives in `storage.session`, so it survives the background page being
 * suspended and does not survive a browser restart. After a restart the grant
 * is still held and the record is gone; the background script then judges the
 * grant by whether any panel reconnects (see index.ts).
 */

export const CAPTURE_GRANT_KEY = 'wa-capture-grant-held'

/** Written before the permission request, so the record exists as soon as the grant can. */
export function recordCaptureGrant(held: boolean): Promise<void> {
  return browser.storage.session.set({ [CAPTURE_GRANT_KEY]: held })
}
