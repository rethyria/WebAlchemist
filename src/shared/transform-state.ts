import { t } from './i18n'
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
  t('needsRegeneratingNote')

/** Why a restored script stays off, shown when it is refused for want of approval. */
export const AWAITING_APPROVAL_NOTE =
  t('awaitingApprovalNote')

/**
 * What the list does when its switch for a transform is pressed. Turning on a
 * transform that needs regenerating changes nothing and explains why. Turning
 * on restored JavaScript opens its code for approval first. Every other press
 * is passed on to the background.
 */
export function toggleOutcome(
  transform: Pick<Transform, 'code' | 'awaitsApproval'>,
  enabled: boolean,
): 'explain' | 'approve' | 'send' {
  if (!enabled) return 'send'
  if (needsRegenerating(transform)) return 'explain'
  return transform.awaitsApproval ? 'approve' : 'send'
}
