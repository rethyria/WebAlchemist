/**
 * The editing state of the settings form, without the page, so that its rules
 * can be tested. The form edits a draft: a copy of the effective values in
 * which a number is held as the text in the box, so that a half-typed number
 * is not lost. Nothing here is stored; saving goes through the background,
 * which validates every value again.
 */

import { stableJson, validateValue } from './config'
import type { ConfigField, ConfigValue } from './types'

// The type is loose because one object holds the draft of every kind of field.
// Each field is checked with validateValue before anything is saved.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Draft = Record<string, any>

/** A draft from values, falling back to each field's default. */
export function makeDraft(fields: readonly ConfigField[], values: Record<string, ConfigValue>): Draft {
  const draft: Draft = {}
  for (const field of fields) {
    const value = values[field.key] ?? field.default
    draft[field.key] =
      field.type === 'number'
        ? String(value)
        : field.type === 'list'
          ? [...(value as string[])]
          : field.type === 'table'
            ? (value as Record<string, string>[]).map((row) => ({ ...row }))
            : value
  }
  return draft
}

/** A draft of the defaults. */
export function defaultDraft(fields: readonly ConfigField[]): Draft {
  return makeDraft(fields, Object.fromEntries(fields.map((field) => [field.key, field.default])))
}

/** The value of one field as the rules see it. */
export function draftValue(field: ConfigField, draft: Draft): unknown {
  const held = draft[field.key]
  if (field.type === 'number') {
    const text = String(held ?? '').trim()
    return text === '' ? Number.NaN : Number(text)
  }
  return held
}

/** The problem with each field's current value, or null where it is fine. */
export function draftProblems(fields: readonly ConfigField[], draft: Draft): Record<string, string | null> {
  return Object.fromEntries(
    fields.map((field) => {
      const checked = validateValue(field, draftValue(field, draft))
      return [field.key, checked.ok ? null : checked.problem]
    }),
  )
}

/**
 * What to send to the background: the values that differ from their defaults,
 * and the keys that are back at their default, which removes the stored value.
 * Null when any value is not valid.
 */
export function draftChanges(
  fields: readonly ConfigField[],
  draft: Draft,
): { set: Record<string, ConfigValue>; reset: string[] } | null {
  const set: Record<string, ConfigValue> = {}
  const reset: string[] = []
  for (const field of fields) {
    const checked = validateValue(field, draftValue(field, draft))
    if (!checked.ok) return null
    if (stableJson(checked.value) === stableJson(field.default)) reset.push(field.key)
    else set[field.key] = checked.value
  }
  return { set, reset }
}

export function addItem(draft: Draft, key: string): void {
  ;(draft[key] as string[]).push('')
}

export function addRow(field: ConfigField, draft: Draft): void {
  ;(draft[field.key] as Record<string, string>[]).push(
    Object.fromEntries((field.columns ?? []).map((column) => [column.key, ''])),
  )
}

/** Removes one line of a list or one row of a table. */
export function removeAt(draft: Draft, key: string, index: number): void {
  ;(draft[key] as unknown[]).splice(index, 1)
}
