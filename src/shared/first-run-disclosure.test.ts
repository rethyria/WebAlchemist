import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ENFORCEMENT_NOTICE,
  firstRunDisclosure,
  REVOKE_KEY_NOTICE,
  SENT_CHANNELS,
  TRANSFORMS_STORAGE_NOTICE,
} from './disclosure'
import { DISCLOSURE_PLAIN, DISCLOSURE_SEALED } from './vault-disclosure'

const text = (vault = { sealed: false, unlocked: true }) =>
  firstRunDisclosure(vault)
    .flatMap((section) => [section.heading, section.lead ?? '', ...section.items, ...section.paragraphs])
    .join('\n')

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('what the text says', () => {
  const all = text()

  it.each([
    ['the description', /Your description of the change/],
    ['text hidden on the page', /including text that is hidden on the page/],
    ['id, class and role values', /id value[\s\S]*class values[\s\S]*role value/],
    ['matching rules and custom properties', /matching.*custom properties|match the picked element, and the custom properties/],
    ['the address without fragment or query values', /fragment removed and the query values removed/],
    ['a screenshot only if added', /screenshot, only if you add one/],
    ['the provider retention policy', /retention policy applies/],
    ['nothing sent to the developer', /Nothing is sent to the developer/],
    ['Firefox does not enforce the network restriction', /does not enforce a network restriction/],
    ['approving the code is the main protection', /Approving the code is the main protection/],
    ['static analysis and a second model, neither complete', /static analysis[\s\S]*second model\. Neither check is complete/],
    ['CSS is checked, whoever wrote it', /CSS, whether the model or you wrote it, is checked for addresses that it would load/],
    ['the default CSS policy', /By default only data: addresses are allowed/],
    ['the two per-site CSS settings', /Two settings, which are chosen for each site, allow addresses on the page's own site or addresses that you approve/],
    ['@import refused in every setting', /An @import rule is refused in every setting/],
    ['computed styles of the element and four ancestors', /computed style values of the picked element and of up to four of its ancestors/],
    ['elements added as references', /each element that you add as a reference/],
    ['earlier turns and generated code', /earlier follow-up requests[\s\S]*code that the model generated/],
    ['the saved code, description, rationale and reason on repair', /Repair or Edit with AI, the saved code, its description and rationale, and the reason that the transform stopped working/],
    ['access from saving as well as picking', /Picking an element on a site, and saving a transform for a site, give Web Alchemist lasting access/],
    ['what the excluded list stops', /does not run saved JavaScript transforms, does not apply saved CSS, does not count transforms on the toolbar badge, does not check whether transforms still work, and does not load its content script/],
    ['transforms are unencrypted', /stored unencrypted[\s\S]*also when a passphrase is set/],
    ['lasting access to a site, removable under Site access', /lasting access to that site[\s\S]*Site access/],
    ['the excluded list', /excluded list[\s\S]*Excluded sites[\s\S]*starts empty/],
    ['the warning on password and payment pages', /password or payment fields is sent, a warning asks/],
    ['removing the extension does not revoke the key', /does not revoke it/],
  ])('states %s', (_name, pattern) => {
    expect(all).toMatch(pattern)
  })

  it('no longer says that excluded sites are never read', () => {
    expect(all).not.toMatch(/never read/)
  })

  it('reuses the existing constants, so each statement has one source', () => {
    expect(all).toContain(REVOKE_KEY_NOTICE)
    expect(all).toContain(DISCLOSURE_PLAIN)
    expect(all).toContain(ENFORCEMENT_NOTICE)
    expect(all).toContain(TRANSFORMS_STORAGE_NOTICE)
  })

  it('says keys are plain text only while the vault is not sealed', () => {
    const sealed = text({ sealed: true, unlocked: false })
    expect(sealed).toContain(DISCLOSURE_SEALED)
    expect(sealed).not.toContain(DISCLOSURE_PLAIN)
    // Control: the unsealed text has the plain-text sentence.
    expect(all).toContain(DISCLOSURE_PLAIN)
  })

  it('uses sentence-case headings that are noun phrases without a trailing full stop', () => {
    for (const { heading } of firstRunDisclosure({ sealed: false, unlocked: true })) {
      expect(heading).toMatch(/^[A-Z][a-z]/)
      expect(heading).not.toMatch(/[A-Z].*\s[A-Z]/)
      expect(heading).not.toMatch(/[.?!]$/)
    }
  })
})

describe('the channels sent to the provider', () => {
  // The extractor test pins every DOM member the excerpt builder may read.
  // Reading its source keeps that pin where it is, so changing the extractor
  // and this text together is not enough: the pin has to change too.
  const pinned = (source: string): string[] => {
    const match = /const PERMITTED = new Set\(\[([^\]]*)\]\)/.exec(source)
    if (!match) throw new Error('PERMITTED not found in context.test.ts')
    return [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '').sort()
  }

  const listed = Object.keys(SENT_CHANNELS).sort()

  it('names the same members as the pinned list', () => {
    expect(listed).toEqual(pinned(read('../content/context.test.ts')))
  })

  it('fails when the pinned list gains a member that the disclosure lacks (control)', () => {
    const widened = read('../content/context.test.ts').replace(
      "'textContent'])",
      "'textContent', 'outerHTML'])",
    )
    expect(listed).not.toEqual(pinned(widened))
  })

  it('shows one line for each member in the text', () => {
    const all = text()
    for (const line of Object.values(SENT_CHANNELS)) {
      expect(all).toContain(line)
    }
  })
})

