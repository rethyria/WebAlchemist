/**
 * W2 / #44 — which page-controlled channels reach the model?
 *
 * The fixture carries a distinct marker in every channel a page controls. This
 * asks the real content script for the real context — through
 * `context-for-anchor`, the same handler a repair uses — and reports which
 * markers came back.
 *
 * No model is called. The question is what would be *sent*, and that is
 * answerable without spending anything.
 *
 * Controls:
 *   - A marker present in the fixture but placed in a channel expected to be
 *     excluded is only meaningful if some marker DOES come through. At least
 *     one hit is required before any "excluded" claim is believed.
 *   - A marker that appears nowhere in the fixture must not be found.
 *   - The context must be non-empty and name the fixture's own selector, or
 *     the extraction never ran on the right element.
 */
import { open, verdict } from '../crypto/rdp.mjs'

const PAGE = 'http://localhost:8788/?q=ZZ-URLQUERY-ZZ'

/** Every marker in the fixture, and where it lives. */
const CHANNELS = [
  ['ZZ-IDATTR-ZZ', 'id attribute'],
  ['ZZ-CLASSATTR-ZZ', 'class attribute'],
  ['ZZ-ROLEATTR-ZZ', 'role attribute'],
  ['ZZ-ARIALABEL-ZZ', 'aria-label attribute'],
  ['ZZ-TITLEATTR-ZZ', 'title attribute'],
  ['ZZ-DATAATTR-ZZ', 'data-* attribute'],
  ['ZZ-ALTATTR-ZZ', 'alt attribute'],
  ['ZZ-BODYDATA-ZZ', 'data-* on body'],
  ['ZZ-COMMENTINSIDE-ZZ', 'HTML comment inside the target'],
  ['ZZ-COMMENTBEFORE-ZZ', 'HTML comment before the target'],
  ['ZZ-COMMENTAFTER-ZZ', 'HTML comment after the target'],
  ['ZZ-LEAFTEXT-ZZ', 'text of a leaf element'],
  ['ZZ-NESTEDLEAFTEXT-ZZ', 'text of a nested leaf'],
  ['ZZ-NONLEAFTEXT-ZZ', 'text of a non-leaf element'],
  ['ZZ-HIDDENTEXT-ZZ', 'text hidden by display:none'],
  ['ZZ-PASTTRUNCATION-ZZ', 'text past the 80-character truncation limit'],
  ['ZZ-ANCESTORTEXT-ZZ', 'text in an ancestor'],
  ['ZZ-ANCESTORCLASS-ZZ', 'class on an ancestor'],
  ['ZZ-CSSSELECTOR-ZZ', 'author CSS selector text'],
  ['ZZ-CSSCONTENT-ZZ', 'author CSS content: value'],
  ['ZZ-CSSDECLARATION-ZZ', 'author CSS declaration text of a matching rule'],
  ['ZZ-URLQUERY-ZZ', 'page URL query string'],
  ['ZZ-CSSVARNAME-ZZ', 'CSS custom property name'],
  ['ZZ-CSSVARVALUE-ZZ', 'CSS custom property value'],
  ['ZZ-FONTFAMILY-ZZ', 'computed font-family value'],
  ['ZZ-TITLETAG-ZZ', '<title> element'],
  ['ZZ-PASTVALUECAP-ZZ', 'custom property value past the length cap'],
]

const NEVER_IN_FIXTURE = 'ZZ-NOTPRESENT-ZZ'

const rdp = open()
const ctx = await rdp.contexts({ waitMs: 3000 })
const B = ctx.background
if (!B) {
  console.log('BACKGROUND NOT ALIVE')
  rdp.close()
  process.exit(1)
}

/*
 * The origin has to be granted before a content script is registered for it.
 * permissions.request needs a live gesture, which a script does not have, so
 * this goes in through the parent process the same way a user's click would
 * end up.
 *
 * Note the pattern has no port. A match pattern carrying one is accepted and
 * then matches nothing — that mistake cost a whole CSP run once.
 */
console.log(
  'grant:',
  await ctx.parent.run(`(async () => {
    const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs")
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs")
    const ext = ExtensionParent.GlobalManager.extensionMap.get("@webalchemist")
    await ExtensionPermissions.add("@webalchemist", { permissions: [], origins: ["http://localhost/*"] }, ext)
    return "granted http://localhost/*"
  })()`),
)

await new Promise((r) => setTimeout(r, 1500))
console.log('registered content scripts:', await B.run(`browser.scripting.getRegisteredContentScripts().then(s => JSON.stringify(s.map(x => x.matches)))`))

const tabId = Number(
  await B.run(`browser.tabs.create({ url: ${JSON.stringify(PAGE)}, active: true }).then(t => t.id)`),
)
console.log('fixture tab:', tabId)
await new Promise((r) => setTimeout(r, 3500))

