import { describe, expect, it } from 'vitest'
import { attemptNumber } from './attempt'

describe('attemptNumber', () => {
  it('advances by one for each refinement, which adds two history entries', () => {
    // With the previous divisor of 3 this read [1, 1, 1, 2, 2, 2, 3, 3, 3].
    expect([0, 2, 4, 6, 8].map(attemptNumber)).toEqual([1, 2, 3, 4, 5])
  })
})
