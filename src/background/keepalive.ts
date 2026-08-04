/**
 * Keeps the event page alive across a long provider call.
 *
 * Firefox terminates a non-persistent background page after
 * `extensions.background.idle.timeout` — 30000 ms by default, set as a lazy
 * preference getter in ext-backgroundPage.js, which is why the pref does not
 * exist in the pref service until someone overrides it. A request to a
 * reasoning model routinely spends longer than that producing nothing at all,
 * and the page was being suspended underneath it. The panel reported
 *
 *   "The connection to the extension dropped before the response arrived."
 *
 * after the request had already been paid for.
 *
 * What resets the timer is a *parent-process API call made from the background
 * context*: ExtensionParent's recvAPICall emits `background-script-reset-idle`
 * with reason "parentapicall" for exactly that case. Nothing else we do here
 * counts, and three near-misses are worth naming because each looks like it
 * should work:
 *
 *   - An in-flight fetch does not count. It never enters the extension API
 *     layer, so the idle timer neither sees it nor waits for it.
 *   - A runtime.Port does not count. The suspend path exempts *native*
 *     messaging ports (`hasActiveNativeAppPorts`); an extension-to-extension
 *     port is not exempt, whatever traffic crosses it. The comment on the
 *     generation port claiming an open port keeps the page alive was wrong.
 *   - A pending runtime.onMessage listener promise buys exactly one reset, and
 *     the tracking is cleared immediately after so it cannot fire twice. That
 *     gives a plain sendMessage call 60 seconds rather than 30 — a longer
 *     fuse, not a safe one.
 *
 * runtime.getPlatformInfo is implemented only in parent/ext-runtime.js, with
 * no child-side counterpart, so calling it is a real round trip rather than
 * something answered locally without touching the parent.
 */

/**
 * Firefox's default. The pref can lower this to 100 ms, and an extension has
 * no way to read it, so a profile that has overridden it downward can still
 * suspend us. That is not worth defending against: the override is not a
 * default anyone hits by accident.
 */
const IDLE_TIMEOUT_MS = 30_000

/** Half the window, so one missed beat is not on its own fatal. */
const BEAT_MS = IDLE_TIMEOUT_MS / 2

/**
 * Runs `work` with the idle timer held off for its whole duration.
 *
 * Wrap every provider call in this. The streaming path needs it because the
 * model is silent while it reasons; the non-streaming paths need it more,
 * because they are silent from start to finish.
 */
export async function withKeepalive<T>(work: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    // Fire-and-forget: the reset is emitted when the call is *dispatched* to
    // the parent, so the reply is of no interest. A rejection here would
    // otherwise become an unhandled rejection for no reason.
    void browser.runtime.getPlatformInfo().catch(() => {})
  }, BEAT_MS)

  try {
    return await work()
  } finally {
    clearInterval(timer)
  }
}
