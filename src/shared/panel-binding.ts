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
 * Decides how the panel binds to a page tab, from its own query string.
 *
 * A bound panel is accepted only when the tab exists and is not a page of the
 * extension. `getTab` is `browser.tabs.get`; `extensionBase` is
 * `browser.runtime.getURL('')`.
 */
export async function resolveBinding(
  search: string,
  extensionBase: string,
  getTab: (id: number) => Promise<{ id?: number | undefined; url?: string | undefined }>,
): Promise<Binding> {
  const id = boundTabFromSearch(search)
  if (id === null) return { kind: 'docked' }
  const reopen =
    'Open Web Alchemist from the toolbar menu on the page that should be changed.'
  if (Number.isNaN(id)) {
    return { kind: 'refused', message: `This panel was opened without a valid page. ${reopen}` }
  }
  const tab = await getTab(id).catch(() => undefined)
  if (!tab || tab.id !== id) {
    return { kind: 'refused', message: `The page this panel was opened for is closed. ${reopen}` }
  }
  if (typeof tab.url === 'string' && tab.url.startsWith(extensionBase)) {
    return {
      kind: 'refused',
      message: `This panel cannot work on a page of Web Alchemist. ${reopen}`,
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
