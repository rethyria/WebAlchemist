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
  const response = (await browser.runtime.sendMessage(message)) as MessageResponse<T>
  if (!response?.ok) {
    throw new BackgroundError(
      response?.error?.message ?? 'Something went wrong.',
      response?.error?.kind,
      response?.error?.retryable ?? false,
    )
  }
  return response.data as T
}

export async function activeTab(): Promise<browser.tabs.Tab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}
