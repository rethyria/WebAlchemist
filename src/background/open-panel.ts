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
  createTab(url: string): Promise<{ id?: number | undefined } | undefined>
  activateTab(id: number): Promise<unknown>
  /** Reloads a tab, so that a panel that refused its binding reads the new record. */
  reloadTab(id: number): Promise<unknown>
  /** The page tab recorded for a panel tab, from storage.session. */
  recordedPage(panelTabId: number): Promise<number | undefined>
  /** Records that a panel tab works on a page tab, in storage.session. */
  recordPanel(panelTabId: number, pageTabId: number): Promise<void>
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
    // A panel tab that Firefox restored after a restart has no record and has
    // refused its binding. The click names the page now, so the record is
    // written and the panel is loaded again to read it.
    if ((await deps.recordedPage(existing.id)) !== pageTabId) {
      await deps.recordPanel(existing.id, pageTabId)
      await deps.reloadTab(existing.id)
    }
    await deps.activateTab(existing.id)
    return
  }
  // The panel reads the record when it loads, and retries for a short time
  // because the tab id is only known after the tab exists.
  const created = await deps.createTab(url)
  if (created?.id !== undefined) await deps.recordPanel(created.id, pageTabId)
}
