/**
 * Which tabs each sidebar, or each panel tab, has used for a run (picking, locking a
 * scope, editing a description).
 *
 * A closing sidebar cannot tell the page to remove the picker overlay or the
 * lock outline, because the panel is gone. The background does it when the
 * sidebar's port disconnects, so it needs to know which tabs that window's
 * sidebar or that panel tab touched. The owner is a window id for the docked
 * sidebar and the panel owner key from shared/sidebar-port.ts for a panel tab. The record is in storage.session, as the preview owners are,
 * so that it survives the background page being suspended.
 */

const PREFIX = 'wa-run-tabs-'
const keyFor = (owner: number) => `${PREFIX}${owner}`

/** Records that the sidebar or panel tab `owner` is working in `tabId`. */
export async function recordRunTab(owner: number, tabId: number): Promise<void> {
  const key = keyFor(owner)
  const stored = (await browser.storage.session.get(key))[key]
  const tabs = Array.isArray(stored) ? (stored as number[]) : []
  if (tabs.includes(tabId)) return
  await browser.storage.session.set({ [key]: [...tabs, tabId] })
}

/** Returns the tabs recorded for `owner` and forgets them. */
export async function takeRunTabs(owner: number): Promise<number[]> {
  const key = keyFor(owner)
  const stored = (await browser.storage.session.get(key))[key]
  await browser.storage.session.remove(key)
  return Array.isArray(stored) ? (stored as number[]) : []
}

/** The owners that have run tabs recorded, for a start-up that has lost its in-memory state. */
export async function ownersWithRunTabs(): Promise<number[]> {
  const stored = await browser.storage.session.get(null)
  return Object.keys(stored)
    .filter((key) => key.startsWith(PREFIX))
    .map((key) => Number(key.slice(PREFIX.length)))
    .filter((owner) => Number.isInteger(owner))
}
