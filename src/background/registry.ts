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

import type { Capability, Transform } from '@shared/types'
import { wrapTransform } from './harness'
import { userScripts, type ExecutionWorld, type Mv3RegisteredUserScript } from './userscripts-api'
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

function matchPatternsFor(transform: Transform): string[] {
  // Stored matches omit the scheme; register for http and https explicitly
  // rather than using *:// so that ftp: and file: are never included.
  const bare = transform.match.replace(/^\*:\/\//, '')
  return [`https://${bare}`, `http://${bare}`]
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
 * What should be registered for a transform, or null when nothing should be:
 * it is not JavaScript, is disabled, has no code, or is an AI-written script
 * while the kill switch is on.
 */
async function registrationFor(transform: Transform): Promise<Mv3RegisteredUserScript | null> {
  if (transform.kind !== 'js' || !transform.enabled || !transform.code) return null

  const settings = await getSettings()
  if (settings.aiJsKillSwitch && transform.origin === 'ai') return null

  const worldId = worldIdFor(transform)
  const world = transform.world ?? 'USER_SCRIPT'

  return {
    id: transform.id,
    matches: matchPatternsFor(transform),
    // Wrapped so the transform re-applies after framework re-renders.
    js: [{ code: wrapTransform(transform) }],
    world: world satisfies ExecutionWorld,
    ...(world === 'USER_SCRIPT' ? { worldId } : {}),
    runAt: 'document_idle',
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

export async function registerTransform(transform: Transform): Promise<void> {
  const registration = await registrationFor(transform)
  if (!registration) return

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
}

export async function unregisterTransform(id: string): Promise<void> {
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
 * blocked is removed. `keep` lists ids that have no stored transform but must
 * stay registered, namely preview scripts.
 */
export async function reregisterAll(
  keep: string[] = [],
): Promise<{ registered: number; skipped: number }> {
  if (!(await hasUserScriptsPermission())) {
    return { registered: 0, skipped: 0 }
  }

  const held = new Map<string, Mv3RegisteredUserScript>()
  try {
    for (const script of await userScripts.getScripts()) held.set(script.id, script)
  } catch {
    // Nothing readable, so every wanted script is registered below.
  }

  const transforms = await getAllTransforms()
  const wanted = new Set<string>()
  let registered = 0
  let skipped = 0

  for (const transform of transforms) {
    if (transform.kind !== 'js') continue
    try {
      const registration = await registrationFor(transform)
      if (!registration) continue
      wanted.add(transform.id)
      const current = held.get(transform.id)
      if (current && sameRegistration(current, registration)) {
        // The world's CSP is set again: it is cheap, leaves no gap, and a
        // changed capability list has to reach it.
        await configureWorldFor(transform)
      } else {
        await registerTransform(transform)
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

  return { registered, skipped }
}
