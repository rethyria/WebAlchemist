/**
 * W10 / #38 — does every surface hold up in light mode?
 *
 * Measured rather than eyeballed. Every element carrying text is walked, its
 * effective background found by climbing until something is not transparent,
 * and the WCAG contrast ratio computed against the threshold for its size and
 * weight.
 *
 * ## Why the scheme is switched with a pref rather than a style
 *
 * `light-dark()` follows the computed `color-scheme`, so setting
 * `documentElement.style.colorScheme = 'light'` would flip the surfaces. It
 * would not flip the accent, which is chosen by an
 * `@media (prefers-color-scheme: dark)` block — so the run would pair a
 * dark-mode accent against light surfaces and report failures that cannot
 * happen. The pref below drives the media query, which moves both.
 *
 * `ui.systemUsesDarkTheme` was the first thing tried and does not reach content:
 * the dark pass came back reporting `light`. `layout.css.prefers-color-scheme.
 * content-override` is the one that does — 0 dark, 1 light, 2 follow the system.
 *
 * ## What is not covered
 *
 * The sidebar. `sidebarAction.open()` needs a live user gesture a script does
 * not have, so the panel's own surfaces are unmeasured — though it draws from
 * the same tokens, and every token failure found here was a token failure.
 *
 * ## The control
 *
 * A deliberately failing pair is injected into each page and must be reported
 * as failing. Without it, "no failures" is what a checker that computed nothing
 * would also say — and that is exactly the shape of the CSP harness bug that
 * started this project's habit of writing controls.
 */
