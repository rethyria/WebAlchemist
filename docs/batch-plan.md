# Batch plan

Written to be executed in one run by a coordinator agent handing work to
subagents. Every item below says what to build, which files it touches, how it
gets verified, and what it is blocked on.

## Assumptions, stated so they can be corrected

**`#25` in the request is read as `#35`.** The list it answered ran 27, 31, 28,
29, 35, and #25 is closed — it was hand-editing transform code, delivered in
`659d906`. If something else was meant, W5 is the item to change.

Parked at the user's request, not planned here: **#31** export/import (second
thoughts on how it should work), **#28** first run, **#41** packaging and AMO,
**#39** keyboard access, **#37** screenshot verification (the user will run it).

## House rules for every agent

These are how this codebase already works. They are not stylistic.

1. **Commit directly to `main`.** No branches, no PRs. Push when the item is
   done and verified.
2. **Every claim is measured, and every measurement has a control.** A test
   that cannot fail proves nothing. This week alone, controls caught: a CSP
   harness reporting a clean pass while the probe had never run, a scroll rule
   that looked fixed and was not, and a save path that silently wrote nothing.
   When something passes, show the control that would have caught it failing.
3. **Say what was not verified.** Anything needing a real gesture, a paid model
   call, or the user's own machine gets named as unexercised rather than
   implied to be tested.
4. **No narrative in labels, headings or user-facing copy.** Literal, plain.
5. Match the surrounding comment style: comments explain *why*, especially
   where the obvious approach was rejected and what it cost.
6. Run `npm run check`, `npm test` and `npm run build` before committing. The
   build hot-reloads the running Firefox via web-ext, so a broken build is
   immediately a broken extension.
7. The RDP harnesses in `/tmp/*.mjs` are the pattern for live verification:
   connect to port 41365, evaluate in the background, sidebar, page or parent
   process. Reuse them rather than rebuilding the connection code.

## Phases

Phase order is set by file conflicts, not by importance. Items inside a phase
are independent and can run in parallel.

```
Phase A  investigation, no product code     W1  W2  W3  W11
Phase B  independent features               W4  W6  W7(needs W1)
Phase C  authoring cluster, one at a time   W8 → W9 → W5
Phase D  visual pass, after everything      W10
Phase E  sweep and close
```

**Conflict zones.** These files are touched by more than one item, which is
what forces Phase C to serialise:

| File | Items |
|---|---|
| `src/sidebar/lib/flow.svelte.ts` | W8, W9, W5 |
| `src/sidebar/App.svelte` | W8, W9, W4 |
| `src/editor/App.svelte` | W8, W9 |
| `src/shared/tokens.css` + every component | W10 |
| `src/background/providers/anthropic.ts` | W5, W6 |
| `src/background/storage.ts` | W7 |

---

## Phase A — investigation

### W1 · Measure what a non-extractable key buys (#46, first half)

**Why first.** #46 says the measurement comes before the design, and it is
right: if Firefox writes key material into the profile in the clear, the whole
scheme is theatre and should be rejected on those grounds rather than shipped
for the appearance of security.

**Method, with its own control.** A non-extractable key cannot be exported, so
it cannot be searched for directly. Generate *two* keys in an extension page —
one extractable, one not — store both in IndexedDB, and export the raw bytes of
the extractable one. Close the page, then search the profile's IndexedDB files
for those known bytes.

- Bytes found → IndexedDB stores key material in the clear, and the
  non-extractable key is in the same files under the same format. Non-
  extractability then protects against *our own JavaScript*, not against
  reading the profile — which is the threat #46 is about.
- Bytes absent → something wraps it; find out what before claiming anything.

The extractable key is the control: if its bytes cannot be found either, the
search is broken and the run says nothing.

**Output.** `test/crypto/README.md` recording the method, the result and the
recommendation. No product code.

### W2 · Hostile page fixture and the injection surface (#44)

**What already guards this, so it is not rebuilt.** The reviewer never sees page
content; static analysis is deterministic; the user approves the code. What was
lost: runtime containment, when #21 showed `connect-src` does not bind a user
script world. Everything now rests on pre-approval checks.

