# WebAlchemist — UI design brief

Design the interface for a Firefox extension. Deliver Svelte 5 + TypeScript components with plain CSS, not mockup images.

---

## What the product does

The user opens any webpage, points at or drags over part of it, and describes what they want changed in plain language. An AI writes the CSS or JavaScript that makes that change. The change persists on every future visit to that site, and when the site ships a redesign that breaks it, the extension detects the breakage and offers to regenerate it.

Mental model: a per-site stylesheet manager where the stylesheets are written by a model from a description, and where the model's output is treated as untrusted code that must pass review before it runs.

---

## Writing style — read this before writing any label

Labels, headings, buttons, and microcopy are **literal and mechanical**. Name things after what they do.

- "Repair with AI" — not "Re-forge", "Revive", "Heal"
- "Hide sidebar" — not "Banish the clutter"
- "Transform" is the noun for a saved change. Not "spell", "recipe", "potion", "brew".
- Error text states what happened and what the user can do about it. No apologising, no personality.

The product name is a metaphor. Do not extend it anywhere in the interface.

---

## Constraints

**Sidebar** renders in Firefox's `sidebar_action` panel. Width is user-resizable — design for **320px**, remain usable at **260px**, use extra space when given it. Vertical space is generous.

**Themes**: support Firefox light and dark. Use `prefers-color-scheme` and Firefox theme CSS variables where available. Do not hardcode a single palette.

**In-page overlay** is injected into arbitrary third-party pages. It must be immune to page CSS in both directions. Assume a shadow root with an `all: initial` reset — every property you rely on must be set explicitly. It also renders over unpredictable backgrounds, so contrast cannot be assumed.

**Accessibility**: keyboard-operable throughout. The element picker is keyboard-driven *by design* — arrow keys walk the DOM tree — so keyboard is the primary input there, not a fallback.

**No Tailwind** unless you argue for it. Plain CSS with custom properties for theming.

---

## Surface 1 — Sidebar panel (primary)

The main workspace. It has more states than it looks like it should; each needs design.

**Idle, no transforms on this site**
Empty state with a single clear action: start picking an element. Should communicate what the extension does to a first-time user without a tutorial.

**Transform list**
Ordered list, drag to reorder (order determines which wins when two transforms conflict — later wins). Each row: enable/disable toggle, name, kind badge (CSS / JS), origin badge (written by you / written by AI), and a status dot when something is wrong. Rows expand to reveal intent, rationale, and code.

**Picking active**
The user is now hovering the page. Sidebar shows the current element's breadcrumb (`body > div#root > main > aside`), keyboard hints for tree navigation, and a cancel affordance. This state is entered from the page, so the sidebar is secondary to the overlay here.

**Describing**
Target is locked. A text input for the intent, plus an opt-in screenshot toggle showing the exact crop that will be sent, plus a visible warning that the image includes whatever is in that region. The toggle is per-request and resets every time — never remembered.

**Generating**
Model output streams in. Show progress meaningfully; this can take 10–30 seconds. The user may want to cancel.

**Preview and refine**
The change is live on the page. The user can type a follow-up ("keep the header though") and regenerate. For CSS this loops freely. **For JS, iteration requires a page reload** — once JavaScript has mutated the DOM, only a reload restores the original state. The UI must be honest about this asymmetry rather than hiding it.

**Review** — *design this carefully, see "The unusual parts" below*

**Saving**
Editable intent field (pre-filled with a model-written consolidation of the conversation), match-pattern presets derived from the current URL, and disclosure of the generated code and rationale.

**Broken transform**
A transform whose target no longer exists on the page. Shows what it was for, which stored assumption stopped holding, and offers repair, edit, or disable.

**Errors**
No provider configured. API call failed. Rate limited. Credential expired. Each needs a distinct, actionable state.

---

## Surface 2 — In-page picker overlay

Renders on top of arbitrary websites. Two gestures produce one result.

**Hover mode**: the element under the cursor is outlined. A small label near it names the element. Arrow keys walk the tree — up to parent, down to first child, left/right to siblings — and the outline follows. Enter confirms, Escape cancels.

**Drag mode**: the user drags a rectangle. It resolves to the common ancestor of the elements it covers, then hands off to hover mode for confirmation.

