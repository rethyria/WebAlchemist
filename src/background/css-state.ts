/**
 * What this extension has injected into each tab, kept in `storage.session`.
 *
 * `scripting.removeCSS` matches on the exact string that was inserted, so the
 * string has to be kept for as long as the stylesheet is in the page. It used
 * to be kept in module-level maps. Firefox suspends the event page after 30
 * seconds without activity and a suspension discards those maps, while the
 * stylesheets stay in the page. After that, disabling, deleting or editing a
 * transform, or discarding a preview, had no string to remove and left the old
 * CSS on screen.
 *
 * `storage.session` is used rather than `storage.local` because the injected
 * CSS does not outlive the browser session either: a restart loads every page
 * afresh. It also never reaches the disk.
 *
 * One key per tab and kind, so that writing one tab's entry never overwrites a
 * concurrent write for another tab, which a single shared object would.
 */

export type CssKind = 'applied' | 'preview'

const PREFIX = 'wa-css-'
const SCRIPTS_KEY = 'wa-preview-scripts'

const keyFor = (kind: CssKind, tabId: number) => `${PREFIX}${kind}-${tabId}`

export async function readCss(kind: CssKind, tabId: number): Promise<string | undefined> {
  const key = keyFor(kind, tabId)
  const stored = await browser.storage.session.get(key)
  const value = stored[key]
  return typeof value === 'string' ? value : undefined
}

export async function writeCss(kind: CssKind, tabId: number, css: string): Promise<void> {
  await browser.storage.session.set({ [keyFor(kind, tabId)]: css })
}

export async function forgetCss(kind: CssKind, tabId: number): Promise<void> {
  await browser.storage.session.remove(
    kind === 'preview' ? [keyFor(kind, tabId), previewWindowKey(tabId)] : keyFor(kind, tabId),
  )
}

/*
 * Which browser window's sidebar made each preview. Every window has its own
 * sidebar, and closing one must discard only the previews that sidebar made. A
 * preview with no recorded window has no sidebar that owns it, so only the
 * start-up cleanup and the closing of a sidebar that names no window remove it.
 */
const previewWindowKey = (tabId: number) => `wa-preview-window-${tabId}`
const scriptWindowKey = (id: string) => `wa-preview-script-window-${id}`

export async function writePreviewWindow(tabId: number, windowId: number | undefined): Promise<void> {
  if (windowId !== undefined) await browser.storage.session.set({ [previewWindowKey(tabId)]: windowId })
}

export async function previewWindow(tabId: number): Promise<number | undefined> {
  const value = (await browser.storage.session.get(previewWindowKey(tabId)))[previewWindowKey(tabId)]
  return typeof value === 'number' ? value : undefined
}

export async function previewScriptWindow(id: string): Promise<number | undefined> {
  const value = (await browser.storage.session.get(scriptWindowKey(id)))[scriptWindowKey(id)]
  return typeof value === 'number' ? value : undefined
}

/** Tab ids that hold a suspension record, so a closing sidebar can lift them. */
export async function suspendedTabIds(): Promise<number[]> {
  const stored = await browser.storage.session.get(null)
  return Object.keys(stored)
    .filter((key) => key.startsWith('wa-suspended-'))
    .map((key) => Number(key.slice('wa-suspended-'.length)))
    .filter(Number.isInteger)
}

/** Tab ids that currently hold a preview stylesheet. */
export async function previewedTabIds(): Promise<number[]> {
  const stored = await browser.storage.session.get(null)
  const prefix = `${PREFIX}preview-`
  return Object.keys(stored)
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(key.slice(prefix.length)))
    .filter(Number.isInteger)
}

/*
 * Registered preview scripts are not tied to a tab. A registration applies to
 * every matching page until it is removed, so it is stored on its own and is
 * not discarded when a tab navigates or closes.
 */
