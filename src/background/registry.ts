/**
 * Registration of JS transforms with the userScripts API.
 *
 * TWO PLATFORM FACTS THIS MODULE EXISTS TO HANDLE
 * -----------------------------------------------
 * 1. `userScripts` is an optional permission in Firefox. It cannot be granted
 *    at install; it must be requested at runtime, and it can be revoked.
 * 2. Registered user scripts are WIPED on every extension update. They must be
 *    re-registered from storage on runtime.onInstalled with reason "update",
 *    or every JS transform silently stops working after an update — with no
 *    error, which is the worst possible failure mode.
 *
 * CSP IS NOT THE ENFORCEMENT BOUNDARY. IT WAS MEASURED AND IT IS NOT.
 * --------------------------------------------------------------------
 * This module used to claim that a transform which did not declare `network`
 * ran in a world that could not open a connection, and that the capability
 * was therefore not advisory. That was wrong, and it was wrong in the
 * direction that matters.
 *
 * Run against Firefox with `connect-src 'none'`, five of six egress methods
 * reached a listening server: fetch, XMLHttpRequest, sendBeacon, WebSocket
 * and EventSource. Only `new Image().src` was stopped, by `img-src`. The
 * world CSP is applied — flipping `img-src` opens exactly that one channel —
 * but `connect-src` does not bind these APIs here, and neither does
 * `default-src`. See `test/csp/README.md` for the run.
 *
 * So all three capabilities are disclosures, and the only real control over
 * any of them is refusing to save the code — which is what an undeclared use
 * triggers, since applyCapabilityPolicy raises it to `block`. See
 * CAPABILITY_ENFORCEMENT.
 *
 * The directives are still set. They cost nothing, `img-src` genuinely closes
 * the image-beacon channel, and a browser that starts honouring the rest
 * would tighten this without a code change. What is not still done is telling
 * the user that they are a boundary.
 */

import { excludePatternsFor } from '@shared/site-off'
import type { Capability, Transform } from '@shared/types'
import { parsePattern } from '@shared/match'
import { problemWithStoredCode } from './code-gate'
import { wrapTransform } from './harness'
import { userScripts, type ExecutionWorld, type Mv3RegisteredUserScript } from './userscripts-api'
import { getOffHosts } from './site-off'
import { getAllTransforms, getSettings } from './storage'

/** Worlds are per-transform so transforms cannot collide with each other. */
export function worldIdFor(transform: Transform): string {
  return `wa-${transform.id}`
}

/**
 * Builds the world CSP from declared capabilities.
 *
 * `script-src 'unsafe-inline'` is required for the injected script itself to
 * execute. Everything else starts closed and is opened only by an explicit,
 * user-approved declaration.
 *
 * Directive coverage was measured rather than assumed, which is how the
 * module header above came to be rewritten: `img-src` is honoured here,
 * `connect-src` and `default-src` are not. Nothing about this function
 * changed as a result — the strings were always right — but what may be
 * claimed about their effect did.
 */
export function cspForCapabilities(capabilities: Capability[]): string {
  const directives = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
  ]

  directives.push(
    capabilities.includes('network') ? 'connect-src https:' : "connect-src 'none'",
  )
  // Image loads are an exfiltration channel in their own right (`new Image().src`).
  directives.push(capabilities.includes('network') ? 'img-src *' : "img-src 'none'")

  return directives.join('; ')
}

/**
 * The match patterns a script is registered with, one per scheme it may run on.
 *
 * A transform saved on an https page is registered for https only. It used to
 * be registered for http as well, and on the plain-http version of a site the
 * page is whatever a network attacker serves, so the script ran against markup
 * the attacker chose. The scheme comes from the stored pattern: `https://` and
 * `http://` give that scheme, and `*://` gives both because the pattern says
 * so explicitly.
 *
 * A pattern with no scheme was stored before the scheme was recorded, and the
 * page it was saved on is not known. It is registered for both schemes, as it
 * was before, so that old transforms keep working, including those saved on an
 * http-only site such as local development. The scheme restriction applies from
 * the next save of the transform, which records the page's scheme. ftp: and
 * file: are never included, which is why the pattern is not passed through as
 * `*://`.
 */
