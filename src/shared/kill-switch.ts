import { t } from './i18n'
/**
 * The wording for the setting that stops every transform from running, kept in
 * one place so the settings page and the panel describe it the same way.
 */

export const KILL_SWITCH_LABEL = t('killSwitchLabel')

/** What the setting does, and what it does not do. */
export const KILL_SWITCH_NOTE = t('killSwitchNote')

/**
 * What to tell the user after the setting changed. `reloadTabs` is the number of
 * open tabs that may have run JavaScript, as answered by the count-js-tabs message.
 */
export function killSwitchNotice(on: boolean, reloadTabs: number): string {
  if (reloadTabs === 0) return ''
  if (on) return t(reloadTabs === 1 ? 'killSwitchOnOneTab' : 'killSwitchOnTabs', reloadTabs)
  return t(reloadTabs === 1 ? 'killSwitchOffOneTab' : 'killSwitchOffTabs', reloadTabs)
}
