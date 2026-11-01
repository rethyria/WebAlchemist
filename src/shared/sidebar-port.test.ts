/**
 * Port names for the docked sidebar and for a panel open in a tab (#128).
 */

import { describe, expect, it } from 'vitest'
import {
  isSidebarPortName,
  ownerOfSidebarPort,
  panelOwner,
  panelPortName,
  sidebarPortName,
  windowOfSidebarPort,
} from './sidebar-port'

describe('sidebar port names', () => {
  it('carries the window id for the docked sidebar', () => {
    expect(ownerOfSidebarPort(sidebarPortName(3))).toBe(3)
    expect(windowOfSidebarPort(sidebarPortName(3))).toBe(3)
  })

  it('carries the panel tab id for a panel in a tab, as a key that is not a window id', () => {
    const name = panelPortName(50)
    expect(name).toBe('wa-sidebar:tab:50')
    expect(isSidebarPortName(name)).toBe(true)
    expect(ownerOfSidebarPort(name)).toBe(panelOwner(50))
    expect(panelOwner(50)).toBeLessThan(0)
    expect(windowOfSidebarPort(name)).toBeUndefined()
  })

  it('carries no owner without an id', () => {
    expect(ownerOfSidebarPort(sidebarPortName(undefined))).toBeUndefined()
    expect(ownerOfSidebarPort('wa-sidebar:tab:')).toBeUndefined()
    expect(ownerOfSidebarPort('wa-sidebar:tab:x')).toBeUndefined()
    expect(ownerOfSidebarPort('wa-sidebar:tab:0')).toBeUndefined()
  })
})
