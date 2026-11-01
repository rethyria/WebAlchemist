/**
 * The name of the port a sidebar holds open to the background.
 *
 * It carries the id of the browser window the sidebar belongs to, so the
 * background can discard only that window's previews when that sidebar closes.
 * Each window has its own sidebar, and a preview made from one must not be
 * removed because another window's panel was closed.
 */

const PREFIX = 'wa-sidebar'

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
