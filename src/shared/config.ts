/**
 * The rules for the settings that an elixir offers.
 *
 * A model proposes a list of fields together with the code, and the user sets
 * values for them later. This module is pure: it uses no browser API, so the
 * background, the sidebar and the editor all apply the same rules. The code
 * reads the values through a frozen object named CONFIG (JavaScript) or
 * through var(--setting-<key>) references that are replaced before the CSS
 * check (CSS).
 *
 * Why a value can change without a new review: the static analysis already
 * treats every member of CONFIG as arbitrary text at every sink, as it does
 * text that is read from the page. A value therefore cannot give the code an
 * operation that the code lacked with its defaults. Anything here that made a
 * value more trusted than page text would break that, so values are checked
 * only for shape and size and are never interpreted.
 */

import { parse } from 'acorn'
import { tokenize } from '@safety/css-check'
import type { Token } from '@safety/css-check'
import { t } from './i18n'
import type { ConfigField, ConfigFieldType, ConfigValue } from './types'

export const CONFIG_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/

/**
 * True when a string can be a setting key. The pattern excludes "__proto__",
 * which would set the prototype in an object literal. Names that Object.prototype
 * already has, such as "constructor" and "toString", are excluded as well, so
 * that no key shadows an inherited member.
 */
export function isConfigKey(key: string): boolean {
  return CONFIG_KEY_PATTERN.test(key) && !(key in Object.prototype)
}

export const CONFIG_LIMITS = {
  fields: 20,
  label: 60,
  help: 200,
  optionsMin: 2,
  optionsMax: 20,
  optionValue: 100,
  columnsMax: 6,
  text: 2000,
  items: 1000,
  cell: 500,
  /** Serialised size of all values, and of all defaults. */
  bytes: 64 * 1024,
} as const

export const CONFIG_UNITS = ['', 'px', 'em', 'rem', '%', 'vh', 'vw', 's', 'ms', 'deg'] as const
const CONFIG_TYPES: readonly ConfigFieldType[] = ['text', 'number', 'yes-no', 'choice', 'colour', 'list', 'table']

/** The types that CSS can use. */
export const CSS_CONFIG_TYPES: readonly ConfigFieldType[] = ['text', 'number', 'choice', 'colour']

/** An option value that can be written into CSS as an identifier. */
const CSS_IDENT = /^[a-zA-Z][a-zA-Z0-9-]*$/

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

export type ValueCheck = { ok: true; value: ConfigValue } | { ok: false; problem: string }

const bad = (problem: string): ValueCheck => ({ ok: false, problem })

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkLine(value: unknown, max: number): ValueCheck {
  if (typeof value !== 'string') return bad(t('configValueNotText'))
  if (value.length > max) return bad(t('configValueTooLong', max))
  if (CONTROL.test(value)) return bad(t('configValueControl'))
  return { ok: true, value }
}

/**
 * Checks a value against its field and returns the normalised value. The
 * background applies this on every write and when the script source is built,
 * so the interface is not the only place the rules hold.
 */
