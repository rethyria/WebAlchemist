import { fieldsFromModel } from './config'
import type { GenerationResult } from './types'

/**
 * Turns what a model returned into a GenerationResult whose `world` is always
 * USER_SCRIPT. The model's request is kept as `requestedWorld` with its
 * reason, and nothing here lets a request take effect: the world changes only
 * when the user approves it. A `world` field in the response (an older prompt,
 * or a model that adds one) is ignored.
 */
export function toGenerationResult(raw: Record<string, unknown>): GenerationResult {
  const { world: _ignored, requestedWorld, worldReason, config, ...rest } = raw
  const wantsMain = requestedWorld === 'MAIN' && rest['kind'] === 'js'
  return {
    ...(rest as unknown as Omit<GenerationResult, 'world' | 'requestedWorld' | 'worldReason' | 'config'>),
    config: fieldsFromModel(config),
    world: 'USER_SCRIPT',
    requestedWorld: wantsMain ? 'MAIN' : 'USER_SCRIPT',
    worldReason: wantsMain && typeof worldReason === 'string' ? worldReason.trim() : '',
  }
}
