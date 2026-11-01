/**
 * Per-tab ordering for work that changes what is inserted into a page.
 *
 * Applying CSS reads the string stored for the tab, removes that stylesheet,
 * inserts the new one and stores the new string, as separate awaited steps.
 * Two of those running for one tab at the same time both read the same
 * previous string, so one stylesheet ends up in the page that no stored string
 * refers to, and nothing can remove it afterwards. Route changes make this
 * easy to reach: a page that calls pushState and then replaceState fires two
 * events within the same moment, and a save or a toggle can arrive while a
 * route change is still being applied.
 *
 * Everything that reads or writes a tab's stored CSS therefore runs through
 * one chain per tab. The chain is in memory: a task cannot outlive a
 * suspension, so there is nothing for a stored chain to protect.
 */

const tails = new Map<number, Promise<unknown>>()

/** Runs `task` after every earlier task for this tab, and returns its result. */
export function inTabQueue<T>(tabId: number, task: () => Promise<T>): Promise<T> {
  const run = (tails.get(tabId) ?? Promise.resolve()).then(task)
  // A task that throws must not stop later tasks from running.
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  tails.set(tabId, tail)
  void tail.then(() => {
    if (tails.get(tabId) === tail) tails.delete(tabId)
  })
  return run
}

/*
 * Which document each tab is showing, as a counter that increases when a new
 * document commits. A task queued for the old document checks it before it
 * touches the page: by then insertCSS would add a stylesheet to the new
 * document and store a string that describes the old one. The new document
 * gets its own evaluation, so skipping the old task loses nothing.
 */
const documents = new Map<number, number>()

export function documentOf(tabId: number): number {
  return documents.get(tabId) ?? 0
}

export function startDocument(tabId: number): void {
  documents.set(tabId, documentOf(tabId) + 1)
}

export function forgetTab(tabId: number): void {
  documents.delete(tabId)
}
