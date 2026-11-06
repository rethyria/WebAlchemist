import { fieldsFromModel } from './config'
import type { Clarification, GenerationResult } from './types'

/** The longest question that is kept, so the panel never shows an unbounded message. */
export const MAX_QUESTION_CHARACTERS = 600

/**
 * The clarification in a model's response, or null when there is none. An empty
 * or missing question means the model wrote code. Anything that is not an
 * object with a text question is treated the same way.
 */
export function clarificationFromModel(raw: unknown): Clarification | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { question, wantsExample } = raw as Record<string, unknown>
  if (typeof question !== 'string') return null
  const text = question.trim().slice(0, MAX_QUESTION_CHARACTERS)
  if (text === '') return null
  return { question: text, wantsExample: wantsExample === true }
}

/**
 * Turns what a model returned into a GenerationResult whose `world` is always
 * USER_SCRIPT. The model's request is kept as `requestedWorld` with its
 * reason, and nothing here lets a request take effect: the world changes only
 * when the user approves it. A `world` field in the response (an older prompt,
 * or a model that adds one) is ignored.
 *
 * A response with a question is returned with `clarification` set and an empty
 * `code`, whatever else the model put in it, so that no code from such a
 * response can reach the analysis, the review or the page.
 */
export function toGenerationResult(raw: Record<string, unknown>): GenerationResult {
  const { world: _ignored, requestedWorld, worldReason, config, clarification, ...rest } = raw
  const asked = clarificationFromModel(clarification)
  if (asked) {
    return {
      name: '',
      kind: 'css',
      world: 'USER_SCRIPT',
      requestedWorld: 'USER_SCRIPT',
      worldReason: '',
      capabilities: [],
      code: '',
      rationale: { targets: '', approach: '', assumptions: [] },
      intent: '',
      config: [],
      clarification: asked,
    }
  }
  const wantsMain = requestedWorld === 'MAIN' && rest['kind'] === 'js'
  return {
    ...(rest as unknown as Omit<GenerationResult, 'world' | 'requestedWorld' | 'worldReason' | 'config' | 'clarification'>),
    config: fieldsFromModel(config),
    world: 'USER_SCRIPT',
    requestedWorld: wantsMain ? 'MAIN' : 'USER_SCRIPT',
    worldReason: wantsMain && typeof worldReason === 'string' ? worldReason.trim() : '',
  }
}