/**
 * The conditions that must hold for the template at `index` to be rendered,
 * from the `{#if}` and `{:else}` blocks that enclose it. An else branch lists
 * the condition it follows with a leading "!".
 */
function conditionsAt(source: string, index: number): string[] {
  const stack: { conditions: string[]; previous: string[] }[] = []
  for (const token of source.slice(0, index).matchAll(/\{(#if|:else if|:else|\/if)\b\s*([^}]*)\}/g)) {
    const kind = token[1]
    const condition = (token[2] ?? '').trim()
    if (kind === '#if') stack.push({ conditions: [condition], previous: [] })
    else if (kind === ':else if') {
      const top = stack.at(-1)
      if (top) {
        top.previous.push(...top.conditions)
        top.conditions = [...top.previous.map((c) => `!${c}`), condition]
      }
    } else if (kind === ':else') {
      const top = stack.at(-1)
      if (top) {
        top.previous.push(...top.conditions)
        top.conditions = top.previous.map((c) => `!${c}`)
      }
    } else stack.pop()
  }
  return stack.flatMap((entry) => entry.conditions)
}

describe('the credential fields are unreachable until acknowledged', () => {
  const options = read('../options/App.svelte')
  const providerAt = options.indexOf('<ProviderSettings')
  const disclosureAt = options.indexOf('<FirstRunDisclosure')

  it('finds both components', () => {
    expect(providerAt).toBeGreaterThan(0)
    expect(disclosureAt).toBeGreaterThan(0)
  })

  it('renders the provider section, which holds the key fields and Sign in, only when no disclosure is needed', () => {
    expect(conditionsAt(options, providerAt)).toContain('!disclosureNeeded')
    expect(conditionsAt(options, providerAt)).not.toContain('disclosureNeeded')
  })

  it('renders the disclosure when it is needed (control: the same helper reports the other branch)', () => {
    expect(conditionsAt(options, disclosureAt)).toContain('disclosureNeeded')
    expect(conditionsAt(options, disclosureAt)).not.toContain('!disclosureNeeded')
  })

  it('reports no guard when the block is removed (control)', () => {
    const unguarded = options
      .replace('{#if disclosureNeeded}', '{#if settings}')
      .replace('{:else}\n      <ProviderSettings', '{/if}\n      <ProviderSettings')
    expect(conditionsAt(unguarded, unguarded.indexOf('<ProviderSettings'))).not.toContain('!disclosureNeeded')
  })

  it('holds every password field and the Sign in button inside ProviderSettings only', () => {
    // If a key field or the button appeared in another component, this guard
    // would not cover it. Control: ProviderSettings itself does contain them.
    const provider = read('../options/ProviderSettings.svelte')
    expect(provider).toMatch(/type="password"/)
    expect(provider).toMatch(/Sign in/)
    for (const path of ['../options/App.svelte', '../options/VaultSettings.svelte', '../sidebar/App.svelte', '../sidebar/components/Settings.svelte']) {
      expect(read(path)).not.toMatch(/placeholder="sk-|API key<\/span>/)
    }
    expect(read('../sidebar/components/Settings.svelte')).not.toMatch(/type="password"/)
    expect(read('../sidebar/App.svelte')).not.toMatch(/type="password"/)
  })
})

describe('the sidebar holds back the model until acknowledged', () => {
  const sidebar = read('../sidebar/App.svelte')

  it('wraps every model action in describe', () => {
    // The two buttons that start a described pick, and the three row actions
    // that lead to a generation. Re-picking inside the describing step is past
    // the gate and is not one of them.
    expect(sidebar.match(/describe\(\(\) => void flow\.startPicking\(\)\)/g)?.length).toBe(2)
    for (const action of ['editWithAi', 'editIntent', 'repair']) {
      const calls = [...sidebar.matchAll(new RegExp(`flow\\.${action}\\(`, 'g'))]
      expect(calls.length).toBe(1)
      for (const call of calls) {
        expect(sidebar.slice(Math.max(0, (call.index ?? 0) - 40), call.index)).toMatch(/describe\(\(\) => void $/)
      }
    }
  })

  it('has no button that starts a described pick without describe', () => {
    expect(sidebar).not.toMatch(/onclick=\{\(\) => void flow\.startPicking\(\)\}/)
  })

  it('leaves "Write it myself" unwrapped, because it needs no provider', () => {
    const own = [...sidebar.matchAll(/flow\.startPicking\('author'\)/g)]
    expect(own.length).toBeGreaterThanOrEqual(3)
    for (const call of own) {
      expect(sidebar.slice(Math.max(0, (call.index ?? 0) - 40), call.index)).not.toMatch(/describe\(/)
    }
  })

  it('reports an unwrapped call (control)', () => {
    const unwrapped = sidebar.replace('describe(() => void flow.editIntent(', 'void flow.editIntent(')
    const call = unwrapped.indexOf('flow.editIntent(')
    expect(unwrapped.slice(Math.max(0, call - 80), call)).not.toMatch(/describe\(\(\) => void $/)
  })
})

describe('the limits stated for the excerpt', () => {
  const extractor = read('../content/context.ts')
  const limit = (name: string) => Number(new RegExp(`const ${name} = (\\d+)`).exec(extractor)?.[1])

  it('says 80 characters, the extractor limit on text', () => {
    expect(limit('MAX_TEXT_LENGTH')).toBe(80)
    expect(SENT_CHANNELS.textContent).toContain(`up to ${limit('MAX_TEXT_LENGTH')} characters`)
  })

  it('says four ancestors, the extractor limit', () => {
    expect(limit('MAX_ANCESTORS')).toBe(4)
    expect(SENT_CHANNELS.children).toContain('up to four of its ancestors')
    expect(text()).toContain('up to four of its ancestors')
  })

  it('does not claim that the text of ancestors is sent (control: the extractor reads text only in the excerpt)', () => {
    expect(SENT_CHANNELS.textContent).not.toMatch(/ancestors/)
    // Ancestors are built without textContent; the only read is in summariseSubtree.
    const ancestorChain = /function ancestorChain[\s\S]*?\n}\n/.exec(extractor)?.[0] ?? ''
    expect(ancestorChain.length).toBeGreaterThan(0)
    expect(ancestorChain).not.toContain('textContent')
  })
})

describe('the version', () => {
  it('shows the text again to someone who accepted version 1, which said excluded sites are never read', async () => {
    const { needsDisclosure } = await import('./disclosure-ack')
    expect(needsDisclosure({ version: 1 })).toBe(true)
  })
})
