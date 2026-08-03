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
 * CSP IS THE ENFORCEMENT BOUNDARY, FOR THE PART IT COVERS
 * -------------------------------------------------------
 * Each transform gets its own world, and that world's Content Security Policy
 * is derived from the capabilities the transform declared. A transform that
 * did not declare `network` runs in a world that cannot open a connection at
 * all, so the request fails at runtime regardless of what static analysis or
 * the model reviewer concluded. That capability is not advisory.
 *
 * `storage` and `cookies` are. CSP has no directive for either, so there is no
 * world configuration that stops `localStorage.setItem` or `document.cookie`.
 * For those two, declaring is disclosure and the only real control is refusing
 * to save the code — which is what an undeclared use triggers, since
 * applyCapabilityPolicy raises it to `block`. See CAPABILITY_ENFORCEMENT.
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
 * TODO(verify): confirm empirically in Firefox that connect-src in a user
 * script world does block fetch/XHR/WebSocket/sendBeacon as expected. The API
 * documents per-world CSP configuration; the precise directive coverage should
 * be pinned down with a test page before this is relied on in a release.
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

/** Must be called from a user gesture; Firefox will not grant it otherwise. */
export async function requestUserScriptsPermission(): Promise<boolean> {
  return browser.permissions.request(USER_SCRIPTS_PERMISSION)
}

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
