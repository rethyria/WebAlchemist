import { t } from '@shared/i18n'
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

export const TAB_UNKNOWN_MESSAGE =
  t('bgWebAlchemistCouldNotTellWhich')

export const PRIVATE_WINDOW_MESSAGE =
  t('bgWebAlchemistDoesNotPickGenerate')

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

/**
 * Like refuseInPrivateWindow, for the handlers that forward a page's context
 * to a model (generate, repair and the generation port).
 *
 * These fail closed. Without a tab id, or with a tab that cannot be read, the
 * window is unknown, and sending the page text to a provider from what might
 * be a private window is the harm this module exists to prevent. The other
 * handlers read the page from the tab themselves and fail when it is missing,
 * so they keep the lenient check.
 */
export async function requireNormalWindow(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) throw new Error(TAB_UNKNOWN_MESSAGE)
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  if (!tab) throw new Error(TAB_UNKNOWN_MESSAGE)
  if (tab.incognito) throw new Error(PRIVATE_WINDOW_MESSAGE)
}