export function matchPatternsFor(transform: Transform): string[] {
  const { scheme, host, path } = parsePattern(transform.match)
  const bares = pathsFor(path).map((variant) => `${host}${variant}`)
  const forScheme = (name: string) => bares.map((bare) => `${name}://${bare}`)
  switch (scheme) {
    case 'http':
      return forScheme('http')
    case '*':
      return [...forScheme('https'), ...forScheme('http')]
    case 'https':
      return forScheme('https')
    case undefined:
      return [...forScheme('https'), ...forScheme('http')]
  }
}

/**
 * The paths to register for one stored path, so that the script runs on the
 * same pages the CSS does (see matchesUrl).
 *
 * A browser match pattern compares the path together with the query string and
 * knows no trailing-slash rule, so the stored path is written out once per form
 * of the page: with and without a trailing slash, and, when the stored path has
 * no query, also with any query. A path with no query that ends in `*` already
 * covers all of these.
 */
function pathsFor(path: string): string[] {
  const query = path.indexOf('?')
  // Without a query, a path that ends in `*` already covers every form. With
  // one, `/search?q=*` does not cover `/search/?q=x`, which the CSS side
  // matches, so the trailing-slash form is written out too (#95).
  if (query === -1 && path.endsWith('*')) return [path]
  const base = query === -1 ? path : path.slice(0, query)
  const rest = query === -1 ? '' : path.slice(query)
  const trimmed = base.replace(/\/+$/, '')
  const forms = trimmed === '' ? ['/'] : [trimmed, `${trimmed}/`]
  return rest ? forms.map((form) => form + rest) : forms.flatMap((form) => [form, `${form}?*`])
}

/**
 * `@types/firefox-webext-browser` omits 'userScripts' from the
 * `OptionalPermission` union, and a union cannot be widened by declaration
 * merging. This is the one place the cast lives.
 */
export const USER_SCRIPTS_PERMISSION = {
  permissions: ['userScripts'],
} as unknown as browser.permissions.Permissions

export async function hasUserScriptsPermission(): Promise<boolean> {
  return browser.permissions.contains(USER_SCRIPTS_PERMISSION)
}

/*
 * There is deliberately no request helper here. Firefox will not grant an
 * optional permission unless the call happens while a user gesture is live,
 * and this module runs in the background script, which never has one. The
 * sidebar calls permissions.request() itself, from the click handler.
 */

/**
 * What should be registered for a transform. `registration` is null when
 * nothing should be: the transform is not JavaScript, is disabled, has no
 * code, is not wanted while the kill switch is on, or (unless
 * `skipAnalysis` is set) has code that no longer passes static analysis.
 * `blocked` is true only for the last case, so a caller can tell a script the
 * safety check refuses from one that is simply not wanted.
 *
 * Static analysis runs here, at registration, and not only when code is saved.
 * Registration happens on install, update, start-up, a settings change and an
 * import, all from stored code, and an analyser that was tightened after the
 * code was saved would otherwise never see it again.
 *
 * `skipAnalysis` is for the CSP probe alone, whose job is to attempt network
 * access and so cannot pass. The code it registers is fixed in this extension.
 */
