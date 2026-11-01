/**
 * Text for the sidebar's live regions.
 *
 * A live region makes a screen reader read out whatever text it receives. The
 * text is chosen here so that a region changes only when something the user
 * needs to know has happened: a new stage of a generation, the outcome of a
 * review, a change in the number of broken transforms. Streamed code, the
 * elapsed seconds and the running counts never go into a region, because each
 * change to them would be read out.
 */

import type { ReviewResult, TransformKind } from '@shared/types'
import type { ProgressStage } from './flow.svelte'
import { t } from '@shared/i18n'

const STAGE_TEXT: Record<ProgressStage, string> = {
  context: t('announceContext'),
  sent: t('announceSent'),
  thinking: t('announceThinking'),
  streaming: t('announceStreaming'),
  analysis: t('announceAnalysis'),
  preview: t('announcePreview'),
}

/** One sentence per stage, so the text changes once per stage and not per token. */
export function generationAnnouncement(stage: ProgressStage): string {
  return STAGE_TEXT[stage]
}

/**
 * The outcome of a review in words. Null while the review has not arrived,
 * which is announced as waiting so that the later result is a change.
 */
export function reviewAnnouncement(review: ReviewResult | null, kind: TransformKind): string {
  if (review === null) return t('announceReviewing')
  const blocking = review.static.filter((finding) => finding.severity === 'block').length
  const warnings = review.static.filter((finding) => finding.severity === 'warn').length
  const parts: string[] = []
  if (blocking > 0) {
    parts.push(
      blocking === 1
        ? t('announceOneBlocking')
        : t('announceBlocking', blocking),
    )
  }
  if (warnings > 0) {
    parts.push(warnings === 1 ? t('announceOneWarning') : t('announceWarnings', warnings))
  }
  if (kind === 'js' && review.model && review.model.verdict !== 'match') {
    parts.push(t('announceModelDisagrees'))
  }
  if (parts.length === 0) {
    parts.push(
      kind === 'css'
        ? t('announceCleanCss')
        : t('announceClean'),
    )
  } else {
    parts.unshift(t('announceFinished'))
  }
  return parts.join(' ')
}

/** Empty when nothing is broken, so a region that held a message is cleared. */
export function brokenAnnouncement(count: number): string {
  if (count <= 0) return ''
  return count === 1 ? t('announceOneBroken') : t('announceBroken', count)
}