**The drag rectangle is also the screenshot crop.** If the user opts to send an image, exactly what is inside that rectangle is what leaves the browser. This is the consent surface — it should be legible as a boundary, and it must remain visible and adjustable before sending.

Design considerations: the outline must be visible over any background including busy images, pure white, and pure black. It must not obscure the thing being selected. Everything must survive a page with aggressive `z-index` and `!important` rules.

---

## Surface 3 — Settings page

- **Providers**: a list, each with a name, type (Anthropic / OpenAI-compatible), base URL where applicable, and credential state. Credentials are **write-only** — the UI can set or clear a key and show "configured / not configured", but can never read the value back. Design for that: no masked-value field that implies the value is retrievable.
- **Storage disclosure**: state plainly that credentials are stored in the browser profile directory, protected by file permissions only. Browsers offer no OS-keychain storage to extensions. Do not imply otherwise.
- **Models**: which model generates, which reviews. Show pricing so the choice is informed.
- **Health check frequency**: every page load (default) / once per site per session / manual only.
- **Global kill switch**: disable all AI-authored JavaScript everywhere, immediately.
- **Export / import** transforms.

---

## Surface 4 — Toolbar icon and badge

States: idle, N transforms active on this site, M transforms broken, work in progress. The badge is often the only signal a user gets that something broke, so "broken" must read differently from "active" at a glance and at 16px.

---

## Surface 5 — First run

Nothing works without a configured provider. Get the user from install to a working credential with the least ceremony possible, and explain what the extension will send to that provider before they enter a key.

---

## The unusual parts — where design effort matters most

### Safety review

AI-written JavaScript passes three checks before it can run, and the results need to be legible to someone who cannot read code:

1. **Static analysis** — a scan for network calls, `eval`, cookie and storage access. Produces specific findings with line references.
2. **Declared capabilities** — each transform declares what it needs (network, storage, cookies). The default is nothing. Anything beyond that is a permission the user grants or refuses.
3. **Model review** — a second model reads the code and the user's stated intent and reports whether the code does only what the intent describes.

Design problems to solve: a finding must be understandable without reading the code, but the code must be one click away. A capability request must read as a decision, not a warning to dismiss. A clean review should be quiet — if every save shows a green banner, the user stops reading them, and the one that matters gets clicked through.

### Repair

A transform breaks because the site changed. The user did not do anything wrong and probably has not noticed yet. The interface should communicate: this is expected, it is fixable in one click, and here is what specifically stopped being true.

```
Dark comment tree
  You wanted: dark background on the comment tree
  What broke: no element matches .comment
              (this transform assumed that class name was stable)
  [Repair with AI]  [Edit]  [Disable]
```

### Save flow

Three things happen at once and they should not feel like a form: confirming what you meant, choosing where it applies, and approving what it does. Sequence and progressive disclosure matter more than density.

---

## Data shapes

```ts
type Transform = {
  id: string
  enabled: boolean
  order: number
  match: string                      // "reddit.com/r/programming/*"
  kind: 'css' | 'js'
  origin: 'manual' | 'ai'
  world?: 'USER_SCRIPT' | 'MAIN'     // js only
  capabilities: ('network' | 'storage' | 'cookies')[]   // default []
  intent: string                     // user-editable, plain language
  rationale: {                       // model-written, regenerated on repair
    targets: string
    approach: string
    assumptions: string[]
  }
  anchor: {                          // machine-checkable form of assumptions
    tag: string
    classes: string[]
    text?: string
    role?: string
    path: string
    landmarks: string[]
  }
  code: string
  status: 'ok' | 'broken' | 'disabled'
}

type ReviewResult = {
  static: { line: number; api: string; severity: 'block' | 'warn' }[]
  capabilities: { requested: string[]; undeclared: string[] }
  model: { verdict: 'match' | 'mismatch' | 'uncertain'; explanation: string }
}
```

---

## What to deliver

Svelte 5 components with plain CSS, covering every state listed above including the empty, loading, and error states. A small set of shared CSS custom properties for theming across both surfaces. The picker overlay as a self-contained component that assumes a hostile style environment.

Prioritise the sidebar transform list, the save flow, and the review surface. Those are used constantly and are the hardest to get right.
