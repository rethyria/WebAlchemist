import type { GenerationResult, ReviewResult } from '@shared/types'

/**
 * Whether model-written JavaScript may be run as a preview (issue 55).
 *
 * A preview registers the code and reloads the page, so the code runs with the
 * user's logged-in session before anything has been saved. The static analysis
 * has gaps, so it is not enough alone. The preview waits for the model review
 * to have completed with a verdict of match, and for the static analysis to
 * have passed in both the local check and the review.
 */
export function jsPreviewGate(
  analysis: ReviewResult | null,
  review: ReviewResult | null,
): { allowed: true } | { allowed: false; reason: 'analysis' | 'not-reviewed' | 'verdict' } {
  if (analysis === null || !analysis.passed) return { allowed: false, reason: 'analysis' }
  if (review === null || !review.passed || !review.model) {
    return { allowed: false, reason: 'not-reviewed' }
  }
  if (review.model.verdict !== 'match') return { allowed: false, reason: 'verdict' }
  return { allowed: true }
}

/**
 * Identifies what a review was run for. A review counts only for the same
 * code, intent, world and capabilities, so a regeneration or an edit to the
 * intent makes an earlier review stop counting.
 */
export function reviewKey(
  result: Pick<GenerationResult, 'code' | 'world' | 'capabilities'>,
  intent: string,
): string {
  return JSON.stringify([result.code, intent, result.world, [...result.capabilities].sort()])
}