const raw = await B.long(`browser.tabs.sendMessage(${tabId}, {
  type: 'context-for-anchor',
  anchor: {
    tag: 'article',
    classes: ['card'],
    path: 'body > main > section > article',
    landmarks: ['main'],
    selector: '#ZZ-IDATTR-ZZ'
  }
}).then(r => JSON.stringify(r), e => 'ERR ' + e.message)`)

if (raw.startsWith('ERR') || raw === 'null') {
  console.log('extraction failed:', raw.slice(0, 300))
  await B.run(`browser.tabs.remove(${tabId}).then(() => 'closed')`)
  rdp.close()
  process.exit(1)
}

const answer = JSON.parse(raw)
const context = answer.context
const serialised = JSON.stringify(context)

console.log(`\ncontext is ${serialised.length} bytes`)
console.log('target selector:', context.target.selector)
console.log('markup excerpt:')
for (const line of context.target.outerHTMLExcerpt.split('\n')) console.log('   ', line)

const reached = []
const excluded = []
for (const [marker, where] of CHANNELS) {
  ;(serialised.includes(marker) ? reached : excluded).push(where)
}

console.log(`\nREACHES the model (${reached.length}):`)
for (const w of reached) console.log('  +', w)
console.log(`\nEXCLUDED (${excluded.length}):`)
for (const w of excluded) console.log('  -', w)

/* Where in the payload each surviving marker landed, so it can be fixed. */
console.log('\nwhich part of the context carries them:')
const parts = {
  'target.outerHTMLExcerpt': JSON.stringify(context.target.outerHTMLExcerpt),
  'target.selector': JSON.stringify(context.target.selector),
  'target.computedStyles': JSON.stringify(context.target.computedStyles),
  'target.matchedRules': JSON.stringify(context.target.matchedRules),
  ancestors: JSON.stringify(context.ancestors),
  customProperties: JSON.stringify(context.customProperties),
  url: JSON.stringify(context.url),
}
for (const [name, text] of Object.entries(parts)) {
  const found = CHANNELS.filter(([m]) => text.includes(m)).map(([, w]) => w)
  if (found.length) console.log(`  ${name}: ${found.join(', ')}`)
}

await B.run(`browser.tabs.remove(${tabId}).then(() => 'closed')`)
console.log(
  '\nrevoke:',
  await ctx.parent.run(`(async () => {
    const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs")
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs")
    const ext = ExtensionParent.GlobalManager.extensionMap.get("@webalchemist")
    await ExtensionPermissions.remove("@webalchemist", { permissions: [], origins: ["http://localhost/*"] }, ext)
    return "revoked"
  })()`),
)

/* The caps bound volume rather than which channels exist, so they need their own look. */
const propertyCount = Object.keys(context.customProperties).length
const longestProperty = Math.max(0, ...Object.values(context.customProperties).map((v) => v.length))
const longestDeclaration = Math.max(0, ...context.target.matchedRules.map((r) => r.declarations.length))
console.log('\ncaps:')
console.log(`  custom properties kept       : ${propertyCount}  (fixture declares 300+)`)
console.log(`  longest custom property value: ${longestProperty}`)
console.log(`  longest rule declaration     : ${longestDeclaration}`)

verdict([
  /*
   * Not the selector that was sent. `context-for-anchor` recaptures the anchor
   * deliberately — a repair exists because the page changed — so it answers
   * with a freshly derived selector. What has to be true is that it resolved to
   * the right element, and the excerpt is where that shows.
   */
  [`control  the extraction resolved to the fixture's target (${context.target.selector})`,
    context.target.outerHTMLExcerpt.startsWith('<article#ZZ-IDATTR-ZZ')],
  [`control  something reached the model, so "excluded" means something (${reached.length})`,
    reached.length > 0],
  [`control  a marker absent from the fixture is not found`, !serialised.includes(NEVER_IN_FIXTURE)],
  [`control  the excerpt is not empty (${context.target.outerHTMLExcerpt.length} bytes)`,
    context.target.outerHTMLExcerpt.length > 0],
  [`control  the fixture really does flood the property channel (300 declared)`,
    propertyCount > 0],
  [`test     custom properties are capped (${propertyCount} <= 64)`, propertyCount <= 64],
  [`test     a long property value is cut (${longestProperty} <= 121)`, longestProperty <= 121],
  [`test     the tail of an over-long value does not survive`,
    !serialised.includes('ZZ-PASTVALUECAP-ZZ')],
  [`test     rule declarations are capped (${longestDeclaration} <= 401)`, longestDeclaration <= 401],
])

rdp.close()
