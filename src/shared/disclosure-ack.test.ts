import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DISCLOSURE_VERSION } from './disclosure'
import {
  DISCLOSURE_ACK_KEY,
  needsDisclosure,
  readDisclosureNeeded,
  recordDisclosureAck,
} from './disclosure-ack'

describe('needsDisclosure', () => {
  it('is true on a fresh profile, where nothing is stored', () => {
    expect(needsDisclosure(undefined)).toBe(true)
  })

  it('is false for a profile that acknowledged the current version (control)', () => {
    expect(needsDisclosure({ version: DISCLOSURE_VERSION })).toBe(false)
  })

  it('is true again after the version is raised, for a profile that acknowledged the earlier one', () => {
    const earlier = { version: DISCLOSURE_VERSION }
    expect(needsDisclosure(earlier, DISCLOSURE_VERSION + 1)).toBe(true)
    // Control: the same record at the version it was stored for.
    expect(needsDisclosure(earlier, DISCLOSURE_VERSION)).toBe(false)
  })

  it('is false for a later version, so a downgrade does not ask again', () => {
    expect(needsDisclosure({ version: DISCLOSURE_VERSION + 1 })).toBe(false)
  })

  it('treats an unreadable value as not acknowledged', () => {
    for (const value of [null, 'yes', 1, true, {}, { version: '1' }, { version: NaN }]) {
      expect(needsDisclosure(value)).toBe(true)
    }
  })
})

describe('the stored record', () => {
  const store: Record<string, unknown> = {}

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key]
    ;(globalThis as { browser?: unknown }).browser = {
      storage: {
        local: {
          get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
          set: async (items: Record<string, unknown>) => void Object.assign(store, items),
        },
      },
    }
  })

  afterEach(() => {
    delete (globalThis as { browser?: unknown }).browser
  })

  it('needs the disclosure until it is acknowledged, then does not', async () => {
    expect(await readDisclosureNeeded()).toBe(true)
    await recordDisclosureAck()
    expect(await readDisclosureNeeded()).toBe(false)
  })

  it('stores the version with the acknowledgement', async () => {
    await recordDisclosureAck()
    expect((store[DISCLOSURE_ACK_KEY] as { version: number }).version).toBe(DISCLOSURE_VERSION)
  })
})
