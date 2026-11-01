/**
 * Pure helpers for token usage and cost. No storage and no browser APIs, so
 * the background, the sidebar and the settings page share one implementation
 * and the tests can run it directly.
 */

import {
  ANTHROPIC_MODELS,
  type Provider,
  type TokenPrice,
  type TokenUsage,
  type UsageTotals,
} from './types'

/**
 * The price of an Anthropic model, read from the "$5 / $25" string that the
 * settings dropdown already shows. Parsed rather than duplicated as numbers so
 * that the list stays the single place a price is written; a test checks that
 * every listed model parses.
 */
export function listedPrice(modelId: string): TokenPrice | null {
  const option = ANTHROPIC_MODELS.find((m) => m.id === modelId)
  const match = option?.price.match(/^\$(\d+(?:\.\d+)?) \/ \$(\d+(?:\.\d+)?)$/)
  if (!match) return null
  return { input: Number(match[1]), output: Number(match[2]) }
}

/**
 * The price to use for a call, or null when none is known. Anthropic uses the
 * list and ignores `provider.price`; an OpenAI-compatible provider uses only
 * the price the user entered.
 */
export function priceFor(provider: Provider, modelId: string): TokenPrice | null {
  return provider.type === 'anthropic' ? listedPrice(modelId) : (provider.price ?? null)
}

export function costOf(usage: TokenUsage, price: TokenPrice): number {
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000
}

export function emptyTotals(): UsageTotals {
  return { calls: 0, reportedCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, pricedCalls: 0 }
}

/**
 * The key under which the usage of drafts that were never saved is kept. Every
 * transform id is a random UUID, so it cannot collide with this.
 */
export const NOT_SAVED_USAGE_ID = 'not-saved'

/** The sum of two totals objects; neither argument is changed. */
export function addTotals(a: UsageTotals | undefined, b: UsageTotals): UsageTotals {
  const base = a ?? emptyTotals()
  return {
    calls: base.calls + b.calls,
    reportedCalls: base.reportedCalls + b.reportedCalls,
    inputTokens: base.inputTokens + b.inputTokens,
    outputTokens: base.outputTokens + b.outputTokens,
    costUsd: base.costUsd + b.costUsd,
    pricedCalls: base.pricedCalls + b.pricedCalls,
  }
}

/** A new totals object with one call added; the argument is not changed. */
export function addCall(
  totals: UsageTotals | undefined,
  usage: TokenUsage | null,
  costUsd: number | null,
): UsageTotals {
  const base = totals ?? emptyTotals()
  return {
    calls: base.calls + 1,
    reportedCalls: base.reportedCalls + (usage ? 1 : 0),
    inputTokens: base.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: base.outputTokens + (usage?.outputTokens ?? 0),
    costUsd: base.costUsd + (costUsd ?? 0),
    pricedCalls: base.pricedCalls + (costUsd === null ? 0 : 1),
  }
}

/**
 * Reads token counts from the two field spellings providers use. Returns null
 * unless both counts are present as non-negative finite numbers: a response
 * with only one of them cannot be priced or summed honestly, and showing a
 * zero for the missing one would claim a count nobody reported.
 */
export function readUsage(
  raw: unknown,
  fields: { input: string; output: string },
): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const input = record[fields.input]
  const output = record[fields.output]
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  if (!valid(input) || !valid(output)) return null
  return { inputTokens: input, outputTokens: output }
}

/** UTC calendar month as "2026-11". */
export function monthOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 7)
}

export function formatTokens(n: number): string {
  return n.toLocaleString('en-US')
}

/** "$0.0123", with enough digits that a cheap call does not show as $0.00. */
export function formatCost(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

/** The line shown for one call, in the panel. */
export function describeUsage(report: { usage: TokenUsage | null; costUsd: number | null }): string {
  if (!report.usage) return 'Token usage: not reported'
  const tokens = `${formatTokens(report.usage.inputTokens)} tokens in, ${formatTokens(report.usage.outputTokens)} out`
  return report.costUsd === null ? tokens : `${tokens}, ${formatCost(report.costUsd)}`
}
