/**
 * Who may talk to the background script (#68).
 *
 * Every message the background handles is privileged: generation spends money,
 * credential and vault messages change secrets, settings writes can repoint a
 * provider's base URL, and saves and imports change what runs on pages. The
 * content script runs inside web pages, so it is the context most exposed to
 * attack, and it needs to send only the five events below. Everything else has
 * to come from one of the extension's own pages (sidebar, editor, options).
 *
 * The check is on `sender.url`, not on `sender.tab`. The editor page opens in a
 * tab, so a message from it carries a tab, and a check that required the tab to
 * be absent would refuse it. A content script's `sender.url` is the address of
 * the web page it runs in, which can never start with the extension's own
 * origin, so the URL separates the two cases in both directions.
 *
 * This limits what a compromised content script can trigger. It does not make
 * credentials private from it: storage.local is readable from every extension
 * context, as storage.ts describes.
 */

import type { ContentEvent } from '@shared/messages'

/**
 * The event types the content script sends with runtime.sendMessage. The list
 * was taken from every `send(` call in src/content/index.ts. The background
 * does not act on them; they are recognised so they are not treated as
 * requests, and so they are the only types that are never refused by sender.
 */
const CONTENT_EVENT_TYPES: ReadonlySet<string> = new Set<ContentEvent['type']>([
  'element-hovered',
  'element-picked',
  'element-referenced',
  'picking-cancelled',
  'region-selected',
])

export function isContentEvent(message: { type?: unknown }): boolean {
  return typeof message?.type === 'string' && CONTENT_EVENT_TYPES.has(message.type)
}

/** Whether a message or port came from a page that belongs to this extension. */
export function isExtensionPage(sender: { url?: string | undefined } | undefined): boolean {
  if (!sender || typeof sender.url !== 'string') return false
  return sender.url.startsWith(browser.runtime.getURL(''))
}
