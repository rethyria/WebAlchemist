/**
 * Anchor capture and resolution.
 *
 * An anchor is the machine-checkable record of what a transform targets. Its
 * human-readable twin is `rationale.assumptions`, which the model writes in the
 * same pass — when resolution fails, the assumption text is what we show the
 * user, and the anchor is what told us to show it.
 *
 * Resolution is deliberately multi-signal. A stored selector alone breaks the
 * first time a site changes a class name; scoring several independent signals
 * lets a transform survive changes to any one of them.
 */

import type { Anchor } from '@shared/types'

/**
 * Class tokens that look machine-generated. These change on every deploy, so
 * they are worse than useless as anchors — they produce confident matches that
 * silently stop working.
 */
const BUILD_HASH_PATTERNS: RegExp[] = [
  /^css-[a-z0-9]{5,}$/i, // emotion
  /^sc-[A-Za-z0-9]{5,}$/, // styled-components
  /^jsx-\d+$/, // styled-jsx
  /^[a-z]+_[a-zA-Z0-9]{5,}$/, // CSS modules, e.g. button_3fA9x
  /^_[a-zA-Z0-9]{6,}$/,
  /^[a-f0-9]{8,}$/i, // bare hashes
  /^[a-zA-Z0-9_-]{12,}$/, // long opaque tokens
]

export function isBuildHashClass(token: string): boolean {
  return BUILD_HASH_PATTERNS.some((pattern) => pattern.test(token))
}

const LANDMARK_SELECTOR =
  'header, footer, nav, main, aside, article, section, [role], [aria-label], [id]'

const TEXT_SAMPLE_LENGTH = 60

export function captureAnchor(element: Element): Anchor {
  const classes = Array.from(element.classList).filter((c) => !isBuildHashClass(c))
  const role = element.getAttribute('role') ?? undefined
  const id = element.id && !isBuildHashClass(element.id) ? element.id : undefined

  const text = (element.textContent ?? '').trim().slice(0, TEXT_SAMPLE_LENGTH)

  return {
    tag: element.tagName.toLowerCase(),
    classes,
    ...(id ? { id } : {}),
    ...(role ? { role } : {}),
    ...(text ? { text } : {}),
    path: structuralPath(element),
    landmarks: nearbyLandmarks(element),
    selector: buildSelector(element, classes, id, role),
  }
}

/**
 * Builds the most durable selector available, preferring signals that survive
 * a redesign. Order matters: an id or ARIA role outlives a class name, which
 * outlives a positional chain.
 */
function buildSelector(
  element: Element,
  classes: string[],
  id: string | undefined,
  role: string | undefined,
): string {
  const tag = element.tagName.toLowerCase()

  if (id) return `#${CSS.escape(id)}`
  if (role) return `${tag}[role="${role}"]`

  const label = element.getAttribute('aria-label')
  if (label) return `${tag}[aria-label="${CSS.escape(label)}"]`

  if (classes.length > 0) {
    const selector = `${tag}.${classes.map((c) => CSS.escape(c)).join('.')}`
    if (document.querySelectorAll(selector).length === 1) return selector
  }

  // Semantic tags are meaningful on their own when unique.
  if (['main', 'header', 'footer', 'nav', 'aside'].includes(tag)) {
    if (document.querySelectorAll(tag).length === 1) return tag
  }

  return structuralPath(element)
}

/** Structural path from the document root. The last-resort locator. */
function structuralPath(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element

  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase()
    const parent: Element | null = current.parentElement
    if (!parent) {
      parts.unshift(tag)
      break
    }
    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === current!.tagName,
    )
    parts.unshift(
      siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag,
    )
    current = parent
  }

  return parts.join(' > ')
}