**Build** `test/injection/page.html`, carrying instructions in every channel a
page controls: visible text, `id` and `class` names, `role` and `aria-label`,
`title`, `alt`, `data-*`, HTML comments, and author CSS — both selector names
and `content:` values.

**Measure, with no model call.** Pick an element on that fixture over RDP and
capture exactly what `extractContext` returns. Publish the list of channels
that reach the model and those that do not.

**Pin it.** Tests asserting that HTML comments and every attribute except
`role` stay out of the payload. They are absent today by accident of how
`summariseSubtree` walks `children`, not by decision, so widening the
extraction later would widen the attack surface silently.

**Harden, cheaply.** `buildGenerationContent` concatenates the user's
instruction and the page's content into one text block with nothing between
them:

```
`${instruction}\n\n${scopeInstruction(...)}\n\n${describeContext(context)}`
```

Delimit the page content and label it as untrusted data in
`GENERATE_SYSTEM_PROMPT` — text from the page describes the page and never
instructs. Cheap, and it is the one structural change available now that
containment is gone.

**Blocked on user.** Whether the model actually takes the bait needs real
calls. Leave the fixture runnable and say so.

### W3 · Re-audit credential exposure (#45)

#45 is a documentation-accuracy issue whose doc fixes already landed. What is
left is the audit it says must be repeated whenever an extension page changes —
and a page has been added since: the editor.

Re-run it: no `{@html}`, no `innerHTML`, across `src/sidebar`, `src/options` and
`src/editor`. The editor renders model-written code, so confirm `CodeArea`
writes text nodes only. Record the result on the issue and close it if clean.

### W11 · Icon specification (#40)

Produce `docs/icons.md` with the table below and the one constraint that
matters: the mark must read at 16px with a badge over its corner, which is what
#29 puts there.

| Asset | Sizes | For |
|---|---|---|
| `icon.svg` | one, legible at 16px | source of truth |
| extension icon | 48, 96 | `manifest.icons` |
| toolbar action | 16, 32, and 2× at 32, 64 | `action.default_icon` |
| sidebar | 16, 32 | `sidebar_action.default_icon` |
| `theme_icons` | 16, 32 in light and dark | readable on either toolbar |
| AMO listing | 128 | store page |

Drawing the assets is not in this batch.

---

## Phase B — independent features

### W4 · Toolbar badge states (#29)

Four states, per tab: idle shows nothing, active shows the count of enabled
transforms, working shows `··`, broken shows `!`.

Nothing calls `action.setBadgeText` today. Drive it from the background, which
already knows every input: `webNavigation.onCommitted` for the count, the
generation port for working, `health-check-result` for broken.

**One honest limitation to write down.** The issue asks for the broken badge to
differ in *shape* so it survives colour blindness and the user's accent choice.
Firefox does not let an extension shape a badge — only its text and background.
The `!` glyph is the shape difference available; say so in the code rather than
implying the design was met.

**Verify** by reading `action.getBadgeText({tabId})` in each state over RDP.
Control: a tab with no matching transforms must show an empty badge, or
"the badge is right" only means "a badge exists".

### W6 · OAuth authorization-code flow (#32)

`browser.identity.launchWebAuthFlow` with PKCE, for OpenAI-compatible providers
that sanction it. **Anthropic is out of scope and must stay out:** they
restricted OAuth to Claude Code and Claude.ai and disabled third-party tokens,
and using Claude Code's client id would violate their terms. The adapter
already refuses anything but an API key.

`Credential` already has the `oauth` shape with `refreshToken`, `expiresAt`,
`tokenEndpoint` and `clientId`, and `CredentialStatus` already carries
`expiresAt` so the UI can warn before a hard expiry. Wire the flow, the refresh
ahead of expiry, and the provider settings fields.

**Verify** the PKCE challenge derivation and the refresh-window arithmetic as
unit tests. The live flow needs a real provider and a real browser prompt —
name it as unexercised.

