/**
 * Private windows (#127).
 *
 * Firefox runs the extension in a private window only when the person allows
 * it. Existing transforms then apply there, which reads the page and stores
 * nothing. Picking, generating, capturing and saving are refused, because each
 * sends or keeps text from the page: a saved transform holds the URL pattern,
 * the anchor text and the description in storage.local, and that record stays
 * after the window closes.
 */

export const PRIVATE_WINDOW_MESSAGE =
  'Web Alchemist does not pick, generate, capture or save in a private window, because a saved transform keeps text from the page after the window closes. Use a normal window to make a transform. Transforms you already saved still apply here.'

/**
 * Throws PRIVATE_WINDOW_MESSAGE when the tab is in a private window.
 *
 * A missing tab id or a tab that cannot be read does not refuse: the handlers
 * that need the page fail on their own in that case, and refusing here would
 * report a private window for a tab that has simply closed.
 */
export async function refuseInPrivateWindow(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  if (tab?.incognito) throw new Error(PRIVATE_WINDOW_MESSAGE)
}