export function validateValue(field: ConfigField, value: unknown): ValueCheck {
  switch (field.type) {
    case 'text':
      return checkLine(value, CONFIG_LIMITS.text)
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return bad(t('configValueNotNumber'))
      if (Math.abs(value) > 1e12) return bad(t('configValueNotNumber'))
      if (field.min !== undefined && value < field.min) return bad(t('configValueBelowMin', field.min))
      if (field.max !== undefined && value > field.max) return bad(t('configValueAboveMax', field.max))
      return { ok: true, value }
    }
    case 'yes-no':
      return typeof value === 'boolean' ? { ok: true, value } : bad(t('configValueNotYesNo'))
    case 'choice':
      return typeof value === 'string' && (field.options ?? []).some((option) => option.value === value)
        ? { ok: true, value }
        : bad(t('configValueNotChoice'))
    case 'colour':
      return typeof value === 'string' && HEX_COLOUR.test(value)
        ? { ok: true, value: value.toLowerCase() }
        : bad(t('configValueNotColour'))
    case 'list': {
      if (!Array.isArray(value)) return bad(t('configValueNotList'))
      if (value.length > CONFIG_LIMITS.items) return bad(t('configValueTooManyItems', CONFIG_LIMITS.items))
      const items: string[] = []
      for (const item of value) {
        const line = checkLine(item, CONFIG_LIMITS.cell)
        if (!line.ok) return line
        items.push(line.value as string)
      }
      return { ok: true, value: items }
    }
    case 'table': {
      if (!Array.isArray(value)) return bad(t('configValueBadRow'))
      if (value.length > CONFIG_LIMITS.items) return bad(t('configValueTooManyItems', CONFIG_LIMITS.items))
      const columns = (field.columns ?? []).map((column) => column.key)
      const rows: Record<string, string>[] = []
      for (const row of value) {
        if (!isPlainObject(row)) return bad(t('configValueBadRow'))
        const keys = Object.keys(row)
        if (keys.length !== columns.length || !columns.every((key) => Object.hasOwn(row, key))) {
          return bad(t('configValueBadRow'))
        }
        const clean: Record<string, string> = {}
        for (const key of columns) {
          const cell = checkLine(row[key], CONFIG_LIMITS.cell)
          if (!cell.ok) return cell
          clean[key] = cell.value as string
        }
        rows.push(clean)
      }
      return { ok: true, value: rows }
    }
  }
}

function serialisedSize(value: unknown): number {
  return JSON.stringify(value).length
}

/** True when the values, serialised, are within the 64 KB limit. */
export function valuesFitSize(values: Record<string, ConfigValue>): boolean {
  return serialisedSize(values) <= CONFIG_LIMITS.bytes
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

function cleanKeyedList(
  raw: unknown,
  min: number,
  max: number,
  valueRule: (value: string) => boolean,
  keyName: 'key' | 'value',
): { key: string; label: string }[] | null {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) return null
  const seen = new Set<string>()
  const out: { key: string; label: string }[] = []
  for (const item of raw) {
    if (!isPlainObject(item)) return null
    const id = item[keyName]
    const label = item.label
    if (typeof id !== 'string' || !valueRule(id) || seen.has(id)) return null
    if (typeof label !== 'string' || label.length < 1 || label.length > CONFIG_LIMITS.label || CONTROL.test(label)) return null
    seen.add(id)
    out.push({ key: id, label })
  }
  return out
}

/**
 * Parses one raw field. Returns the clean field, or the name of the part that
 * is invalid. Only known properties are copied, so a field cannot carry
 * anything else into storage or into a prompt.
 */
function parseField(raw: unknown): { field: ConfigField } | { part: string } {
  if (!isPlainObject(raw)) return { part: t('configPartType') }
  const label = raw.label
  if (typeof label !== 'string' || label.length < 1 || label.length > CONFIG_LIMITS.label || CONTROL.test(label)) {
    return { part: t('configPartLabel') }
  }
  let help: string | undefined
  if (raw.help !== undefined && raw.help !== '') {
    if (typeof raw.help !== 'string' || raw.help.length > CONFIG_LIMITS.help || CONTROL.test(raw.help)) {
      return { part: t('configPartHelp') }
    }
    help = raw.help
  }
  const type = raw.type as ConfigFieldType
  if (!CONFIG_TYPES.includes(type)) return { part: t('configPartType') }

  const field: ConfigField = { key: raw.key as string, label, type, default: '' }
  if (help !== undefined) field.help = help

  if (type === 'choice') {
    const options = cleanKeyedList(
      Array.isArray(raw.options)
        ? raw.options.map((o) => (isPlainObject(o) ? { key: o.value, label: o.label } : o))
        : raw.options,
      CONFIG_LIMITS.optionsMin,
      CONFIG_LIMITS.optionsMax,
      (value) => value.length >= 1 && value.length <= CONFIG_LIMITS.optionValue && !CONTROL.test(value),
      'key',
    )
    if (!options) return { part: t('configPartOptions') }
    field.options = options.map((o) => ({ value: o.key, label: o.label }))
  }
  if (type === 'table') {
    const columns = cleanKeyedList(raw.columns, 1, CONFIG_LIMITS.columnsMax, isConfigKey, 'key')
    if (!columns) return { part: t('configPartColumns') }
    field.columns = columns
  }
  if (type === 'number') {
    for (const name of ['min', 'max', 'step'] as const) {
      const value = raw[name]
      if (value === undefined || value === null) continue
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) {
        return { part: t('configPartRange') }
      }
      field[name] = value
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      return { part: t('configPartRange') }
    }
    if (field.step !== undefined && field.step <= 0) return { part: t('configPartRange') }
    const unit = raw.unit ?? ''
    if (!(CONFIG_UNITS as readonly unknown[]).includes(unit)) return { part: t('configPartUnit') }
    if (unit !== '') field.unit = unit as NonNullable<ConfigField['unit']>
  }

  const checked = validateValue(field, raw.default)
  if (!checked.ok) return { part: t('configPartDefault') }
  field.default = checked.value
  return { field }
}

