/**
 * Typed wrapper over runtime messaging.
 *
 * Every call goes to the background script. Note what this module cannot do:
 * there is no message that returns a credential value, so no amount of calling
 * from here reaches one.
 */


/*
 * Both live in shared/ now, so the editor page and any future page use the
 * same implementation — and the same Proxy unwrap. Re-exported rather than
 * moved outright, since every call site in the sidebar imports from here.
 */
import { BackgroundError } from '@shared/messaging.svelte'
import type { UsageReport } from '@shared/types'
import { boundTab } from '@shared/panel-binding'
import { t } from '@shared/i18n'
export { BackgroundError, send } from '@shared/messaging.svelte'

/**
 * Runs a generation over a port, reporting progress as it arrives.
 *
 * A `sendMessage` round trip has nothing to say between request and response,
 * which is the whole reason for the port. It does not keep the background page
 * alive — an earlier version of this comment said it did, and that was wrong;
 * see keepalive.ts for what actually holds off suspension.
 */
export function generateOverPort(
  request: {
    context: unknown
    instruction: string
    /** True when `instruction` is an imported transform's description, unchanged. */
    instructionImported?: boolean
    /** The imported description behind a follow-up, sent fenced on every turn. */
    importedDescription?: string
    /** True when `instruction` is a saved description, unchanged. */
    instructionSaved?: boolean
    /** The saved description behind a follow-up, sent fenced on every turn. */
    savedDescription?: string
    history: unknown[]
    scopeDepth?: number
    scopeContainer?: string | null
    /* For the toolbar badge: a sidebar port carries no tab of its own. */
    tabId?: number | undefined
    /* The transform being authored or repaired, so its cost is attributed to it. */
    transformId?: string
  },
  handlers: {
    onSent: () => void
    onThinking: (characters: number) => void
    onChunk: (accumulated: string) => void
    /** Called before the result resolves, with what the call used. */
    onUsage?: (usage: UsageReport | undefined) => void
  },
): { result: Promise<unknown>; cancel: () => void } {
  const port = browser.runtime.connect({ name: 'wa-generate' })
  let settled = false

  const result = new Promise<unknown>((resolve, reject) => {
    port.onMessage.addListener((raw: object) => {
      const message = raw as Record<string, unknown>
      switch (message['type']) {
        case 'sent':
          handlers.onSent()
          return
        case 'thinking':
          handlers.onThinking(message['characters'] as number)
          return
        case 'chunk':
          handlers.onChunk(message['text'] as string)
          return
        case 'done':
          settled = true
          port.disconnect()
          handlers.onUsage?.(message['usage'] as UsageReport | undefined)
          resolve(message['result'])
          return
        case 'error': {
          settled = true
          port.disconnect()
          const error = message['error'] as {
            message: string
            kind?: string
            retryable?: boolean
            retryInSeconds?: number
          }
          reject(
            new BackgroundError(
              error.message,
              error.kind,
              error.retryable ?? false,
              error.retryInSeconds,
            ),
          )
        }
      }
    })

    // Covers the background being torn down mid-request. Without it the
    // promise would hang and the panel would sit on a stage forever.
    port.onDisconnect.addListener(() => {
      if (settled) return
      reject(
        new BackgroundError(
          t('msgConnectionDropped'),
          'network',
          true,
        ),
      )
    })
  })

  port.postMessage($state.snapshot(request))

  return {
    result,
    cancel: () => {
      settled = true
      port.disconnect()
    },
  }
}

/**
 * The active tab, including its URL.
 *
 * Reading `tab.url` needs the `tabs` permission. Without it Firefox returns
 * the tab object with `url` undefined for any page we hold no host permission
 * for — which is every site, before the user has granted anything.
 *
 * That is why `tabs` is a required permission rather than an optional one. A
 * per-site tool has to know which site it is on to say anything at all, and
 * deriving it from host permissions is circular: the panel cannot offer to
 * request permission for a site it cannot name.
 *
 * When the panel is open in a tab, this is the page tab it is bound to rather
 * than the active tab.
 */
export async function activeTab(): Promise<browser.tabs.Tab | null> {
  // Open in a tab (Firefox for Android): the active tab is the panel itself,
  // so the page is the tab the panel was bound to when it opened.
  const bound = boundTab()
  if (bound !== null) return (await browser.tabs.get(bound).catch(() => null)) ?? null
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}
