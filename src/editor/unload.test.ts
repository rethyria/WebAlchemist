import { describe, expect, it } from 'vitest'
import { shouldConfirmLeaving } from './unload'

describe('shouldConfirmLeaving', () => {
  it('asks when there are unsaved changes', () => {
    expect(shouldConfirmLeaving(true, false)).toBe(true)
  })

  it('does not ask when nothing is unsaved', () => {
    expect(shouldConfirmLeaving(false, false)).toBe(false)
  })

  it('does not ask for the reload that follows a successful Create, where dirty is still true', () => {
    // Control: before the change the guard looked only at `dirty`, which gives
    // true here.
    expect(shouldConfirmLeaving(true, true)).toBe(false)
  })
})
