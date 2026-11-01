/**
 * Decisions about picker input that do not need a page, so that they can be
 * tested without one (#118).
 *
 * The picker's handlers in index.ts act on the page's DOM and cannot be loaded
 * in a test. What they decide is kept here: whether a forwarded key does
 * anything, whether Enter may confirm, and whether the picker starts on the
 * body.
 */

import type { PickerAction } from '@shared/picker-keys'

/**
 * Whether an event came from the user or the browser. A script on the page can
 * dispatch `keydown` and `mousedown` events of its own, and the picker must not
 * confirm a selection because a page script asked it to.
 */
export function isUserEvent(event: { isTrusted: boolean }): boolean {
  return event.isTrusted
}

export interface PickerInputState {
  /** Whether a pick is running. */
  picking: boolean
  /**
   * Whether the selected element is still the one the picker started on and
   * nothing has moved the selection since.
   */
  atSeed: boolean
}

/**
 * What the picker does with an action:
 *
 * - `ignore`: nothing, and the key is left to the page;
 * - `consume`: nothing, and the key is not passed on;
 * - `apply`: the action runs.
 *
 * Enter does not confirm while it is held down (`repeat`), because holding the
 * key would confirm again on the next pick. It also does not confirm while the
 * selection is still the element the picker started on, because that element is
 * the whole body and Enter pressed before any move is not a choice of it.
 */
export function decideKey(
  state: PickerInputState,
  action: PickerAction,
  repeat: boolean,
): 'ignore' | 'consume' | 'apply' {
  if (!state.picking) return 'ignore'
  if (action === 'confirm' && (repeat || state.atSeed)) return 'consume'
  return 'apply'
}

/**
 * Runs an action forwarded by the sidebar, only while a pick is running, and
 * returns what was decided.
 */
export function relayPickerKey(
  state: PickerInputState,
  action: PickerAction,
  apply: (action: PickerAction) => boolean,
): 'ignore' | 'consume' | 'apply' {
  const decision = decideKey(state, action, false)
  if (decision === 'apply') apply(action)
  return decision
}

/**
 * Whether the picker starts with the body selected. Only a pick of the target
 * does: the sidebar forwards keys only while its Picking panel is mounted, and
 * a reference pick or a region pick does not mount it, so a selection that
 * nothing can move from would be confirmed by the first click.
 */
export function seedsBody(mode: 'target' | 'reference' | 'region'): boolean {
  return mode === 'target'
}
