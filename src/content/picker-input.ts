/**
 * Decisions about picker input that do not need a page, so that they can be
 * tested without one (#118).
 *
 * The picker's handlers in index.ts act on the page's DOM and cannot be loaded
 * in a test. What they decide is kept here.
 */

import type { PickerAction } from '@shared/picker-keys'

export interface PickerInputState {
  /** Whether a pick is running. */
  picking: boolean
}

/**
 * Runs an action forwarded by the sidebar, only while a pick is running, and
 * returns what was decided: `ignore` when no pick is running, otherwise `apply`.
 */
export function relayPickerKey(
  state: PickerInputState,
  action: PickerAction,
  apply: (action: PickerAction) => boolean,
): 'ignore' | 'apply' {
  if (!state.picking) return 'ignore'
  apply(action)
  return 'apply'
}
