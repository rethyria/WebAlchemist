import { t } from './i18n'
/**
 * What the approval panel and the editor say about the world a script runs in.
 *
 * The text is here, and not in the components, so a test can check that the
 * warning names every risk the user decided it must name (issue 53), and that
 * the panel's state for a model request follows one rule in both places.
 */

import type { ExecutionWorld, GenerationResult, Transform } from './types'

/** The risks of the MAIN world, in the order they are shown. */
export const MAIN_WORLD_RISKS: readonly string[] = [
  t('mainRisk1'),
  t('mainRisk2'),
  t('mainRisk3'),
  t('mainRisk4'),
]

export const WORLD_NAMES: Record<ExecutionWorld, string> = {
  USER_SCRIPT: t('worldNameIsolated'),
  MAIN: t('worldNameMain'),
}

export interface WorldState {
  /** The world the code will run in if it is saved now. */
  world: ExecutionWorld
  /** True when the model asked for MAIN and the user has not approved it. */
  requestPending: boolean
  /** The model's reason, shown with a pending or approved request. */
  reason: string
  /** True when the code runs in MAIN, whoever chose it. */
  runsInMain: boolean
  /** True when the risk warning is shown: a pending request or MAIN in use. */
  showRisks: boolean
}

/**
 * The state the approval panel shows for a result. A request has no effect on
 * its own: `world` is whatever the user has approved, and a pending request is
 * only reported.
 */
export function worldState(
  result: Pick<GenerationResult, 'kind' | 'world' | 'requestedWorld' | 'worldReason'>,
): WorldState {
  const world = result.kind === 'js' ? result.world : 'USER_SCRIPT'
  const requestPending = result.kind === 'js' && result.requestedWorld === 'MAIN' && world !== 'MAIN'
  return {
    world,
    requestPending,
    reason: result.worldReason,
    runsInMain: world === 'MAIN',
    showRisks: requestPending || world === 'MAIN',
  }
}

/** A short label for a stored transform's world. Absent means the isolated world. */
export function worldOf(transform: Pick<Transform, 'world'>): ExecutionWorld {
  return transform.world ?? 'USER_SCRIPT'
}

/**
 * Shown on a transform that the one-time migration moved from MAIN to the
 * isolated world, because nothing recorded that the user had chosen MAIN.
 */
export const WORLD_RESET_NOTICE =
  t('worldResetNotice')
