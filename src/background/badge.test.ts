/**
 * Badge precedence.
 *
 * The live run in `test/badge/` covers the four states one at a time, which is
 * what #29 asks for. It cannot easily stage the combinations — a tab that is
 * generating *and* has a broken transform *and* has a count — and those are
 * where a precedence rule is either right or silently wrong.
 */

import { describe, expect, it } from 'vitest'
import { badgeFor, type TabFacts } from './badge'

const facts = (over: Partial<TabFacts> = {}): TabFacts => ({
  matching: 0,
  broken: 0,
  working: false,
  ...over,
})

describe('what the badge shows', () => {
  it('shows nothing when the site has no transforms', () => {
    expect(badgeFor(facts())).toBeNull()
  })

  it('shows the count when it does', () => {
    expect(badgeFor(facts({ matching: 3 }))?.text).toBe('3')
  })

  it('shows the dots while a generation is running', () => {
    expect(badgeFor(facts({ matching: 3, working: true }))?.text).toBe('··')
  })

  it('shows ! when a check found something broken', () => {
    expect(badgeFor(facts({ matching: 3, broken: 1 }))?.text).toBe('!')
  })

  it('lets working win over broken, and gives broken back afterwards', () => {
    const during = facts({ matching: 2, broken: 1, working: true })
    expect(badgeFor(during)?.text).toBe('··')
    expect(badgeFor({ ...during, working: false })?.text).toBe('!')
  })

  /*
   * A generation can be started from the panel before anything has been saved,
   * so working has to stand on its own rather than needing a count under it.
   */
  it('shows the dots on a tab with no transforms yet', () => {
    expect(badgeFor(facts({ working: true }))?.text).toBe('··')
  })

  it('uses the broken hue only for broken', () => {
    expect(badgeFor(facts({ matching: 1, broken: 1 }))?.background).toBe('#ef8354')
    expect(badgeFor(facts({ matching: 1 }))?.background).toBe('accent')
    expect(badgeFor(facts({ working: true }))?.background).toBe('accent')
  })

  it('counts transforms rather than reporting a boolean', () => {
    // A count of 1 and a count of 9 have to differ, or "active" is all it says.
    expect(badgeFor(facts({ matching: 1 }))?.text).toBe('1')
    expect(badgeFor(facts({ matching: 9 }))?.text).toBe('9')
  })
})