async function registrationFor(
  transform: Transform,
  options: { skipAnalysis?: boolean } = {},
): Promise<{ registration: Mv3RegisteredUserScript | null; blocked: boolean }> {
  const none = { registration: null, blocked: false }
  if (transform.kind !== 'js' || !transform.enabled || !transform.code) return none
  // Restored code that the user has not approved never runs, whatever its
  // enabled flag says (#124).
  if (transform.awaitsApproval) return none

  const settings = await getSettings()
  // The switch covers hand-written scripts too: the user's own code can break
  // a page as much as the model's, and a switch that leaves some JavaScript
  // running cannot be relied on as the way to stop all of it.
  if (settings.aiJsKillSwitch) return none

  if (!options.skipAnalysis && problemWithStoredCode(transform, settings) !== null) {
    return { registration: null, blocked: true }
  }

  const offHosts = await getOffHosts()
  const worldId = worldIdFor(transform)
  const world = transform.world ?? 'USER_SCRIPT'

  return {
    registration: {
      id: transform.id,
      matches: matchPatternsFor(transform),
      // The per-site off switch. The registration stays, so that turning the site
      // back on needs no re-registration of anything else.
      ...(offHosts.length > 0 ? { excludeMatches: excludePatternsFor(offHosts) } : {}),
      // Wrapped so the transform re-applies after framework re-renders.
      js: [{ code: wrapTransform(transform) }],
      world: world satisfies ExecutionWorld,
      ...(world === 'USER_SCRIPT' ? { worldId } : {}),
      runAt: 'document_idle',
    },
    blocked: false,
  }
}

async function configureWorldFor(transform: Transform): Promise<void> {
  if ((transform.world ?? 'USER_SCRIPT') !== 'USER_SCRIPT') return
  await userScripts.configureWorld({
    worldId: worldIdFor(transform),
    csp: cspForCapabilities(transform.capabilities),
    // Transforms have no reason to talk back to the extension. Leaving this
    // off removes a channel rather than leaving one open unused.
    messaging: false,
  })
}

/**
 * Registers a script so it runs on matching pages. Returns false when the
 * script was left unregistered on purpose (see registrationFor). A script that
 * fails static analysis is unregistered rather than skipped, because a
 * registration made earlier would still be running.
 */
async function registerTransformNow(
  transform: Transform,
  options: { skipAnalysis?: boolean } = {},
): Promise<boolean> {
  const { registration, blocked } = await registrationFor(transform, options)
  if (!registration) {
    if (blocked) await unregisterTransformNow(transform.id)
    return false
  }

  if (!(await hasUserScriptsPermission())) {
    throw new Error(
      'Running JavaScript transforms needs an extra permission. Grant it from the sidebar.',
    )
  }

  await configureWorldFor(transform)

  const existing = await userScripts.getScripts({ ids: [transform.id] })
  if (existing.length > 0) {
    await userScripts.update([registration])
  } else {
    await userScripts.register([registration])
  }
  return true
}

/**
 * The registration id a preview of the transform `id` uses.
 *
 * "Change with AI", "Edit description" and "Repair" keep the saved id on the
 * draft, so a preview registered under that id replaced the saved transform's
 * own registration, and clearing the preview then unregistered it. Discarding
 * an edit therefore switched off code the user had approved. A separate id
 * means clearing a preview removes only the preview's own registration.
 *
 * The saved registration is paused while a preview runs and registered again
 * from storage when the preview is cleared (see registerPreview and
 * unregisterPreview). Leaving it registered would run the saved script and the
 * preview on the same reload, so the page would show the combined effect of
 * both rather than the effect of the edit being judged.
 *
 * Pausing is safe if the background is suspended before the preview is
 * cleared: the background registers every saved transform from storage each
 * time it starts (reregisterAll), which also removes the leftover preview.
 */
export function previewIdFor(id: string): string {
  return `preview-${id}`
}

/**
 * Registers a draft under its preview id and pauses the saved registration it
 * edits, so only one of the two runs. Pausing an id that is not registered
 * (a new transform) does nothing.
 */
async function registerPreviewNow(transform: Transform): Promise<void> {
  // The kill switch wins over a preview. A preview is still code running on a
  // real page, and the switch exists to stop that. The alternative, running it because the user asked, was
  // rejected: a setting that a button next to the code can bypass is not a
  // kill switch. The refusal is thrown, and not returned silently, because
  // registerTransformNow returns without registering in this case and the caller
  // would then report a run that never happened. It is checked before the saved
  // registration is paused, so a refused preview changes nothing.
  const settings = await getSettings()
  if (settings.aiJsKillSwitch) {
    throw new Error(
      'Running transforms is switched off in the settings, so the JavaScript was not run. Turn that setting off to run it.',
    )
  }
  await unregisterTransformNow(transform.id)
  try {
    await registerPreviewScript(transform)
  } catch (cause) {
    // The saved script was paused above. A preview that fails to register
    // would otherwise leave it paused with nothing running in its place, and
    // the caller, which only records the preview after this returns, would
    // not know to restore it.
    await unregisterPreviewNow(transform.id).catch(() => {})
    throw cause
  }
}

