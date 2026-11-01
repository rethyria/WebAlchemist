/**
 * What the toolbar action does: open the sidebar on desktop, or open the panel
 * in a tab on Firefox for Android, which has no sidebars.
 *
 * `sidebarAction.open()` only works inside the handler of a user action, so the
 * desktop branch must call it before the first `await`. The operating system is
 * therefore read once at start-up and passed in as a synchronous function. If
 * the start-up read has not finished, the sidebar is used whenever the API
 * exists.
 */

import { panelUrl } from '@shared/panel-binding'

export interface OpenPanelDeps {
  /** The operating system from `runtime.getPlatformInfo()`, or undefined before it is known. */
  os(): string | undefined
  /** Whether `browser.sidebarAction.open` exists. */
  hasSidebar(): boolean
  openSidebar(): Promise<void>
  /** `browser.runtime.getURL('')`. */
  extensionBase(): string
  /** The ids and addresses of every open tab. */
  listTabs(): Promise<{ id?: number | undefined; url?: string | undefined }[]>
  createTab(url: string): Promise<unknown>
  activateTab(id: number): Promise<unknown>
}

/** True where the panel opens in a tab. */
export function opensInTab(deps: Pick<OpenPanelDeps, 'os' | 'hasSidebar'>): boolean {
  return deps.os() === 'android' || !deps.hasSidebar()
}

export function openPanel(
  pageTab: { id?: number | undefined } | undefined,
  deps: OpenPanelDeps,
): Promise<void> {
  if (!opensInTab(deps)) return deps.openSidebar()
  return openPanelTab(pageTab?.id, deps)
}

async function openPanelTab(pageTabId: number | undefined, deps: OpenPanelDeps): Promise<void> {
  // A toolbar click always names the tab it came from; without one the panel
  // would have no page to work on.
  if (pageTabId === undefined) return
  const url = panelUrl(deps.extensionBase(), pageTabId)
  const existing = (await deps.listTabs()).find((tab) => tab.url === url && tab.id !== undefined)
  if (existing?.id !== undefined) {
    await deps.activateTab(existing.id)
    return
  }
  await deps.createTab(url)
}