/**
 * Parses the fields a model proposed or a file carries. Invalid fields are
 * dropped and reported, so one bad field does not lose the others. The count
 * limit and the 64 KB limit on defaults apply here as well.
 */
export function parseConfigFields(raw: unknown): { fields: ConfigField[]; problems: string[] } {
  const fields: ConfigField[] = []
  const problems: string[] = []
  if (raw === undefined || raw === null) return { fields, problems }
  if (!Array.isArray(raw)) return { fields, problems: [t('configPartType')] }

  const seen = new Set<string>()
  let size = 0
  for (const item of raw) {
    const key = isPlainObject(item) ? item.key : undefined
    if (typeof key !== 'string' || !isConfigKey(key)) {
      problems.push(t('configKeyInvalid', typeof key === 'string' ? key.slice(0, 40) : ''))
      continue
    }
    if (seen.has(key)) {
      problems.push(t('configKeyDuplicate', key))
      continue
    }
    if (fields.length >= CONFIG_LIMITS.fields) {
      problems.push(t('configTooManyFields', CONFIG_LIMITS.fields))
      break
    }
    const parsed = parseField(item)
    if ('part' in parsed) {
      problems.push(t('configFieldPartInvalid', key, parsed.part))
      continue
    }
    const added = serialisedSize(parsed.field.default)
    if (size + added > CONFIG_LIMITS.bytes) {
      problems.push(t('configFieldPartInvalid', key, t('configPartDefault')))
      continue
    }
    size += added
    seen.add(key)
    fields.push(parsed.field)
  }
  return { fields, problems }
}

/** JSON text with the keys of every object in sorted order, so that two equal values give equal text. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isPlainObject(inner)
      ? Object.fromEntries(Object.keys(inner).sort().map((key) => [key, inner[key]]))
      : inner,
  )
}

/**
 * True when stored fields are exactly what the parser would produce: nothing
 * dropped, nothing added, and no property outside the known ones.
 */
