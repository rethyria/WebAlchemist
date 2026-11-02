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
import { CSS_CONFIG_TYPES, choiceIsCssSafe, configReferences, fieldsAreClean, parseConfigFields } from '@shared/config'
import { typeName } from '@shared/config-text'
import type { ConfigField, ReviewResult, Settings, Transform, TransformRuntimeState } from '@shared/types'
import { checkCssTransform } from './css-gate'
import { t } from '@shared/i18n'

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

/**
 * Why the settings of an elixir and the code that reads them do not fit
 * together, or null when they do. The fields must be valid, and JavaScript may
 * read only keys that the fields define.
 *
 * This is a correctness check and not a safety control: code that reads
 * CONFIG through an alias, such as `const c = CONFIG; c.x`, is not seen here,
 * and it only means that such a key reads undefined. What a value can do is
 * limited by the static analysis, which treats every member of CONFIG as
 * arbitrary text.
 */
export function configProblem(
  transform: Pick<Transform, 'kind' | 'code' | 'configFields'>,
): string | null {
  if (!fieldsAreClean(transform.configFields)) {
    return t('configFieldsNotValid', parseConfigFields(transform.configFields).problems[0] ?? '').trim()
  }
  if (transform.kind === 'js' && transform.code) {
    const defined = new Set((transform.configFields ?? []).map((field) => field.key))
    const unknown = configReferences(transform.code, 'js').keys.find((key) => !defined.has(key))
    if (unknown !== undefined) return t('bgCodeReadsAnUndefinedSetting', unknown)
  }
  if (transform.kind === 'css' && transform.code) {
    // CSS reads a setting with var(--setting-<key>), with nothing else inside
    // the brackets, and only for the types that can be written as CSS.
    const byKey = new Map((transform.configFields ?? []).map((field) => [field.key, field]))
    const references = configReferences(transform.code, 'css')
    for (const key of references.keys) {
      const field = byKey.get(key)
      if (!field) return t('bgCodeReadsAnUndefinedSetting', key)
      if (references.withFallback.includes(key)) return t('bgCssSettingHasFallback', key)
      if (!CSS_CONFIG_TYPES.includes(field.type)) return t('bgCssSettingTypeNotUsable', key, typeName(field.type))
      if (field.type === 'choice' && !choiceIsCssSafe(field)) return t('bgCssChoiceNotIdentifier', key)
    }
  }
  return null
}

/**
 * Static analysis of JavaScript together with the settings check, as one
 * result, so that every place that analyses code before it is approved,
 * previewed, saved or registered applies both.
 */
export function analyseWithConfig(
  code: string,
  declared: Transform['capabilities'],
  configFields: ConfigField[] | undefined,
): ReviewResult {
  const result = runStaticAnalysis(code, declared)
  const problem = configProblem({ kind: 'js', code, ...(configFields === undefined ? {} : { configFields }) })
  if (problem === null) return result
  return {
    ...result,
    static: [
      ...result.static,
      { line: 0, column: 0, api: 'CONFIG', capability: null, severity: 'block', explanation: problem },
    ],
    passed: false,
  }
}

/** The first reason JavaScript fails static analysis, or null when it passes. */
export function staticProblem(
  code: string,
  declared: Transform['capabilities'],
  configFields?: ConfigField[],
): string | null {
  const check = analyseWithConfig(code, declared, configFields)
  if (check.passed) return null
  return (
    check.static.find((f) => f.severity === 'block')?.explanation ??
    t('bgACapabilityWasUsedWithoutBeing')
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

  // Code runs in the page's own world only with the user's approval (#53). The
  // record of that approval is checked here as well as when a record is saved,
  // so a record without it is never registered.
  if (transform.kind === 'js' && transform.world === 'MAIN' && transform.mainApprovedByUser !== true) {
    return t('bgSetToRunInMainNotApproved')
  }

  const configIssue = configProblem(transform)
  if (configIssue !== null) return t('bgItsCodeDoesNotPassThe', configIssue)

  const check =
    transform.kind === 'js'
      ? runStaticAnalysis(transform.code, transform.capabilities)
      : checkCssTransform(transform, settings, tabUrl)
  if (check.passed) return null

  const reason =
    check.static.find((f) => f.severity === 'block')?.explanation ??
    t('bgItLoadsAddressesOutsideTheSite')
  return t('bgItsCodeDoesNotPassThe', reason)
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
