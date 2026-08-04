/**
 * Typed handle for the Manifest V3 `userScripts` API.
 *
 * `@types/firefox-webext-browser` still describes the Manifest V2 *legacy*
 * userScripts API. Firefox shipped a different MV3-only API under the same
 * namespace, and declaration-merging the correct shape onto the stale one
 * produces a hybrid that matches neither.
 *
 * So the real surface is declared here as its own interface and the namespace
 * is cast once, at this boundary. Everything downstream is fully typed.
 * Delete this file when the upstream types catch up.
 *
 * Signatures follow the MDN reference for the MV3 API.
 */

export type ExecutionWorld = 'USER_SCRIPT' | 'MAIN'

export interface UserScriptSource {
  code?: string
  file?: string
}

export interface Mv3RegisteredUserScript {
  id: string
  js: UserScriptSource[]
  matches?: string[]
  excludeMatches?: string[]
  includeGlobs?: string[]
  excludeGlobs?: string[]
  allFrames?: boolean
  runAt?: 'document_start' | 'document_end' | 'document_idle'
  world?: ExecutionWorld
  /** Only meaningful when world is USER_SCRIPT. Isolates this script's globals. */
  worldId?: string
}

export interface WorldProperties {
  /** Omit to configure the default USER_SCRIPT world. */
  worldId?: string
  /**
   * Content Security Policy for the world. This is the runtime enforcement
   * boundary on what injected code can connect to — see registry.ts.
   */
  csp?: string
  /** Whether scripts in this world may message the extension. */
  messaging?: boolean
}

export interface UserScriptFilter {
  ids?: string[]
}

export interface Mv3UserScriptsApi {
  register(scripts: Mv3RegisteredUserScript[]): Promise<void>
  update(scripts: Partial<Mv3RegisteredUserScript>[]): Promise<void>
  unregister(filter?: UserScriptFilter): Promise<void>
  getScripts(filter?: UserScriptFilter): Promise<Mv3RegisteredUserScript[]>
  configureWorld(properties: WorldProperties): Promise<void>
  resetWorldConfiguration(worldId?: string): Promise<void>
}

/**
 * Resolved on every call, never captured.
 *
 * `browser.userScripts` does not exist until the optional permission is
 * granted, and Firefox adds the namespace to the *already running* context at
 * the moment it is. Binding it once at module load therefore captured
 * `undefined` for the whole life of the background page: the first attempt to
 * run a script after the user granted permission failed on a namespace that
 * was, by then, genuinely present. It would start working only once the event
 * page happened to restart — which, given a 30 second idle timeout, looked
 * like an intermittent fault rather than a stale binding.
 */
function api(): Mv3UserScriptsApi {
  const namespace = (browser as unknown as { userScripts?: unknown }).userScripts
  if (!namespace) {
    throw new Error(
      'Firefox has not granted the user scripts permission, so no script can be registered.',
    )
  }
  return namespace as Mv3UserScriptsApi
}

export const userScripts: Mv3UserScriptsApi = {
  register: (scripts) => api().register(scripts),
  update: (scripts) => api().update(scripts),
  unregister: (filter) => api().unregister(filter),
  getScripts: (filter) => api().getScripts(filter),
  configureWorld: (properties) => api().configureWorld(properties),
  resetWorldConfiguration: (worldId) => api().resetWorldConfiguration(worldId),
}
