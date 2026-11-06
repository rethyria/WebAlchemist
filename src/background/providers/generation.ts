import { toGenerationResult } from '@shared/generation-result'
import { t } from '@shared/i18n'
import type { GenerationResult } from '@shared/types'
import { ProviderError, type GenerateRequest } from './types'

/**
 * The result of a generation call, from what the model returned. A repair has
 * to produce code, so a question in answer to a repair is a bad response and
 * not a result the panel could show.
 */
export function parseGeneration(
  raw: Record<string, unknown>,
  request: GenerateRequest,
  label: string,
): GenerationResult {
  const result = toGenerationResult(raw)
  if (request.repair && result.clarification) {
    throw new ProviderError(t('bgReturnedAResponseThatCouldNot', label), 'bad-response', true)
  }
  return result
}
