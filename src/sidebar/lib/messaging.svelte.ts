/**
 * Typed wrapper over runtime messaging.
 *
 * Every call goes to the background script. Note what this module cannot do:
 * there is no message that returns a credential value, so no amount of calling
 * from here reaches one.
 */

import type { Message, MessageResponse } from '@shared/messages'

export class BackgroundError extends Error {
  constructor(
    message: string,
    readonly kind: string | undefined,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'BackgroundError'
  }
}

export async function send<T>(message: Message): Promise<T> {
  /*
   * Runes deep-proxy the objects they hold, and runtime.sendMessage
   * structured-clones its argument — which throws on a Proxy:
   *
   *   DataCloneError: Proxy object could not be cloned.
   *
   * Anything reaching here may have come out of $state, directly or nested
   * inside a plain object, so the unwrap happens centrally rather than at each
   * call site where it is one omission away from breaking again. Snapshotting
   * a value that was never reactive returns it unchanged, so this is safe for
   * every message.
   */
  const payload = $state.snapshot(message) as Message
  const response = (await browser.runtime.sendMessage(payload)) as MessageResponse<T>
  if (!response?.ok) {
    throw new BackgroundError(
      response?.error?.message ?? 'Something went wrong.',
      response?.error?.kind,
      response?.error?.retryable ?? false,
    )
  }
  return response.data as T
}

/**
 * Runs a generation over a port, reporting the response as it arrives.
 *
 * The port is not an optimisation. A `sendMessage` round trip has nothing to
 * say between request and response, and — because MV3 makes the background a
 * non-persistent event page — Firefox may suspend it underneath a long fetch,
 * which fails the whole call after the request has already been paid for. An
 * open port both carries progress and keeps the page alive.
 */
export function generateOverPort(
  request: { context: unknown; instruction: string; history: unknown[] },
  handlers: {
    onSent: () => void
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
