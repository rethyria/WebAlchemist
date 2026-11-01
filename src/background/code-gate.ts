/**
 * The checks stored code has to pass before it runs, in one place.
 *
 * Code is checked when it is saved, and again every time it is about to run:
 * when a script is registered, and when stored CSS is injected. The second
 * check matters because the rules change. A script saved under an earlier
 * analyser and a stylesheet saved before the CSS check existed would otherwise
 * keep running unchanged after the check that would now reject them was added.
 */

import { analyseJavaScript, applyCapabilityPolicy } from '@safety/static-analysis'
import type { ReviewResult, Settings, Transform, TransformRuntimeState } from '@shared/types'
import { checkCssTransform } from './css-gate'

/**
 * The deterministic half of the review, on its own. Separated because it is
 * free and local, which is what lets it gate the preview and every later run;
 * the model review costs a call and happens once, at approval.
 */
export function runStaticAnalysis(
  code: string,
  declared: Transform['capabilities'],
): ReviewResult {
  const outcome = analyseJavaScript(code)
  const { findings, undeclared } = applyCapabilityPolicy(outcome, declared)
  return {
    static: findings,
    undeclaredCapabilities: undeclared,
    passed: !findings.some((f) => f.severity === 'block'),
  }
}

/** The first reason JavaScript fails static analysis, or null when it passes. */
export function staticProblem(code: string, declared: Transform['capabilities']): string | null {
  const check = runStaticAnalysis(code, declared)
  if (check.passed) return null
  return (
    check.static.find((f) => f.severity === 'block')?.explanation ??
    'A capability was used without being declared.'
  )
}

/**
 * Why stored code may not run, or null when it may.
 *
 * `tabUrl` is the page the code is about to run on. CSS URLs are checked
 * against it, so the same stylesheet can pass on one site and fail on another
 * that has a stricter setting.
 */
export function problemWithStoredCode(
  transform: Transform,
  settings: Settings,
  tabUrl?: string,
): string | null {
  if (!transform.code) return null

  const check =
    transform.kind === 'js'
      ? runStaticAnalysis(transform.code, transform.capabilities)
      : checkCssTransform(transform, settings, tabUrl)
  if (check.passed) return null

  const reason =
    check.static.find((f) => f.severity === 'block')?.explanation ??
    'It loads addresses outside the site that were not approved.'
  return `Its code does not pass the safety check that is applied now, so it is not running. ${reason}`
}

/**
 * Transforms that are stored but may not run, in the shape the panel already
 * uses for a transform that stopped working.
 *
 * Derived each time from the stored code and the current rules and never
 * saved, as the health check's own states are: a saved flag would go stale as
 * soon as the rules, the settings or the code changed.
 */
export function blockedStates(
  transforms: Transform[],
  settings: Settings,
  tabUrl?: string,
): TransformRuntimeState[] {
  const states: TransformRuntimeState[] = []
  for (const transform of transforms) {
    const reason = problemWithStoredCode(transform, settings, tabUrl)
    if (reason) states.push({ id: transform.id, status: 'broken', brokenReason: reason })
  }
  return states
}
