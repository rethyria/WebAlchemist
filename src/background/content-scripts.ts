/**
 * Dynamic content script registration.
 *
 * The manifest declares no `content_scripts`. Doing so would require a host
 * permission at install time for every site the user might ever visit, which
 * is exactly the up-front grant this extension is built to avoid — permissions
 * are asked for one origin at a time, at the moment a transform is saved.
 *
 * The consequence is that registration has to be maintained by hand, and there
 * are three separate ways it can go stale:
 *
 *   1. The platform drops dynamic registrations on extension update, the same
 *      way it drops user scripts.
 *   2. A user can revoke a host permission at any time from about:addons, and
 *      a registration for an origin we no longer hold is an error on every
 *      navigation to it.
 *   3. A newly granted origin has no registration until one is added.
 *
 * `reconcile()` is the single answer to all three: it derives the correct set
 * from the permissions actually held right now and replaces whatever is
 * registered. It is called on install, on update, on startup, and on every
 * permission change.
 */

/*
 * One registration per granted origin, with an id made from the origin. A single
 * registration for all origins was rejected as a whole when one pattern was
 * malformed or no longer held, which left the content script registered for no
 * site at all: the health check, conflict detection and the persistent outline
 * stopped everywhere and nothing reported it (#96). With one registration each,
 * a rejected origin affects only itself.
 */
const SCRIPT_ID_PREFIX = 'wa-content'
const CONTENT_FILE = 'src/content/index.js'

/**
 * Where the origins that could not be registered are recorded, as a list in
 * storage.session. Nothing in the interface reads it yet.
 */
export const FAILED_ORIGINS_KEY = 'wa-content-failed-origins'

const idFor = (origin: string) => `${SCRIPT_ID_PREFIX}:${origin}`

/** The id the single registration used before there was one per origin. */
const isOurs = (id: string) => id === SCRIPT_ID_PREFIX || id.startsWith(`${SCRIPT_ID_PREFIX}:`)

/**
 * `scripting.registerContentScripts` is typed but the registration shape here
 * is narrow enough to state directly.
 */
interface Registration {
  id: string
  matches: string[]
  js: string[]
  runAt: 'document_idle'
  persistAcrossSessions?: boolean
}

/**
 * Patterns that mean every site, which are refused as registration targets.
 *
 * A blanket grant must not switch on injection everywhere. Screenshots ask for
 * `<all_urls>` because captureVisibleTab accepts nothing narrower, and that
 * grant should buy a screenshot — not a content script on every page the user
 * visits for as long as they hold it.
 *
 * This was previously a side effect rather than a decision: filtering on
 * `origin.includes('://')` happens to drop `<all_urls>`, which has no scheme
 * separator, while letting the scheme-wildcard form through unchallenged. The
 * right outcome for the case that exists today, by accident, and the wrong one
 * for the case sitting next to it.
 */
const ALL_SITES = new Set([
  '<all_urls>',
  '*://*/*',
  '*://*',
  'http://*/*',
  'https://*/*',
])

/** Origins we currently hold, in content-script match-pattern form. */
async function grantedOrigins(): Promise<string[]> {
  const held = await browser.permissions.getAll()
  const origins = held.origins ?? []
  return origins.filter((origin) => origin.includes('://') && !ALL_SITES.has(origin))
}

function registrationFor(origin: string): Registration {
  return {
    id: idFor(origin),
    matches: [origin],
    js: [CONTENT_FILE],
    // The picker needs a laid-out page to measure, and the health check needs
    // the DOM the site actually rendered rather than its first paint.
    runAt: 'document_idle',
    // Firefox persists these across browser restarts, but not across extension
    // updates — hence reconcile() on install as well.
    persistAcrossSessions: true,
  }
}

/*
 * Reconciliations run one at a time. They are started by install, update,
 * start-up and both permission events, which can overlap, and two that both
 * find an origin unregistered would both register it; the second call is
 * rejected for a duplicate id and would be recorded as a failure of the origin.
 */
let reconcileTail: Promise<unknown> = Promise.resolve()

export function reconcile(): Promise<{ registered: number; failed: string[] }> {
  const run = reconcileTail.then(reconcileNow)
  reconcileTail = run.catch(() => undefined)
  return run
}

async function reconcileNow(): Promise<{ registered: number; failed: string[] }> {
  const wanted = new Map((await grantedOrigins()).map((origin) => [idFor(origin), registrationFor(origin)]))
  const held = await registeredContentScripts()

  /*
   * Only what differs is changed. This runs on every start of the event page,
   * which is every 30-second idle period, and it used to remove the
   * registration before adding it again: a page that began loading in between
   * was given no content script, so the picker and the health check had
   * nothing to talk to on that load.
   */
  const stale = held.filter((script) => {
    const want = wanted.get(script.id)
    return !want || !sameRegistration(script, want)
  })
  if (stale.length > 0) {
    // Unregistered when a registration differs or is no longer wanted.
    // Registering over an existing id throws, and after an update the
    // platform's view and ours disagree.
    try {
      await browser.scripting.unregisterContentScripts({ ids: stale.map((script) => script.id) })
    } catch {
      // Already gone.
    }
  }

  const kept = new Set(held.filter((script) => !stale.includes(script)).map((script) => script.id))
  const failed: string[] = []
  for (const [id, registration] of wanted) {
    if (kept.has(id)) continue
    try {
      await browser.scripting.registerContentScripts([
        registration as unknown as browser.scripting.RegisteredContentScript,
      ])
    } catch {
      // A malformed or unheld origin pattern is rejected here. The picker still
      // works under activeTab, so the user keeps a functioning extension, and
      // the other origins are registered regardless.
      failed.push(registration.matches[0]!)
    }
  }

  await browser.storage.session.set({ [FAILED_ORIGINS_KEY]: failed })
  return { registered: wanted.size - failed.length, failed }
}

async function registeredContentScripts(): Promise<Registration[]> {
  try {
    const found = await browser.scripting.getRegisteredContentScripts()
    return ((found ?? []) as unknown as Registration[]).filter((script) => isOurs(script.id))
  } catch {
    return []
  }
}

function sameRegistration(held: Registration, wanted: Registration): boolean {
  const sorted = (list: string[] | undefined) => JSON.stringify([...(list ?? [])].sort())
  return (
    sorted(held.matches) === sorted(wanted.matches) &&
    sorted(held.js) === sorted(wanted.js) &&
    held.runAt === wanted.runAt &&
    held.persistAcrossSessions === wanted.persistAcrossSessions
  )
}
