/**
 * Moves between the panel's tab and the page tab during a pick, when the panel
 * is open in a tab (Firefox for Android).
 *
 * The picker draws on the page, so the page tab has to be in front for the user
 * to tap on it, and the panel tab has to be in front again afterwards to show
 * what was picked. In the docked sidebar both are visible together and nothing
 * here does anything.
 */

/** Content events that end a pick, successfully or not. */
const PICK_ENDING_EVENTS: ReadonlySet<string> = new Set([
  'element-picked',
  'element-referenced',
  'picking-cancelled',
  'region-selected',
])

export function endsPick(eventType: string): boolean {
  return PICK_ENDING_EVENTS.has(eventType)
}

export interface TabFocusDeps {
  /** The page tab the panel is bound to, or null in the docked sidebar. */
  boundTab(): number | null
  /** The tab this panel document is shown in. */
  ownTab(): Promise<{ id?: number | undefined } | undefined>
  activate(tabId: number): Promise<unknown>
}

/** Brings the page tab to the front once the picker is running. No-op when docked. */
export async function showPageForPick(deps: TabFocusDeps): Promise<void> {
  const page = deps.boundTab()
  if (page === null) return
  await deps.activate(page).catch(() => {})
}

/** Brings the panel tab to the front when a pick ends. No-op when docked. */
export async function showPanelAfterPick(eventType: string, deps: TabFocusDeps): Promise<void> {
  if (deps.boundTab() === null || !endsPick(eventType)) return
  const own = await deps.ownTab().catch(() => undefined)
  if (own?.id !== undefined) await deps.activate(own.id).catch(() => {})
}
