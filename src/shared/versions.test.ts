import { describe, expect, it } from 'vitest'
import { compareWithCurrent } from './versions'
import type { Transform, TransformVersion } from './types'

const current = {
  id: 'T',
  kind: 'js',
  match: 'example.com/*',
  code: 'a()',
  capabilities: [],
  world: 'USER_SCRIPT',
} as unknown as Transform

const version = {
  id: 'V',
  code: 'b()',
  match: 'example.com/*',
  capabilities: [],
  world: 'USER_SCRIPT',
  savedAt: 1,
} as unknown as TransformVersion

const row = (rows: ReturnType<typeof compareWithCurrent>, label: string) => rows.find((r) => r.label === label)!

describe('compareWithCurrent', () => {
  it('marks every value the same when the version only differs in code (control)', () => {
    const rows = compareWithCurrent(current, version)
    expect(rows.map((r) => r.status)).toEqual(['Same', 'Same', 'Same'])
  })

  it('marks a restored MAIN world and a restored capability as different, in words', () => {
    const rows = compareWithCurrent(current, { ...version, world: 'MAIN', capabilities: ['network'] })
    expect(row(rows, 'World')).toMatchObject({ status: 'Different' })
    expect(row(rows, 'World').version).toContain('MAIN')
    expect(row(rows, 'World').current).toContain('USER_SCRIPT')
    expect(row(rows, 'Capabilities')).toMatchObject({ current: 'None', version: 'network', status: 'Different' })
  })

  it('marks a different match pattern', () => {
    const rows = compareWithCurrent(current, { ...version, match: '*.example.com/*' })
    expect(row(rows, 'Match pattern')).toMatchObject({
      current: 'example.com/*',
      version: '*.example.com/*',
      status: 'Different',
    })
  })

  it('treats an absent world as USER_SCRIPT', () => {
    const { world: _world, ...withoutWorld } = version
    expect(row(compareWithCurrent(current, withoutWorld as TransformVersion), 'World').status).toBe('Same')
  })

  it('does not compare the capability order', () => {
    const both = { ...current, capabilities: ['storage', 'network'] } as unknown as Transform
    const rows = compareWithCurrent(both, { ...version, capabilities: ['network', 'storage'] })
    expect(row(rows, 'Capabilities').status).toBe('Same')
  })

  it('does not report a world for CSS', () => {
    const css = { ...current, kind: 'css' } as unknown as Transform
    expect(row(compareWithCurrent(css, { ...version, world: 'MAIN' }), 'World')).toMatchObject({
      status: 'Same',
      current: 'Not used by CSS',
    })
  })
})
