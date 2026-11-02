/**
 * The file that holds the values of one elixir's settings, so that the values
 * can be shared or kept apart from the elixir.
 *
 * The file carries only values. It names the elixir and lists each setting's
 * key and type so that a value is applied only to a setting of the same key
 * and type. It never carries code, fields, a world, capabilities or a match
 * pattern, and reading it never changes any of them. Every value is checked
 * against the target elixir's own fields with the rules that the
 * set-config-values message uses.
 */

import { checkValueSet, effectiveValues } from './config'
import { t } from './i18n'
import type { ConfigFieldType, ConfigValue, Transform } from './types'

export const SETTINGS_FILE_FORMAT = 'web-alchemist-settings'
export const SETTINGS_FILE_VERSION = 1

/** The most settings that a file may list, so that a hostile file is not read at length. */
const MAX_FILE_KEYS = 100

export interface SettingsFile {
  format: typeof SETTINGS_FILE_FORMAT
  schemaVersion: number
  exportedAt: number
  /** The name of the elixir the values were written for. Shown to the user and never trusted. */
  elixir: { name: string }
  fields: { key: string; type: ConfigFieldType }[]
  values: Record<string, ConfigValue>
}

/** The file for an elixir: the effective value of every one of its settings. */
export function settingsFileFor(transform: Transform, now: number): SettingsFile {
  const fields = transform.configFields ?? []
  return {
    format: SETTINGS_FILE_FORMAT,
    schemaVersion: SETTINGS_FILE_VERSION,
    exportedAt: now,
    elixir: { name: transform.name },
    fields: fields.map((field) => ({ key: field.key, type: field.type })),
    values: effectiveValues(fields, transform.configValues),
  }
}

export interface SettingsImport {
  /** The values to store for this elixir, already validated. */
  values: Record<string, ConfigValue>
  applied: string[]
  /** Settings of this elixir whose value was refused, with the reason. */
  skipped: { key: string; problem: string }[]
  /** Keys in the file that this elixir has no setting for. They are ignored. */
  unknown: string[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads a settings file for one elixir. Throws when the file is not a settings
 * file. A value for a key that the elixir lacks is ignored and reported, a
 * value for a key whose type differs is skipped, and every other value is
 * checked with checkValueSet.
 */
export function readSettingsFile(file: unknown, transform: Transform): SettingsImport {
  if (
    !isObject(file) ||
    file.format !== SETTINGS_FILE_FORMAT ||
    typeof file.schemaVersion !== 'number' ||
    file.schemaVersion > SETTINGS_FILE_VERSION ||
    !isObject(file.values) ||
    Object.keys(file.values).length > MAX_FILE_KEYS
  ) {
    throw new Error(t('configFileNotSettings'))
  }
  const fields = transform.configFields ?? []
  const typeOfKey = new Map<string, unknown>()
  if (Array.isArray(file.fields)) {
    for (const entry of file.fields.slice(0, MAX_FILE_KEYS)) {
      if (isObject(entry) && typeof entry.key === 'string') typeOfKey.set(entry.key, entry.type)
    }
  }

  // No prototype, so a key named "__proto__" in the file is an ordinary key here.
  const candidate: Record<string, unknown> = Object.create(null)
  const mismatched: { key: string; problem: string }[] = []
  for (const key of Object.keys(file.values)) {
    const field = fields.find((f) => f.key === key)
    if (field && typeOfKey.has(key) && typeOfKey.get(key) !== field.type) {
      mismatched.push({ key, problem: t('configFileTypeDiffers') })
      continue
    }
    candidate[key] = file.values[key]
  }
  const set = checkValueSet(fields, candidate)
  return {
    values: set.values,
    applied: set.applied,
    skipped: [...mismatched, ...set.skipped],
    unknown: set.unknown,
  }
}