import { open, verdict } from '../crypto/rdp.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rdp = open()
const ctx = await rdp.contexts({ waitMs: 2500 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  process.exit(1)
}

/** Runs in the page: finds every text/background pair and scores it. */
const MEASURE = `(() => {
  const parse = (value) => {
    const m = String(value).match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const parts = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number)
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }

  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })

  const luminance = ({ r, g, b }) => {
    const channel = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  const ratio = (a, b) => {
    const la = luminance(a), lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }

  /* The first ancestor that actually paints something. */
  const backgroundBehind = (element) => {
    let node = element
    let result = { r: 255, g: 255, b: 255, a: 1 }
    const stack = []
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor)
      if (bg && bg.a > 0) stack.push(bg)
      if (bg && bg.a === 1) break
      node = node.parentElement
    }
    for (let i = stack.length - 1; i >= 0; i--) result = over(stack[i], result)
    return result
  }

  const hasOwnText = (element) =>
    [...element.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)

  const findings = []
  for (const element of document.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (Number(style.opacity) === 0) continue
    if (!hasOwnText(element)) continue

    const fg = parse(style.color)
    if (!fg) continue
    const bg = backgroundBehind(element)
    const effective = over(fg, bg)

    const size = parseFloat(style.fontSize)
    const weight = Number(style.fontWeight) || 400
    // WCAG: 18.66px bold or 24px counts as large text.
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const required = large ? 3 : 4.5
    const score = ratio(effective, bg)

    if (score < required) {
      findings.push({
        selector: element.className ? element.tagName.toLowerCase() + '.' + String(element.className).split(/\\s+/)[0] : element.tagName.toLowerCase(),
        text: (element.textContent || '').trim().slice(0, 32),
        color: style.color,
        background: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
        size: size,
        ratio: Math.round(score * 100) / 100,
        required,
      })
    }
  }
  return JSON.stringify(findings)
})()`

/** The control: a pair that must be reported as failing. */
const INJECT_CONTROL = `(() => {
  const bad = document.createElement('p')
  bad.className = 'wa-contrast-control'
  bad.textContent = 'deliberately unreadable'
  bad.style.color = '#f0f0f4'
  bad.style.background = '#ffffff'
  document.body.appendChild(bad)
  return 'injected'
})()`

/*
 * Opened and closed one at a time.
 *
 * The first version of this left every tab open and looked the frame up by
 * URL, so the dark pass found the light pass's still-open page and reported
 * identical numbers for both — the "reports scheme" control is what caught it.
 * A stale frame answers just as readily as a fresh one.
 */
async function measurePage(label, url) {
  const tab = Number(
    await B.run(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: false }).then(t => t.id)`),
  )
  let page = null
  for (let i = 0; i < 20; i += 1) {
    await sleep(900)
    await ctx.refresh()
    page = ctx.find(url.split('/').slice(-2).join('/'))
    if (page && (await page.raw(`document.body ? 'y' : 'n'`)) === 'y') break
    page = null
  }
  if (!page) {
    console.log(`${label}: page never appeared`)
    return { tab, findings: [], controlSeen: false }
  }

  await sleep(1200)
  await page.raw(INJECT_CONTROL)
  const raw = await page.long(MEASURE)
  const scheme = await page.raw(`matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`)
  const findings = raw.startsWith('[') ? JSON.parse(raw) : []
  const controlSeen = findings.some((f) => f.selector.includes('wa-contrast-control'))

  console.log(`\n${label} — reports scheme: ${scheme}`)
  for (const f of findings) {
    const mark = f.selector.includes('wa-contrast-control') ? 'CONTROL' : 'FAIL   '
    console.log(
      `  ${mark} ${String(f.ratio).padStart(5)}:1 (needs ${f.required}) ${f.color} on ${f.background}  ${f.selector}  "${f.text}"`,
    )
  }
  if (findings.length === 0) console.log('  (nothing below threshold, and no control either — suspicious)')

  await B.run(`browser.tabs.remove(${tab}).catch(() => {}).then(() => 'closed')`)
  await sleep(600)
  return { tab: -1, findings: findings.filter((f) => !f.selector.includes('wa-contrast-control')), controlSeen, scheme }
}

const PREF = 'layout.css.prefers-color-scheme.content-override'
const originalPref = await ctx.parent.run(
  `(() => { try { return String(Services.prefs.getIntPref('${PREF}')) } catch { return 'unset' } })()`,
)
console.log(`${PREF} was:`, originalPref)

/*
 * A real transform, so the editor renders its whole surface rather than the
 * "nothing to edit" state. A page that draws four elements cannot fail a
 * contrast check it never ran.
 */
const PROBE_ID = 'wa-contrast-probe'
await B.run(`(async () => {
  const s = await browser.storage.local.get('transforms')
  const keep = (s.transforms || []).filter(t => t.id !== ${JSON.stringify(PROBE_ID)})
  keep.push({ id: ${JSON.stringify(PROBE_ID)}, name: 'Contrast probe', enabled: true, order: 1,
    match: 'example.com/*', kind: 'js', origin: 'ai', capabilities: ['network'],
    intent: 'A transform used to render the editor for a contrast measurement.',
    rationale: { targets: 'h1', approach: 'none', assumptions: ['there is an h1'] },
    anchor: { tag: 'h1', classes: [], path: 'body > h1', landmarks: [], selector: 'h1' },
    code: '/* comment */\\nconst x = "string";\\ndocument.title = x + 1', createdAt: 1, updatedAt: 1 })
  await browser.storage.local.set({ transforms: keep })
  return 'seeded'
})()`)

const results = {}
const tabs = []
try {
  for (const [label, pref] of [['light', 1], ['dark', 0]]) {
    console.log(`\n=== forcing ${label} mode ===`)
    await ctx.parent.run(`(() => { Services.prefs.setIntPref('${PREF}', ${pref}); return '${label}' })()`)
    await sleep(1500)

    const base = ctx.baseUrl()
    results[`options-${label}`] = await measurePage(`options (${label})`, `${base}src/options/index.html`)
    results[`editor-${label}`] = await measurePage(`editor (${label})`, `${base}src/editor/index.html?id=${PROBE_ID}`)
    tabs.push(results[`options-${label}`].tab, results[`editor-${label}`].tab)
  }
} finally {
  console.log(
    '\nrestore pref:',
    await ctx.parent.run(
      originalPref === 'unset'
        ? `(() => { Services.prefs.clearUserPref('${PREF}'); return 'cleared' })()`
        : `(() => { Services.prefs.setIntPref('${PREF}', ${originalPref}); return 'restored' })()`,
    ),
  )
  await B.run(`(async () => {
    const s = await browser.storage.local.get('transforms')
    await browser.storage.local.set({ transforms: (s.transforms || []).filter(t => t.id !== ${JSON.stringify(PROBE_ID)}) })
    await Promise.all(${JSON.stringify([])}.concat(${JSON.stringify([])}).map(() => {}))
    return 'unseeded'
  })()`)
  for (const tab of tabs) {
    if (tab > 0) await B.run(`browser.tabs.remove(${tab}).catch(() => {}).then(() => 'closed')`)
  }
}

const keys = Object.keys(results)
const all = keys.flatMap((k) => results[k]?.findings ?? [])

verdict([
  [`control  the light pages really rendered light (${results['options-light']?.scheme})`,
    results['options-light']?.scheme === 'light'],
  [`control  the dark pages really rendered dark (${results['options-dark']?.scheme})`,
    results['options-dark']?.scheme === 'dark'],
  [`control  the known-bad pair is reported failing on all ${keys.length} pages`,
    keys.every((k) => results[k]?.controlSeen === true)],
  [`test     every real text pair meets its WCAG threshold (${all.length} below)`, all.length === 0],
])

rdp.close()
