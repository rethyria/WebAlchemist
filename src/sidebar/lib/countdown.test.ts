import { describe, expect, it } from 'vitest'
import { announcedSeconds, announcement } from './countdown'

describe('announcedSeconds', () => {
  it('changes only a few times over a 30-second countdown', () => {
    const wait = Array.from({ length: 30 }, (_, i) => 30 - i)
    const announced = wait.map(announcedSeconds)
    // Control: announcing the real value would give 30 distinct values.
    expect(new Set(announced).size).toBe(3)
    expect(announced[0]).toBe(30)
    expect(announced[announced.length - 1]).toBe(5)
  })

  it('never announces a wait shorter than the real one', () => {
    for (let n = 1; n <= 200; n++) expect(announcedSeconds(n)).toBeGreaterThanOrEqual(n)
  })

  it('changes once a minute above 60 seconds', () => {
    expect(announcedSeconds(61)).toBe(120)
    expect(announcedSeconds(120)).toBe(120)
    expect(announcedSeconds(121)).toBe(180)
  })
})

describe('announcement', () => {
  it('says "up to" at exactly 30 seconds, where "less than 30" is wrong', () => {
    expect(announcement(30)).toBe('Trying again in up to 30 seconds')
  })

  it('never says "less than", for any wait up to two minutes', () => {
    for (let n = 1; n <= 120; n++) expect(announcement(n)).not.toMatch(/less than/)
  })

  it('names the step that is not below the real wait (control)', () => {
    expect(announcement(29)).toBe('Trying again in up to 30 seconds')
    expect(announcement(31)).toBe('Trying again in up to 60 seconds')
  })
})
