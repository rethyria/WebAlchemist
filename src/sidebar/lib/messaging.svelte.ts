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