export function fieldsAreClean(fields: unknown): boolean {
  if (fields === undefined) return true
  const parsed = parseConfigFields(fields)
  return parsed.problems.length === 0 && stableJson(parsed.fields) === stableJson(fields)
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

function ownValue(values: unknown, key: string): unknown {
  return isPlainObject(values) && Object.hasOwn(values, key) ? values[key] : undefined
}

/**
 * The values the code sees: each field's default, replaced by the user's value
 * when that value passes the field's validation. An invalid stored value falls
 * back to the default.
 */
export function effectiveValues(
  fields: readonly ConfigField[] | undefined,
  overrides: unknown,
): Record<string, ConfigValue> {
  const out: Record<string, ConfigValue> = {}
  let size = 0
  for (const field of fields ?? []) {
    let value: ConfigValue = field.default
    const stored = ownValue(overrides, field.key)
    if (stored !== undefined) {
      const checked = validateValue(field, stored)
      if (checked.ok && size + serialisedSize(checked.value) <= CONFIG_LIMITS.bytes) value = checked.value
    }
    size += serialisedSize(value)
    out[field.key] = value
  }
  return out
}

export interface ValueSet {
  values: Record<string, ConfigValue>
  /** Keys whose value was accepted. */
  applied: string[]
  /** Keys whose value was refused, with the reason. */
  skipped: { key: string; problem: string }[]
  /** Keys that the elixir has no field for. */
  unknown: string[]
}

/**
 * Validates a set of values against the fields. Used by the set-config-values
 * handler (which refuses the whole message when `skipped` or `unknown` is not
 * empty) and by the import of a settings file (which applies what is valid and
 * reports the rest).
 */
export function checkValueSet(fields: readonly ConfigField[] | undefined, raw: unknown): ValueSet {
  const result: ValueSet = { values: {}, applied: [], skipped: [], unknown: [] }
  if (!isPlainObject(raw)) return result
  const byKey = new Map((fields ?? []).map((field) => [field.key, field]))
  for (const key of Object.keys(raw)) {
    const field = byKey.get(key)
    if (!field) {
      result.unknown.push(key)
      continue
    }
    const checked = validateValue(field, raw[key])
    if (!checked.ok) {
      result.skipped.push({ key, problem: checked.problem })
      continue
    }
    result.values[key] = checked.value
    result.applied.push(key)
  }
  if (!valuesFitSize(result.values)) {
    result.skipped.push({ key: '', problem: t('configValuesTooLarge') })
    result.values = {}
    result.applied = []
  }
  return result
}

export type NotKeptReason = 'removed' | 'type' | 'invalid'

export interface NotKept {
  key: string
  label: string
  reason: NotKeptReason
}

const isEmptyRow = (row: Record<string, string>): boolean => Object.values(row).every((cell) => cell === '')

/**
 * The values to keep when the fields change. A value is kept when the new
 * fields have the same key with the same type and the value passes the new
 * field's validation. Table cells are matched by column key: removed columns
 * are dropped, new columns start empty, and a row with only empty cells is
 * dropped. Anything else falls back to the new default. `notKept` lists the
 * keys that had a user value and lost it, for the approval panel.
 */
export function reconcileValues(
  oldFields: readonly ConfigField[] | undefined,
  newFields: readonly ConfigField[] | undefined,
  overrides: unknown,
): { values: Record<string, ConfigValue>; notKept: NotKept[] } {
  const values: Record<string, ConfigValue> = {}
  const notKept: NotKept[] = []
  const oldByKey = new Map((oldFields ?? []).map((field) => [field.key, field]))
  const newByKey = new Map((newFields ?? []).map((field) => [field.key, field]))
  let size = 0

  if (isPlainObject(overrides)) {
    for (const key of Object.keys(overrides)) {
      const old = oldByKey.get(key)
      const next = newByKey.get(key)
      const label = (old ?? next)?.label ?? key
      if (!next || !old) {
        notKept.push({ key, label, reason: 'removed' })
        continue
      }
      if (old.type !== next.type) {
        notKept.push({ key, label, reason: 'type' })
        continue
      }
      let candidate: unknown = overrides[key]
      if (next.type === 'table' && Array.isArray(candidate)) {
        const columns = (next.columns ?? []).map((column) => column.key)
        candidate = candidate
          .filter(isPlainObject)
          .map((row) => Object.fromEntries(columns.map((column) => [column, typeof row[column] === 'string' ? row[column] : ''])))
          .filter((row) => !isEmptyRow(row as Record<string, string>))
      }
      const checked = validateValue(next, candidate)
      if (!checked.ok || size + serialisedSize(checked.value) > CONFIG_LIMITS.bytes) {
        notKept.push({ key, label, reason: 'invalid' })
        continue
      }
      size += serialisedSize(checked.value)
      values[key] = checked.value
    }
  }
  return { values, notKept }
}

/* ------------------------------------------------------------------ */
/* JavaScript                                                          */
/* ------------------------------------------------------------------ */

function escapeForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function literalOf(value: ConfigValue): string {
  if (typeof value === 'string') return escapeForScript(JSON.stringify(value))
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : '0'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value.length === 0) return 'Object.freeze([])'
  if (typeof value[0] === 'string') {
    return `Object.freeze([${(value as string[]).map((item) => escapeForScript(JSON.stringify(item))).join(', ')}])`
  }
  const rows = (value as Record<string, string>[]).map(
    (row) =>
      `Object.freeze({${Object.keys(row)
        .map((key) => `${JSON.stringify(key)}: ${escapeForScript(JSON.stringify(row[key]))}`)
        .join(', ')}})`,
  )
  return `Object.freeze([${rows.join(', ')}])`
}