/** Landmarks near the target, which survive redesigns more often than classes. */
function nearbyLandmarks(element: Element): string[] {
  const landmarks: string[] = []
  let current: Element | null = element.parentElement
  let depth = 0

  while (current && depth < 5) {
    if (current.matches(LANDMARK_SELECTOR)) {
      const role = current.getAttribute('role')
      const id = current.id && !isBuildHashClass(current.id) ? current.id : null
      const tag = current.tagName.toLowerCase()
      landmarks.push(role ? `${tag}[role=${role}]` : id ? `${tag}#${id}` : tag)
    }
    current = current.parentElement
    depth += 1
  }

  return landmarks
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export interface Resolution {
  element: Element
  /** 0..1. Below RESOLUTION_THRESHOLD the match is treated as a failure. */
  confidence: number
  /** Signals that no longer hold, used to explain what changed. */
  lostSignals: string[]
}

export const RESOLUTION_THRESHOLD = 0.5

/**
 * Finds the element an anchor refers to, or reports why it could not.
 *
 * Returning a low-confidence match as a failure is deliberate. A site that
 * reuses a class name for something else will produce a confident-looking
 * `querySelector` hit on the wrong element, and silently transforming the wrong
 * thing is worse than reporting breakage.
 */
export function resolveAnchor(anchor: Anchor): Resolution | null {
  const candidates = new Set<Element>()

  const collect = (selector: string) => {
    try {
      for (const found of document.querySelectorAll(selector)) candidates.add(found)
    } catch {
      // Selector no longer parses against this document; try the next signal.
    }
  }

  collect(anchor.selector)
  if (anchor.role) collect(`${anchor.tag}[role="${anchor.role}"]`)
  if (anchor.id) collect(`#${CSS.escape(anchor.id)}`)
  if (anchor.classes.length > 0) {
    collect(`${anchor.tag}.${anchor.classes.map((c) => CSS.escape(c)).join('.')}`)
  }
  collect(anchor.path)
  if (candidates.size === 0) collect(anchor.tag)

  if (candidates.size === 0) return null

  let best: Resolution | null = null
  for (const candidate of candidates) {
    const scored = score(anchor, candidate)
    if (!best || scored.confidence > best.confidence) best = scored
  }

  if (!best || best.confidence < RESOLUTION_THRESHOLD) return null
  return best
}

/**
 * Weighted signal comparison. Weights reflect durability: ARIA roles and ids
 * change far less often than class names, and structural position least
 * reliably of all.
 */
function score(anchor: Anchor, element: Element): Resolution {
  const checks: { name: string; weight: number; holds: boolean }[] = []

  checks.push({
    name: `element is a <${anchor.tag}>`,
    weight: 0.2,
    holds: element.tagName.toLowerCase() === anchor.tag,
  })

  if (anchor.role) {
    checks.push({
      name: `it keeps role="${anchor.role}"`,
      weight: 0.25,
      holds: element.getAttribute('role') === anchor.role,
    })
  }

  if (anchor.id) {
    checks.push({
      name: `it keeps id="${anchor.id}"`,
      weight: 0.25,
      holds: element.id === anchor.id,
    })
  }

  if (anchor.classes.length > 0) {
    const present = anchor.classes.filter((c) => element.classList.contains(c))
    checks.push({
      name: `it keeps the class ${anchor.classes.join(', ')}`,
      weight: 0.2,
      holds: present.length / anchor.classes.length >= 0.5,
    })
  }

  if (anchor.text) {
    const text = (element.textContent ?? '').trim().slice(0, TEXT_SAMPLE_LENGTH)
    checks.push({
      name: `its text still starts "${anchor.text.slice(0, 24)}…"`,
      weight: 0.15,
      holds: similarity(text, anchor.text) > 0.6,
    })
  }

  if (anchor.landmarks.length > 0) {
    const present = anchor.landmarks.filter((landmark) => {
      try {
        return element.closest(landmark) !== null
      } catch {
        return false
      }
    })
    checks.push({
      name: `it still sits inside ${anchor.landmarks[0]}`,
      weight: 0.2,
      holds: present.length > 0,
    })
  }

  const total = checks.reduce((sum, check) => sum + check.weight, 0)
  const held = checks.reduce((sum, check) => (check.holds ? sum + check.weight : sum), 0)

  return {
    element,
    confidence: total === 0 ? 0 : held / total,
    lostSignals: checks.filter((c) => !c.holds).map((c) => c.name),
  }
}

/** Cheap token-overlap similarity. Enough to tell "same text" from "different text". */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const left = new Set(a.toLowerCase().split(/\s+/))
  const right = new Set(b.toLowerCase().split(/\s+/))
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / Math.max(left.size, right.size)
}

/**
 * The nearest ancestor stable enough to scope a MutationObserver to.
 *
 * Observing `document` on a busy site fires thousands of times per second;
 * scoping to a landmark keeps re-application cheap.
 */
export function observerScopeFor(element: Element): Element {
  const landmark = element.closest('main, article, section, aside, nav, header, footer, [role]')
  return landmark?.parentElement ?? landmark ?? document.body
}