async function registerPreviewScript(transform: Transform): Promise<void> {
  // `enabled` is forced on because the saved record's flag describes the saved
  // script, not the question being asked, which is whether to run this draft
  // now. The draft copies the saved flag, and registerTransformNow returns
  // without registering a disabled transform, so a preview of a disabled
  // script reloaded the page and ran nothing. The saved record is not changed.
  //
  // registerTransformNow returns false, and registers nothing, when static
  // analysis refuses the code. A preview that was refused has to fail here:
  // returning normally would let the caller reload the page and report a run
  // that never happened.
  const registered = await registerTransformNow({
    ...transform,
    enabled: true,
    id: previewIdFor(transform.id),
  })
  if (!registered) {
    throw new Error('This code did not pass the safety check, so it was not run.')
  }
}

/**
 * Removes the preview registration of `id`, then registers the saved
 * transform again from storage if it is stored and enabled. The stored record
 * is read here, not kept from when the preview started, so a save made while
 * the preview was running is the version that comes back.
 */
async function unregisterPreviewNow(id: string): Promise<void> {
  await unregisterTransformNow(previewIdFor(id))
  const saved = (await getAllTransforms()).find((t) => t.id === id)
  if (saved) await registerTransformNow(saved)
}

async function unregisterTransformNow(id: string): Promise<void> {
  if (!(await hasUserScriptsPermission())) return
  try {
    await userScripts.unregister({ ids: [id] })
  } catch {
    // Already gone — unregistering something absent is not an error worth raising.
  }
}

/** Whether a registration the browser holds is the one that would be made now. */
function sameRegistration(held: Mv3RegisteredUserScript, wanted: Mv3RegisteredUserScript): boolean {
  const code = (r: Mv3RegisteredUserScript) => (r.js ?? []).map((source) => source.code ?? source.file)
  return (
    JSON.stringify(held.matches ?? []) === JSON.stringify(wanted.matches ?? []) &&
    JSON.stringify(held.excludeMatches ?? []) === JSON.stringify(wanted.excludeMatches ?? []) &&
    JSON.stringify(code(held)) === JSON.stringify(code(wanted)) &&
    (held.world ?? 'USER_SCRIPT') === (wanted.world ?? 'USER_SCRIPT') &&
    held.worldId === wanted.worldId &&
    held.runAt === wanted.runAt
  )
}

/**
 * Brings the registrations in line with storage by changing only what differs.
 *
 * Called on install, on update (where the platform has wiped registrations),
 * on every start of the background page, and whenever the kill switch or the
 * set of transforms changes.
 *
 * This used to unregister everything and register the stored scripts again.
 * The background page starts again after every 30-second idle period, and each
 * start left a gap in which a page that was loading received no scripts, and
 * removed the registration of a script that was being previewed. Now a
 * registration that already matches is left alone, one that differs is updated,
 * a missing one is added, and one for a transform that is deleted, disabled or
 * blocked is removed. `previewed` lists the saved ids that have a preview
 * running: the preview registration (`previewIdFor(id)`) stays registered, and
 * the saved registration stays paused, as registerPreview left them.
 *
 * A preview is still code that runs on real pages, so the kill switch and the
 * per-site off switch apply to it (#121). With the kill switch on, every
 * preview registration is removed and its id is returned in `endedPreviews`,
 * for the caller to take off the previewed list; nothing is registered in its
 * place, because the saved script is not allowed to run either. With sites
 * off, the preview registration is updated with the new `excludeMatches`, and
 * the unsaved code is kept for the sites that remain on.
 */