/**
 * The JavaScript text of the CONFIG object: a frozen object literal of the
 * effective values, every object and array frozen as well. Keys match the key
 * pattern, so none is "__proto__", and every string is written with
 * JSON.stringify, so no value can end the literal. Values are validated again
 * here, so a stored value that fails validation is replaced by the default.
 */
export function scriptLiteral(fields: readonly ConfigField[] | undefined, overrides: unknown): string {
  const effective = effectiveValues(fields, overrides)
  const parts = (fields ?? []).map((field) => `${JSON.stringify(field.key)}: ${literalOf(effective[field.key]!)}`)
  return `Object.freeze({${parts.join(', ')}})`
}

/* ------------------------------------------------------------------ */
/* References                                                          */
/* ------------------------------------------------------------------ */

export interface ConfigReferences {
  /** Keys the code reads, in order of first use. */
  keys: string[]
  /** CSS only: keys of references that have a fallback or other extra text. */
  withFallback: string[]
  /** JavaScript only: CONFIG is used in a way that names no key, such as an alias or a computed member. */
  dynamic: boolean
}

const SETTING_PREFIX = '--setting-'

interface CssReference {
  key: string
  /** Offsets in the normalised text, from the start of "var(" to just after ")". */
  start: number
  end: number
  exact: boolean
}

function normaliseCss(source: string): string {
  return source.replace(/\r\n?/g, '\n').replace(/\f/g, '\n').replace(/\0/g, '�')
}

function cssReferences(tokens: Token[]): CssReference[] {
  const found: CssReference[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (token.type !== 'function' || token.value.toLowerCase() !== 'var') continue
    let j = i + 1
    while (tokens[j]?.type === 'whitespace') j += 1
    const name = tokens[j]
    if (name?.type !== 'ident' || !name.value.startsWith(SETTING_PREFIX)) continue
    j += 1
    while (tokens[j]?.type === 'whitespace') j += 1
    const close = tokens[j]
    if (close?.type === 'close-paren') {
      found.push({ key: name.value.slice(SETTING_PREFIX.length), start: token.start, end: close.start + 1, exact: true })
    } else {
      found.push({ key: name.value.slice(SETTING_PREFIX.length), start: token.start, end: token.start, exact: false })
    }
  }
  return found
}

type Ast = { type: string; [key: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any

function jsReferences(code: string): ConfigReferences {
  const keys: string[] = []
  const result: ConfigReferences = { keys, withFallback: [], dynamic: false }
  let ast: Ast
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }) as unknown as Ast
  } catch {
    return result
  }
  const add = (key: string) => {
    if (!keys.includes(key)) keys.push(key)
  }
  const isConfig = (node: Ast | null | undefined) => node?.type === 'Identifier' && node.name === 'CONFIG'
  const visit = (node: unknown, parent: Ast | null, parentKey: string): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent, parentKey)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const n = node as Ast
    if (typeof n.type !== 'string') return

    if (n.type === 'MemberExpression' && isConfig(n.object)) {
      if (!n.computed && n.property.type === 'Identifier') add(n.property.name)
      else if (n.computed && n.property.type === 'Literal' && typeof n.property.value === 'string') add(n.property.value)
      else result.dynamic = true
      visit(n.computed ? n.property : null, n, 'property')
      return
    }
    if (n.type === 'VariableDeclarator' && isConfig(n.init) && n.id.type === 'ObjectPattern') {
      for (const property of n.id.properties as Ast[]) {
        if (property.type === 'Property' && !property.computed && property.key.type === 'Identifier') add(property.key.name)
        else if (property.type === 'Property' && !property.computed && property.key.type === 'Literal') add(String(property.key.value))
        else result.dynamic = true
        visit(property.value, property, 'value')
      }
      return
    }
    if (isConfig(n) && !(parent?.type === 'MemberExpression' && parentKey === 'object')) {
      // CONFIG used as a whole value (alias, argument, spread): no key is known.
      const declaredProperty = parent?.type === 'Property' && parentKey === 'key' && !parent.computed
      if (!declaredProperty) result.dynamic = true
    }
    for (const key of Object.keys(n)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
      visit(n[key], n, key)
    }
  }
  visit(ast, null, '')
  return result
}

