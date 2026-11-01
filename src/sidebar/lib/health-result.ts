import type { ContentEvent } from '@shared/messages'

export type HealthCheckResult = Extract<ContentEvent, { type: 'health-check-result' }>

/**
 * Whether a health result describes the tab the panel is showing.
 *
 * The background publishes the result of every tab's check to every open
 * extension page. Without this test, a background tab finishing its load
 * replaced the states of the tab on screen with its own.
 */
export function isForTab(result: HealthCheckResult, shownTabId: number | undefined): boolean {
  return shownTabId !== undefined && result.tabId === shownTabId
}
