/**
 * Finds the top-level settings that differ between two copies, so the sidebar
 * can send only those as one patch-settings change (#85). Sending the whole
 * object would carry back every value the sidebar loaded earlier and overwrite a
 * change made on the settings page since.
 */

import type { Settings, SettingsFields } from './types'

/** The settings a page may set one at a time; the same list as SettingsFields. */
export const FIELD_KEYS = [
  'activeProviderId',
  'healthCheckMode',
  'accent',
  'keepScreenshotPermission',
  'aiJsKillSwitch',
  'vaultIdleLockMinutes',
] as const satisfies readonly (keyof SettingsFields)[]

/** The fields of `next` that differ from `current`. Empty when nothing changed. */
export function changedFields(current: Settings, next: Settings): SettingsFields {
  const fields: Record<string, unknown> = {}
  for (const key of FIELD_KEYS) {
    if (next[key] !== current[key]) fields[key] = next[key]
  }
  return fields as SettingsFields
}
