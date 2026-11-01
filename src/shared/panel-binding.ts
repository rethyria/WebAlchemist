import { t } from './i18n'
/**
 * Which page tab the authoring panel works on when it is open in a tab.
 *
 * On desktop the panel is a sidebar, and the page it works on is the active tab
 * of the sidebar's window. Firefox for Android has no sidebars, so the panel
 * opens as a tab of its own, and the active tab is then the panel itself. The
 * background therefore passes the id of the page tab in the address of the
 * panel (`?tab=<id>`), and the panel reads it back and checks it before it
 * works on that tab.
 *
 * A panel opened without the parameter is the desktop sidebar and works on the
 * active tab as before.
 */

/** The panel document, which the sidebar and the tab share. */
export const PANEL_PATH = 'src/sidebar/index.html'

/** The address of the panel for one page tab. `base` is `browser.runtime.getURL('')`. */
export function panelUrl(base: string, tabId: number): string {
  return `${base}${PANEL_PATH}?tab=${tabId}`
}

/**
 * The tab id in a panel address's query string, `null` when there is no
 * `tab` parameter, and `NaN` when the parameter is present but is not a
 * positive whole number.
 */
export function boundTabFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('tab')
  if (raw === null) return null
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : Number.NaN
}

export type Binding =
  | { kind: 'docked' }
  | { kind: 'bound'; tabId: number }
  | { kind: 'refused'; message: string }

/**
 * The record that links a panel tab to its page tab. The background writes it
 * to `storage.session` when it creates the panel tab, and the panel reads it
 * back. Tab ids are reused after a restart, so a panel tab that Firefox
 * restores carries an address (`?tab=<id>`) that may now name an unrelated tab;
 * the record does not survive a restart, so such a panel finds none.
 */
const PANEL_PAGE_PREFIX = 'wa-panel-page-'

export function panelPageKey(panelTabId: number): string {
  return `${PANEL_PAGE_PREFIX}${panelTabId}`
}

/** The panel tab ids that have a record, with the page tab each one works on. */
export function panelPagesFromStorage(stored: Record<string, unknown>): Map<number, number> {
  const pages = new Map<number, number>()
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(PANEL_PAGE_PREFIX) || typeof value !== 'number') continue
    const panel = Number(key.slice(PANEL_PAGE_PREFIX.length))
    if (Number.isInteger(panel)) pages.set(panel, value)
  }
  return pages
}

export interface PanelLink {
  /** The id of the tab this panel document is shown in (`tabs.getCurrent()`). */
  ownTabId(): Promise<number | undefined>
  /** The page tab the background recorded for a panel tab. */
  recordedPage(panelTabId: number): Promise<number | undefined>
  /** Waits between reads of the record, which the background may not have written yet. */
  wait(ms: number): Promise<void>
}

/** The background writes the record just after it creates the tab, so the panel may load first. */
const LINK_ATTEMPTS = 10
const LINK_WAIT_MS = 100

/**
 * Decides how the panel binds to a page tab, from its own query string.
 *
 * A bound panel is accepted only when the tab exists, is not a page of the
 * extension, and the background's record for this panel tab names the same
 * page tab. `getTab` is `browser.tabs.get`; `extensionBase` is
 * `browser.runtime.getURL('')`.
 */
export async function resolveBinding(
  search: string,
  extensionBase: string,
  getTab: (id: number) => Promise<{ id?: number | undefined; url?: string | undefined }>,
  link: PanelLink,
): Promise<Binding> {
  const id = boundTabFromSearch(search)
  if (id === null) return { kind: 'docked' }
  const reopen =
    t('panelReopen')
  if (Number.isNaN(id)) {
    return { kind: 'refused', message: t('panelNoValidPage', reopen) }
  }
  const tab = await getTab(id).catch(() => undefined)
  if (!tab || tab.id !== id) {
    return { kind: 'refused', message: t('panelPageClosed', reopen) }
  }
  if (typeof tab.url === 'string' && tab.url.startsWith(extensionBase)) {
    return {
      kind: 'refused',
      message: t('panelOwnPage', reopen),
    }
  }
  const own = await link.ownTabId().catch(() => undefined)
  let recorded: number | undefined
  if (own !== undefined) {
    for (let attempt = 0; attempt < LINK_ATTEMPTS; attempt += 1) {
      recorded = await link.recordedPage(own).catch(() => undefined)
      if (recorded !== undefined) break
      await link.wait(LINK_WAIT_MS)
    }
  }
  if (recorded !== id) {
    return {
      kind: 'refused',
      message: t('panelNotLinked', reopen),
    }
  }
  return { kind: 'bound', tabId: id }
}

let bound: number | null = null

/** Records the page tab for this panel document. `null` returns to the docked behaviour. */
export function setBoundTab(id: number | null): void {
  bound = id
}

/** The page tab this panel is bound to, or `null` in the docked sidebar. */
export function boundTab(): number | null {
  return bound
}

/**
 * Whether the panel offers screenshots. Screenshots are taken with
 * `tabs.captureVisibleTab`, which is believed to be missing on Firefox for
 * Android, and which photographs the tab in front, which would be the panel
 * itself while it is open in a tab. A panel bound to a page tab is the Android
 * layout, so it offers none.
 */
export function screenshotsAvailable(): boolean {
  return bound === null
}
