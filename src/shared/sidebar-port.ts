/**
 * The name of the port a sidebar holds open to the background.
 *
 * It carries the id of the browser window the sidebar belongs to, so the
 * background can discard only that window's previews when that sidebar closes.
 * Each window has its own sidebar, and a preview made from one must not be
 * removed because another window's panel was closed.
 */

const PREFIX = 'wa-sidebar'
const PANEL_PREFIX = `${PREFIX}:tab:`

export function sidebarPortName(windowId: number | undefined): string {
  return windowId === undefined ? PREFIX : `${PREFIX}:${windowId}`
}

/** True for a sidebar port with or without a window id. */
export function isSidebarPortName(name: string): boolean {
  return name === PREFIX || name.startsWith(`${PREFIX}:`)
}

/** The window id in a sidebar port's name, or undefined when it carries none. */
export function windowOfSidebarPort(name: string): number | undefined {
  const id = Number(name.slice(PREFIX.length + 1))
  return name.startsWith(`${PREFIX}:`) && Number.isInteger(id) ? id : undefined
}

/**
 * The port of a panel that is open in a tab (Firefox for Android). It carries
 * the panel's own tab id instead of the window id, because one window can hold
 * several panel tabs and closing one must not clean up another's run.
 */
export function panelPortName(panelTabId: number): string {
  return `${PANEL_PREFIX}${panelTabId}`
}

/**
 * The key under which previews, pauses and run tabs are recorded for an owner.
 * A window's sidebar is keyed by the window id, which is positive. A panel tab
 * is keyed by the negative of its tab id, so the two cannot be confused and the
 * stored values stay numbers.
 */
export function panelOwner(panelTabId: number): number {
  return -panelTabId
}

/**
 * The owner key in a sidebar port's name: the window id for a docked sidebar,
 * the panel owner key for a panel tab, and undefined when the name carries
 * neither.
 */
export function ownerOfSidebarPort(name: string): number | undefined {
  if (name.startsWith(PANEL_PREFIX)) {
    const id = Number(name.slice(PANEL_PREFIX.length))
    return Number.isInteger(id) && id > 0 ? panelOwner(id) : undefined
  }
  return windowOfSidebarPort(name)
}
