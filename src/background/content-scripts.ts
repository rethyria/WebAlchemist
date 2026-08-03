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

const SCRIPT_ID = 'wa-content'
const CONTENT_FILE = 'src/content/index.js'

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

/** Origins we currently hold, in content-script match-pattern form. */
async function grantedOrigins(): Promise<string[]> {
  const held = await browser.permissions.getAll()
  const origins = held.origins ?? []
  // <all_urls> and *://*/* are both possible if the user granted everything.
  return origins.filter((origin) => origin.includes('://'))
}

export async function reconcile(): Promise<{ registered: number }> {
  const origins = await grantedOrigins()

  // Unregister first and unconditionally. Registering over an existing id
  // throws, and after an update the platform's view and ours disagree.
  try {
    await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
  } catch {
    // Nothing was registered, which is the normal case on a fresh profile.
  }

  if (origins.length === 0) return { registered: 0 }

  const registration: Registration = {
    id: SCRIPT_ID,
    matches: origins,
    js: [CONTENT_FILE],
    // The picker needs a laid-out page to measure, and the health check needs
    // the DOM the site actually rendered rather than its first paint.
    runAt: 'document_idle',
    // Firefox persists these across browser restarts, but not across extension
    // updates — hence reconcile() on install as well.
    persistAcrossSessions: true,
  }

  try {
    await browser.scripting.registerContentScripts([
      registration as unknown as browser.scripting.RegisteredContentScript,
    ])
    return { registered: origins.length }
  } catch {
    // A malformed or unheld origin pattern rejects the whole call. Falling
    // back to no registration is right: the picker still works under
    // activeTab, so the user keeps a functioning extension rather than none.
    return { registered: 0 }
  }
}
