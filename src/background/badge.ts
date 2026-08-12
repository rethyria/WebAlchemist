/**
 * The toolbar badge.
 *
 * Four states, per tab, from #29: nothing when the site has no transforms, a
 * count when it does, `··` while the model is writing, and `!` when a health
 * check found something broken.
 *
 * ## What Firefox will not do
 *
 * #29 asks for the broken badge to differ in *shape*, so that it survives
 * colour blindness and whichever accent the user picked — settings warns that
 * red, orange and amber sit close to the broken hue, and the shape difference
 * is what was supposed to make that warning survivable rather than fatal.
 *
 * An extension cannot shape a badge. `browser.action` exposes the text, the
 * background colour and the text colour, and nothing else; the geometry belongs
 * to the browser. `!` against `··` and a number is a glyph difference, which is
 * weaker than a shape difference and is the strongest thing available here.
 *
 * Written down rather than quietly delivered as if it met the design.
 */

import { ACCENT_COLOURS } from '@shared/accents'
import type { Accent } from '@shared/types'

/** #29's broken hue, independent of the accent by design. */
const BROKEN = '#ef8354'
const WORKING_TEXT = '··'
const BROKEN_TEXT = '!'

/**
 * What is true about each tab, rather than which badge it is showing.
 *
 * Storing the facts and deriving the badge is what lets a generation finishing
 * restore the broken marker underneath it, instead of clearing the badge and
 * waiting for the next navigation to notice the transform is still broken.
 */
export interface TabFacts {
  /** Enabled transforms matching this tab's URL. */
  matching: number
  /** How many of them the last health check called broken. */
  broken: number
  /** A generation is running for this tab right now. */
  working: boolean
}

/*
 * Deliberately in memory, and deliberately not authoritative.
 *
 * The MV3 background is an event page, so this is lost on suspension while the
 * badge Firefox is drawing survives it. That is the right way round: the badge
 * keeps showing what was last true rather than blanking, and the next
 * navigation or health check rebuilds the entry. Nothing here is worth
 * persisting to bridge a suspension that only ends when the user acts anyway.
 */
const facts = new Map<number, TabFacts>()

function factsFor(tabId: number): TabFacts {
  const existing = facts.get(tabId)
  if (existing) return existing
  const fresh: TabFacts = { matching: 0, broken: 0, working: false }
  facts.set(tabId, fresh)
  return fresh
}

/**
 * Precedence: working, then broken, then the count.
 *
 * Working wins over broken because it is transient and the user just asked for
 * it — a badge that ignores the action in progress to keep reporting a standing
 * problem reads as unresponsive. The broken marker comes back underneath it
 * when the generation ends, which is why the facts are kept rather than the
 * state.
 */
export function badgeFor(tab: TabFacts): { text: string; background: string } | null {
  if (tab.working) return { text: WORKING_TEXT, background: 'accent' }
  if (tab.broken > 0) return { text: BROKEN_TEXT, background: BROKEN }
  if (tab.matching > 0) return { text: String(tab.matching), background: 'accent' }
  return null
}

async function paint(tabId: number, accent: Accent): Promise<void> {
  const shown = badgeFor(factsFor(tabId))
  const colours = ACCENT_COLOURS[accent]

  try {
    if (!shown) {
      await browser.action.setBadgeText({ text: '', tabId })
      return
    }

    const background = shown.background === 'accent' ? colours.swatch : shown.background
    await browser.action.setBadgeText({ text: shown.text, tabId })
    await browser.action.setBadgeBackgroundColor({ color: background, tabId })
    /*
     * Firefox picks a text colour automatically, and picks it against the
     * background it was given. Amber's swatch is light enough that its
     * automatic choice is legible; setting it explicitly means the accent's own
     * decision about what reads on it is the one that applies.
     */
    await browser.action.setBadgeTextColor({
      color: shown.background === 'accent' ? colours.on : '#15141a',
      tabId,
    })
  } catch {
    // The tab closed between the decision and the call. Nothing to report —
    // there is no badge left to be wrong.
  }
}

/**
 * How many enabled transforms match this tab, and clearing anything a previous
 * page on the same tab left behind.
 *
 * Broken is reset here rather than preserved: it is a fact about the page that
 * was just replaced, and carrying it across a navigation would warn about a
 * site the user is no longer on.
 */
export async function tabNavigated(
  tabId: number,
  matching: number,
  accent: Accent,
): Promise<void> {
  const tab = factsFor(tabId)
  tab.matching = matching
  tab.broken = 0
  await paint(tabId, accent)
}

/** After a save, a delete, or a toggle, where no navigation happened. */
export async function transformCountChanged(
  tabId: number,
  matching: number,
  accent: Accent,
): Promise<void> {
  const tab = factsFor(tabId)
  tab.matching = matching
  await paint(tabId, accent)
}

export async function healthChecked(
  tabId: number,
  brokenCount: number,
  accent: Accent,
): Promise<void> {
  const tab = factsFor(tabId)
  tab.broken = brokenCount
  await paint(tabId, accent)
}

export async function generationStarted(tabId: number, accent: Accent): Promise<void> {
  factsFor(tabId).working = true
  await paint(tabId, accent)
}

export async function generationEnded(tabId: number, accent: Accent): Promise<void> {
  factsFor(tabId).working = false
  await paint(tabId, accent)
}

export function tabClosed(tabId: number): void {
  facts.delete(tabId)
}

/** Exposed for the verification harness, which has no other way to read this. */
export function factsSnapshot(): Record<number, TabFacts> {
  return Object.fromEntries(facts)
}