/**
 * The settings that code refers to. For JavaScript these are CONFIG.name,
 * CONFIG['name'] and the non-computed keys of a destructuring of CONFIG. For
 * CSS they are var(--setting-<key>) references, found with the CSS tokenizer,
 * so references inside strings and comments are ignored. This is a
 * correctness check and not a safety control: an alias such as
 * `const c = CONFIG` is reported as `dynamic` and escapes the key check.
 */
export function configReferences(code: string, kind: 'js' | 'css'): ConfigReferences {
  if (kind === 'js') return jsReferences(code)
  const references = cssReferences(tokenize(code))
  const keys: string[] = []
  const withFallback: string[] = []
  for (const reference of references) {
    if (!keys.includes(reference.key)) keys.push(reference.key)
    if (!reference.exact && !withFallback.includes(reference.key)) withFallback.push(reference.key)
  }
  return { keys, withFallback, dynamic: false }
}

/* ------------------------------------------------------------------ */
/* CSS                                                                 */
/* ------------------------------------------------------------------ */

function cssNumber(value: number): string {
  let text = String(value)
  if (/e/i.test(text)) text = value.toFixed(10).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}

/** A string written as a CSS string, with the quote, the backslash and every control character escaped. */
function cssString(value: string): string {
  let out = '"'
  for (const char of value) {
    const code = char.codePointAt(0)!
    if (char === '"' || char === '\\' || code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      out += `\\${code.toString(16)} `
    } else {
      out += char
    }
  }
  return `${out}"`
}

/**
 * The text that stands in for a reference to this field in CSS, or null when
 * the field cannot be used in CSS or the value cannot be written safely. A
 * colour is the validated hex value, a number is the number with its unit, a
 * choice is an identifier, and text is a quoted CSS string.
 */
export function cssValueText(field: ConfigField, value: ConfigValue): string | null {
  const checked = validateValue(field, value)
  if (!checked.ok) return null
  const v = checked.value
  switch (field.type) {
    case 'colour':
      return v as string
    case 'number':
      return `${cssNumber(v as number)}${field.unit ?? ''}`
    case 'choice':
      return CSS_IDENT.test(v as string) ? (v as string) : null
    case 'text':
      return cssString(v as string)
    default:
      return null
  }
}

/** True when every option of a choice field can be written as a CSS identifier. */
export function choiceIsCssSafe(field: ConfigField): boolean {
  return (field.options ?? []).every((option) => CSS_IDENT.test(option.value))
}

/**
 * The CSS with every var(--setting-<key>) that has exactly that one argument
 * replaced by the serialised effective value. A reference that has a fallback,
 * names an unknown key, or names a list, table or yes-no field is left as it
 * is, and configProblem refuses it.
 *
 * Everything that checks CSS and everything that inserts CSS uses this text.
 * The replacement is a single token (a hex colour, a number with a unit, an
 * identifier or a closed string), so it cannot start a url(), an at-rule or a
 * new rule, and the CSS check sees exactly what the page gets.
 */
export function cssWithConfig(
  code: string,
  fields: readonly ConfigField[] | undefined,
  overrides: unknown,
): string {
  const text = normaliseCss(code)
  const references = cssReferences(tokenize(code)).filter((reference) => reference.exact)
  if (references.length === 0) return code
  const effective = effectiveValues(fields, overrides)
  const byKey = new Map((fields ?? []).map((field) => [field.key, field]))
  let out = text
  for (const reference of [...references].reverse()) {
    const field = byKey.get(reference.key)
    if (!field) continue
    const replacement = cssValueText(field, effective[field.key]!)
    if (replacement === null) continue
    out = out.slice(0, reference.start) + replacement + out.slice(reference.end)
  }
  return out
}
