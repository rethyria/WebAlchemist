import { describe, expect, it } from 'vitest'
import { KILL_SWITCH_LABEL, KILL_SWITCH_NOTE, killSwitchNotice } from './kill-switch'

describe('kill switch wording', () => {
  it('does not claim to take effect immediately or to leave CSS running', () => {
    expect(KILL_SWITCH_NOTE).not.toMatch(/immediately|keep working|keeps working/i)
    expect(KILL_SWITCH_LABEL).not.toMatch(/AI-written/)
  })

  it('says nothing when no open tab ran JavaScript', () => {
    expect(killSwitchNotice(true, 0)).toBe('')
  })

  it('tells the user to reload, with the number of tabs', () => {
    expect(killSwitchNotice(true, 1)).toContain('One open tab')
    expect(killSwitchNotice(true, 3)).toContain('3 open tabs')
    expect(killSwitchNotice(false, 2)).toMatch(/run JavaScript transforms there again/)
  })
})
