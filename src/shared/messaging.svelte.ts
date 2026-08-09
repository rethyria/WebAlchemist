/**
 * Typed wrapper over runtime messaging, for every extension page.
 *
 * Shared rather than per-page. This lived in the sidebar and carried a comment
 * saying the Proxy unwrap below belonged in one place "rather than at each
 * call site where it is one omission away from breaking again" — and then the
 * editor page was written with its own copy of `send`, without it, and every
 * save from that page failed with the exact error the comment names. One
 * implementation is the point.
 *
 * Note what this module cannot do: there is no message that returns a
 * credential value, so no amount of calling from here reaches one.
 */

import type { Message, MessageResponse } from './messages'

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
   * inside a plain object, so the unwrap happens centrally. Snapshotting a
   * value that was never reactive returns it unchanged, so this is safe for
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