export async function previewedScriptIds(): Promise<string[]> {
  const stored = await browser.storage.session.get(SCRIPTS_KEY)
  const value = stored[SCRIPTS_KEY]
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export async function addPreviewedScript(id: string, windowId?: number): Promise<void> {
  const ids = await previewedScriptIds()
  if (!ids.includes(id)) await browser.storage.session.set({ [SCRIPTS_KEY]: [...ids, id] })
  if (windowId !== undefined) await browser.storage.session.set({ [scriptWindowKey(id)]: windowId })
}

export async function removePreviewedScript(id: string): Promise<void> {
  const ids = await previewedScriptIds()
  await browser.storage.session.set({ [SCRIPTS_KEY]: ids.filter((existing) => existing !== id) })
  await browser.storage.session.remove(scriptWindowKey(id))
}

/*
 * The transform the sidebar has paused on a tab while the user edits a preview
 * of it. It is stored for the same reason the CSS strings are: any later
 * evaluation of the tab (a route change, a save, a toggle) recomputes the full
 * enabled set, and without a record of the pause the paused version reappears
 * under the preview.
 */
const SUSPENDED_PREFIX = 'wa-suspended-'

export async function readSuspended(tabId: number): Promise<string | undefined> {
  const key = `${SUSPENDED_PREFIX}${tabId}`
  const value = (await browser.storage.session.get(key))[key]
  return typeof value === 'string' ? value : undefined
}

/*
 * The window whose sidebar paused the transform, stored with the pause as a
 * preview's window is. Looking up the tab's window when the sidebar closes
 * gives the wrong answer for a tab that was moved to another window after the
 * pause, and a closed tab has no window to look up at all.
 */
const pauseWindowKey = (tabId: number) => `wa-pause-window-${tabId}`

export async function writeSuspended(
  tabId: number,
  id: string,
  windowId?: number,
): Promise<void> {
  await browser.storage.session.set({ [`${SUSPENDED_PREFIX}${tabId}`]: id })
  if (windowId !== undefined) await browser.storage.session.set({ [pauseWindowKey(tabId)]: windowId })
}

export async function suspendedWindow(tabId: number): Promise<number | undefined> {
  const value = (await browser.storage.session.get(pauseWindowKey(tabId)))[pauseWindowKey(tabId)]
  return typeof value === 'number' ? value : undefined
}

export async function forgetSuspended(tabId: number): Promise<void> {
  await browser.storage.session.remove([`${SUSPENDED_PREFIX}${tabId}`, pauseWindowKey(tabId)])
}

/*
 * Previews that belong to a document the tab has left but may return to. A page
 * restored from the back-forward cache comes back exactly as it was, with the
 * preview's stylesheet still in it, so the string that removes it has to be
 * kept for as long as that document can come back. The string is filed under
 * the URL the document had when the tab left it, and handed back when a
 * forward_back navigation commits that URL.
 *
 * Matching by URL is an approximation: two documents with the same URL in one
 * tab's history share an entry, and the newer one wins. It is cheaper than
 * tracking the browser's own history entries, which an extension cannot read.
 */
const ARCHIVE_PREFIX = 'wa-preview-archive-'
const ARCHIVE_LIMIT = 5

export interface ArchivedPreview {
  url: string
  css: string
  windowId?: number | undefined
}

async function readArchive(tabId: number): Promise<ArchivedPreview[]> {
  const key = `${ARCHIVE_PREFIX}${tabId}`
  const value = (await browser.storage.session.get(key))[key]
  return Array.isArray(value) ? (value as ArchivedPreview[]) : []
}

/** Files `css` under `url`, replacing an earlier entry for the same URL. */
export async function archivePreview(tabId: number, entry: ArchivedPreview): Promise<void> {
  const kept = (await readArchive(tabId)).filter((existing) => existing.url !== entry.url)
  await browser.storage.session.set({
    [`${ARCHIVE_PREFIX}${tabId}`]: [...kept, entry].slice(-ARCHIVE_LIMIT),
  })
}

/** Removes and returns the entry filed under `url`, if there is one. */
export async function takeArchivedPreview(
  tabId: number,
  url: string,
): Promise<ArchivedPreview | undefined> {
  const all = await readArchive(tabId)
  const found = all.find((entry) => entry.url === url)
  if (!found) return undefined
  await browser.storage.session.set({
    [`${ARCHIVE_PREFIX}${tabId}`]: all.filter((entry) => entry !== found),
  })
  return found
}

export async function forgetArchive(tabId: number): Promise<void> {
  await browser.storage.session.remove(`${ARCHIVE_PREFIX}${tabId}`)
}