**Worth a check before building.** No configured provider needs this today. If
the coordinator finds nobody to point it at, report that rather than shipping a
path nothing exercises.

### W7 · Encrypt credentials at rest (#46, second half) — needs W1

Only proceed in the direction W1 supports.

If the non-extractable key holds up: AES-GCM ciphertext in `storage.local`,
key in IndexedDB, migration for existing plaintext, a re-entry path if the key
is lost, and settings copy rewritten to describe what is true afterwards —
neither more nor less. Passphrase mode is explicitly *not* the default.

If W1 shows it buys nothing: do not build it. Write up why, and change the
settings disclosure to be exact about plaintext instead.

**Verify with a canary.** Write a credential containing a unique string, then
search the profile directory for it. Control: run that same search *before* the
change and find it — otherwise "not found" might mean the search is wrong.
Second check: #45's exposure is unchanged by this, since code running in an
extension context can simply ask the key to decrypt. Do not let the copy imply
otherwise.

---

## Phase C — authoring cluster, serialised

These three share `flow.svelte.ts`, `App.svelte` and the editor page. Run them
in order and commit between each.

### W8 · Manual authoring, without the AI (#27)

The baseline capability of the tool this improves on. `TransformOrigin` has a
`manual` value and nothing produces one.

Entry point in the empty state and the list footer: write it myself. Pick an
element the way the AI path does — the anchor is what makes health checks and
repair work later, so it is not optional — then open the editor page in create
mode with an empty body, a kind chooser (CSS or JS), and the match chooser that
already exists there.

Reuse: the editor page, `matchPresetsFor`, the static analysis gate, and the
existing save path. The gate is not optional for hand-written JS.

**Verify** end to end over RDP: create a CSS transform by hand, confirm it
applies to the page. Control: a JS one containing `eval()` is refused and not
stored.

### W9 · Edit the intent, returning to where it was set

The user's words: it should revert back to that position in the conversation.
So this is not a text field — it re-enters the flow at `describing`, the step
where the intent was written, with the element resolved and the current intent
pre-filled. Editing it and generating rebuilds from the new description.

That is deliberately different from Change with AI, which enters at `refining`
with the existing code in hand and asks what should be different. One goes back
to the beginning of the conversation; the other continues it.

Saving updates in place, keeping id, order, creation date and enabled state, as
repair and AI edit already do.

### W5 · Rate-limit retry with countdown (#35)

`FlowError` carries `retryInSeconds` and it is always `0`. Parse `retry-after`
from the provider response — the SDK exposes response headers on `APIError` —
thread it through `toProviderError`, and schedule an actual retry with a
countdown and a cancel, rather than the manual button standing in for it now.

**Verify** the header parsing as a unit test, including the absent and
malformed cases. Control: an error carrying no `retry-after` must produce no
countdown rather than a zero-second one.

---

## Phase D — light theme (#38)

Last, because it touches every component and would conflict with everything
above.

`tokens.css` already uses `light-dark()`, so this is a pass rather than a
build: check every surface in light mode, including the two added this week —
the editor page and the badge colours — and fix contrast.

**Verify measurably rather than by eye.** Render each surface in both schemes
over RDP, read computed foreground and background pairs, and compute contrast
ratios. Control: a pair known to fail must be reported as failing, or the
checker is not checking.

---

## Phase E — sweep

1. `npm run check`, `npm test`, `npm run build`.
2. Re-run the harnesses this batch touched: conflicts, the tree, the editor,
   suspend/resume, and the CSP probe if anything under `registry.ts` moved.
3. Close #27, #29, #32, #35, #38, #45, #46 with what was measured, and comment
   on #44 with the surface list and what remains blocked on a paid run.
4. Report, in one place: what was built, what was measured, what was left
   unexercised and why.

## What needs the user

- **#37** screenshots end to end — their key, their call.
- **W2** the adversarial run against the generator — spends credit.
- **W6** the live OAuth round trip — needs a provider that supports it.
- **W7** nothing, unless W1 says the design is theatre, in which case the
  decision to abandon it is worth confirming.
- Drawing the icons from W11's spec.
