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

export async function registerTransform(transform: Transform): Promise<void> {
  if (transform.kind !== 'js' || !transform.enabled || !transform.code) return

  const settings = await getSettings()
  if (settings.aiJsKillSwitch && transform.origin === 'ai') return

  if (!(await hasUserScriptsPermission())) {
    throw new Error(
      'Running JavaScript transforms needs an extra permission. Grant it from the sidebar.',
    )
  }

  const worldId = worldIdFor(transform)
  const world = transform.world ?? 'USER_SCRIPT'

  if (world === 'USER_SCRIPT') {
    await userScripts.configureWorld({
      worldId,
      csp: cspForCapabilities(transform.capabilities),
      // Transforms have no reason to talk back to the extension. Leaving this
      // off removes a channel rather than leaving one open unused.
      messaging: false,
    })
  }

  const registration: Mv3RegisteredUserScript = {
    id: transform.id,
    matches: matchPatternsFor(transform),
    // Wrapped so the transform re-applies after framework re-renders.
    js: [{ code: wrapTransform(transform) }],
    world: world satisfies ExecutionWorld,
    ...(world === 'USER_SCRIPT' ? { worldId } : {}),
    runAt: 'document_idle',
  }

  const existing = await userScripts.getScripts({ ids: [transform.id] })
  if (existing.length > 0) {
    await userScripts.update([registration])
  } else {
    await userScripts.register([registration])
  }
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
export async function registerPreview(transform: Transform): Promise<void> {
  // The kill switch wins over a preview. A preview of model-written code is
  // still model-written code running on a real page, and the switch exists to
  // stop that. The alternative, running it because the user asked, was
  // rejected: a setting that a button next to the code can bypass is not a
  // kill switch. The refusal is thrown, and not returned silently, because
  // registerTransform returns without registering in this case and the caller
  // would then report a run that never happened. It is checked before the saved
  // registration is paused, so a refused preview changes nothing.
  const settings = await getSettings()
  if (settings.aiJsKillSwitch && transform.origin === 'ai') {
    throw new Error(
      'JavaScript written by the model is switched off in the settings, so it was not run. Turn that setting off to run it.',
    )
  }
  await unregisterTransform(transform.id)
  try {
    await registerPreviewScript(transform)
  } catch (cause) {
    // The saved script was paused above. A preview that fails to register
    // would otherwise leave it paused with nothing running in its place, and
    // the caller, which only records the preview after this returns, would
    // not know to restore it.
    await unregisterPreview(transform.id).catch(() => {})
    throw cause
  }
}

async function registerPreviewScript(transform: Transform): Promise<void> {
  // `enabled` is forced on because the saved record's flag describes the saved
  // script, not the question being asked, which is whether to run this draft
  // now. The draft copies the saved flag, and registerTransform returns
  // without registering a disabled transform, so a preview of a disabled
  // script reloaded the page and ran nothing. The saved record is not changed.
  await registerTransform({ ...transform, enabled: true, id: previewIdFor(transform.id) })
}

/**
 * Removes the preview registration of `id`, then registers the saved
 * transform again from storage if it is stored and enabled. The stored record
 * is read here, not kept from when the preview started, so a save made while
 * the preview was running is the version that comes back.
 */
export async function unregisterPreview(id: string): Promise<void> {
  await unregisterTransform(previewIdFor(id))
  const saved = (await getAllTransforms()).find((t) => t.id === id)
  if (saved) await registerTransform(saved)
}

export async function unregisterTransform(id: string): Promise<void> {
  if (!(await hasUserScriptsPermission())) return
  try {
    await userScripts.unregister({ ids: [id] })
  } catch {
    // Already gone — unregistering something absent is not an error worth raising.
  }
}

/**
 * Rebuilds every registration from storage.
 *
 * Called on install, on update (where the platform has wiped registrations),
 * and whenever the kill switch or a transform's enabled state changes.
 */
export async function reregisterAll(): Promise<{ registered: number; skipped: number }> {
  if (!(await hasUserScriptsPermission())) {
    return { registered: 0, skipped: 0 }
  }

  // Clear first so deleted or disabled transforms do not linger.
  try {
    await userScripts.unregister({})
  } catch {
    // No registrations to clear.
  }

  const transforms = await getAllTransforms()
  let registered = 0
  let skipped = 0

  for (const transform of transforms) {
    if (transform.kind !== 'js') continue
    try {
      await registerTransform(transform)
      registered += 1
    } catch {
      skipped += 1
    }
  }

  return { registered, skipped }
}
