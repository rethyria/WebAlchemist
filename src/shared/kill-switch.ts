/**
 * The wording for the setting that stops every transform from running, kept in
 * one place so the settings page and the panel describe it the same way.
 */

export const KILL_SWITCH_LABEL = 'Stop running all transforms'

/** What the setting does, and what it does not do. */
export const KILL_SWITCH_NOTE =
  'Stops CSS and JavaScript transforms, whether written by hand or by the model, on every site. ' +
  'CSS is removed from open tabs when this is turned on. A tab that already ran JavaScript ' +
  'keeps running it until the tab is reloaded.'

/**
 * What to tell the user after the setting changed. `reloadTabs` is the number of
 * open tabs that may have run JavaScript, as answered by the count-js-tabs message.
 */
export function killSwitchNotice(on: boolean, reloadTabs: number): string {
  if (reloadTabs === 0) return ''
  const tabs = reloadTabs === 1 ? '1 open tab' : `${reloadTabs} open tabs`
  return on
    ? `${tabs} may still be running JavaScript. Reload ${reloadTabs === 1 ? 'it' : 'them'} to stop it.`
    : `Reload ${tabs} to run JavaScript transforms there again.`
}
