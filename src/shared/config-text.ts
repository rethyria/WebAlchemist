/**
 * Short wording for the settings of an elixir, used by the approval panels, the
 * import preview and the settings form. The text is built from the fields and
 * values, which are data: it is shown as plain text and never as markup.
 */

import type { NotKept } from './config'
import { t } from './i18n'
import type { ConfigField, ConfigFieldType, ConfigValue } from './types'

const TYPE_KEYS = {
  text: 'configTypeText',
  number: 'configTypeNumber',
  'yes-no': 'configTypeYesNo',
  choice: 'configTypeChoice',
  colour: 'configTypeColour',
  list: 'configTypeList',
  table: 'configTypeTable',
} as const satisfies Record<ConfigFieldType, string>

export function typeName(type: ConfigFieldType): string {
  return t(TYPE_KEYS[type])
}

/** The most characters of a value that a summary shows. */
const SHOWN = 60

const shorten = (text: string): string => (text.length > SHOWN ? `${text.slice(0, SHOWN)}...` : text)

/** One value as a short piece of text, for a list of settings. */
export function describeValue(field: ConfigField, value: ConfigValue): string {
  switch (field.type) {
    case 'text':
    case 'colour': {
      const text = String(value)
      return text === '' ? t('configValueEmpty') : shorten(text)
    }
    case 'number':
      return `${String(value)}${field.unit ?? ''}`
    case 'yes-no':
      return value === true ? t('configValueYes') : t('configValueNo')
    case 'choice':
      return shorten((field.options ?? []).find((option) => option.value === value)?.label ?? String(value))
    case 'list':
      return t('configValueItems', Array.isArray(value) ? value.length : 0)
    case 'table':
      return t('configValueRows', Array.isArray(value) ? value.length : 0)
  }
}

/** The settings of an elixir in one line: each label with its type. */
export function summaryOf(fields: readonly ConfigField[]): string {
  return fields.map((field) => t('configSummaryItem', field.label, typeName(field.type))).join(', ')
}

/** The sentence for a value that a change of fields does not keep. */
export function notKeptText(item: NotKept): string {
  switch (item.reason) {
    case 'removed':
      return t('configNotKeptRemoved', item.label)
    case 'type':
      return t('configNotKeptType', item.label)
    case 'invalid':
      return t('configNotKeptInvalid', item.label)
  }
}

/**
 * The whole value as plain text for a closed section: a list one line per
 * item, a table one line per row with the cells separated by " | ". Nothing is
 * cut. The text is shown as text and never as markup.
 */
export function fullValueText(field: ConfigField, value: ConfigValue): string {
  if (field.type === 'list') return (value as string[]).join('\n')
  if (field.type === 'table') {
    const keys = (field.columns ?? []).map((column) => column.key)
    return (value as Record<string, string>[]).map((row) => keys.map((key) => row[key] ?? '').join(' | ')).join('\n')
  }
  if (field.type === 'text' || field.type === 'colour') return String(value)
  return describeValue(field, value)
}
