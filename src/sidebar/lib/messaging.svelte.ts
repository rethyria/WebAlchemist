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
    history: unknown[]
    scopeDepth?: number
    scopeContainer?: string | null
  },
  handlers: {
    onSent: () => void
    onThinking: (characters: number) => void
    onChunk: (accumulated: string) => void
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
          resolve(message['result'])
          return
        case 'error': {
          settled = true
          port.disconnect()
          const error = message['error'] as {
            message: string
            kind?: string
            retryable?: boolean
          }
          reject(new BackgroundError(error.message, error.kind, error.retryable ?? false))
        }
      }
    })

    // Covers the background being torn down mid-request. Without it the
    // promise would hang and the panel would sit on a stage forever.
    port.onDisconnect.addListener(() => {
      if (settled) return
      reject(
        new BackgroundError(
          'The connection to the extension dropped before the response arrived.',
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
 */
export async function activeTab(): Promise<browser.tabs.Tab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}
