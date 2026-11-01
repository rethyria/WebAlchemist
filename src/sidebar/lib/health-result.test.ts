import { describe, expect, it } from 'vitest'
import { isForTab, type HealthCheckResult } from './health-result'

const result = (tabId: number): HealthCheckResult => ({
  type: 'health-check-result',
  tabId,
  states: [],
})

describe('which health results the panel shows', () => {
  it('accepts the result for the tab on screen', () => {
    expect(isForTab(result(7), 7)).toBe(true)
  })

  it('ignores the result for another tab', () => {
    expect(isForTab(result(8), 7)).toBe(false)
  })

  it('ignores every result when the panel has no tab', () => {
    expect(isForTab(result(7), undefined)).toBe(false)
  })
})
