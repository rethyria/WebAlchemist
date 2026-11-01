/**
 * The record that a person has read the first-run disclosure.
 *
 * It holds the version of the text that was shown (DISCLOSURE_VERSION). It
 * lives in `storage.local` so that the settings page and the sidebar share it,
 * and so that it survives restarts. As with the capture-grant record, the
 * pages write it directly: the user's own click is the only writer.
 *
 * This gates what the pages show. It does not stop the background script from
 * accepting a credential that something else sends it, which is outside the
 * threat this screen addresses: the screen exists so that a person reads what
 * the extension does before entering a key.
 */

import { DISCLOSURE_VERSION } from './disclosure'

export const DISCLOSURE_ACK_KEY = 'wa-disclosure-ack'

/**
 * Whether the disclosure has to be shown, given what is stored. Anything that
 * is not a record with a version at or above the current one counts as not
 * acknowledged, so an unreadable value shows the text rather than skipping it.
 */
export function needsDisclosure(stored: unknown, current: number = DISCLOSURE_VERSION): boolean {
  if (typeof stored !== 'object' || stored === null) return true
  const version = (stored as { version?: unknown }).version
  return typeof version !== 'number' || !Number.isFinite(version) || version < current
}

export async function readDisclosureNeeded(): Promise<boolean> {
  const stored = (await browser.storage.local.get(DISCLOSURE_ACK_KEY))[DISCLOSURE_ACK_KEY]
  return needsDisclosure(stored)
}

/** Stores that the current version was read, when the person confirms it. */
export function recordDisclosureAck(): Promise<void> {
  return browser.storage.local.set({
    [DISCLOSURE_ACK_KEY]: { version: DISCLOSURE_VERSION, at: Date.now() },
  })
}

/**
 * Calls back with the new answer whenever the record changes, so that
 * acknowledging in one surface opens the other. Returns the function that
 * stops listening.
 */
export function watchDisclosureNeeded(onchange: (needed: boolean) => void): () => void {
  const listener = (changes: Record<string, browser.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[DISCLOSURE_ACK_KEY]) return
    onchange(needsDisclosure(changes[DISCLOSURE_ACK_KEY].newValue))
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
