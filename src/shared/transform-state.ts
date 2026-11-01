/**
 * States of a stored transform that the list and the background both need to
 * agree on.
 */

import type { Transform } from './types'

/**
 * True when a transform has no code to run and has to be generated again from
 * its description. This is how an imported JavaScript transform arrives, and
 * how imported CSS arrives when it failed the CSS check. Turning such a
 * transform on does nothing, because there is nothing to register or inject.
 */
export function needsRegenerating(transform: Pick<Transform, 'code'>): boolean {
  return transform.code === ''
}

/** What the list says when the user tries to turn on a transform that needs regenerating. */
export const NEEDS_REGENERATING_NOTE =
  'This transform has no code. It came from an imported file, and its description has to be used to write code again before it can run. Open it and choose Edit description on a page it applies to.'

/**
 * What the list does when its switch for a transform is pressed. Turning on a
 * transform that needs regenerating changes nothing and explains why; every
 * other press is passed on to the background.
 */
export function toggleOutcome(
  transform: Pick<Transform, 'code'>,
  enabled: boolean,
): 'explain' | 'send' {
  return enabled && needsRegenerating(transform) ? 'explain' : 'send'
}
