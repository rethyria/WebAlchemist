/**
 * Which tabs each window's sidebar has used for a run (picking, locking a
 * scope, editing a description).
 *
 * A closing sidebar cannot tell the page to remove the picker overlay or the
 * lock outline, because the panel is gone. The background does it when the
 * sidebar's port disconnects, so it needs to know which tabs that window's
 * sidebar touched. The record is in storage.session, as the preview owners are,
 * so that it survives the background page being suspended.
 */

const PREFIX = 'wa-run-tabs-'
const keyFor = (windowId: number) => `${PREFIX}${windowId}`

/** Records that the sidebar of `windowId` is working in `tabId`. */
export async function recordRunTab(windowId: number, tabId: number): Promise<void> {
  const key = keyFor(windowId)
  const stored = (await browser.storage.session.get(key))[key]
  const tabs = Array.isArray(stored) ? (stored as number[]) : []
  if (tabs.includes(tabId)) return
  await browser.storage.session.set({ [key]: [...tabs, tabId] })
}

/** Returns the tabs recorded for `windowId` and forgets them. */
export async function takeRunTabs(windowId: number): Promise<number[]> {
  const key = keyFor(windowId)
  const stored = (await browser.storage.session.get(key))[key]
  await browser.storage.session.remove(key)
  return Array.isArray(stored) ? (stored as number[]) : []
}

/** The windows that have run tabs recorded, for a start-up that has lost its in-memory state. */
export async function windowsWithRunTabs(): Promise<number[]> {
  const stored = await browser.storage.session.get(null)
  return Object.keys(stored)
    .filter((key) => key.startsWith(PREFIX))
    .map((key) => Number(key.slice(PREFIX.length)))
    .filter((windowId) => Number.isInteger(windowId))
}