async function reregisterAllNow(
  previewed: string[] = [],
): Promise<{ registered: number; skipped: number; endedPreviews: string[] }> {
  if (!(await hasUserScriptsPermission())) {
    return { registered: 0, skipped: 0, endedPreviews: [] }
  }

  const held = new Map<string, Mv3RegisteredUserScript>()
  try {
    for (const script of await userScripts.getScripts()) held.set(script.id, script)
  } catch {
    // Nothing readable, so every wanted script is registered below.
  }

  const transforms = await getAllTransforms()
  const killed = (await getSettings()).aiJsKillSwitch
  const endedPreviews = killed ? [...previewed] : []
  const keep = killed ? [] : previewed.map(previewIdFor)
  if (!killed) {
    const offHosts = await getOffHosts()
    for (const id of keep) {
      const preview = held.get(id)
      if (!preview) continue
      const excludeMatches = offHosts.length > 0 ? excludePatternsFor(offHosts) : undefined
      if (JSON.stringify(preview.excludeMatches ?? []) === JSON.stringify(excludeMatches ?? [])) continue
      const { excludeMatches: _old, ...rest } = preview
      try {
        await userScripts.update([{ ...rest, ...(excludeMatches ? { excludeMatches } : {}) }])
      } catch {
        // A preview that cannot be updated is removed rather than left running
        // on a site that is now off.
        await userScripts.unregister({ ids: [id] }).catch(() => {})
      }
    }
  }
  const wanted = new Set<string>()
  let registered = 0
  let skipped = 0

  for (const transform of transforms) {
    if (transform.kind !== 'js') continue
    if (!killed && previewed.includes(transform.id)) continue
    try {
      const { registration, blocked } = await registrationFor(transform)
      if (!registration) {
        if (blocked) skipped += 1
        continue
      }
      wanted.add(transform.id)
      const current = held.get(transform.id)
      if (current && sameRegistration(current, registration)) {
        // The world's CSP is set again: it is cheap, leaves no gap, and a
        // changed capability list has to reach it.
        await configureWorldFor(transform)
      } else {
        await registerTransformNow(transform)
      }
      registered += 1
    } catch {
      skipped += 1
    }
  }

  const stale = [...held.keys()].filter((id) => !wanted.has(id) && !keep.includes(id))
  if (stale.length > 0) {
    try {
      await userScripts.unregister({ ids: stale })
    } catch {
      // Already gone.
    }
  }

  return { registered, skipped, endedPreviews }
}

/*
 * Every change to the registered user scripts goes through one queue (#122).
 *
 * The permission listener, the save handlers, the preview handlers and the
 * start-up pass all register scripts, and registerTransform reads what is
 * registered and then registers or updates, which is not one step. Two of them
 * running at once could both see the script as absent and both register it, and
 * the second call fails. The functions that call each other (a preview pauses
 * the saved script and registers its own) use the unqueued versions, so a call
 * made while holding the queue never waits for the queue.
 */
let registrationQueue: Promise<unknown> = Promise.resolve()

function queued<T>(work: () => Promise<T>): Promise<T> {
  // A failed change must not stop the ones behind it.
  const result = registrationQueue.then(work, work)
  registrationQueue = result.catch(() => undefined)
  return result
}

export const registerTransform = (
  transform: Transform,
  options: { skipAnalysis?: boolean } = {},
): Promise<boolean> => queued(() => registerTransformNow(transform, options))
export const unregisterTransform = (id: string): Promise<void> => queued(() => unregisterTransformNow(id))
export const registerPreview = (transform: Transform): Promise<void> =>
  queued(() => registerPreviewNow(transform))
export const unregisterPreview = (id: string): Promise<void> => queued(() => unregisterPreviewNow(id))
export const reregisterAll = (
  previewed: string[] = [],
): Promise<{ registered: number; skipped: number; endedPreviews: string[] }> =>
  queued(() => reregisterAllNow(previewed))
