# WebAlchemist

A Firefox extension. Point at part of any webpage, describe the change you want in plain language, and an AI writes the CSS or JavaScript that makes it. The change persists on every future visit, and when the site ships a redesign that breaks it, the extension detects the breakage and offers to regenerate it from what you originally asked for.

Status: **scaffold**. The architecture, data model, safety pipeline, and platform integration are implemented. The interface is a placeholder — see `docs/ui-design-prompt.md`.

## Requirements

- Firefox 140+ (Android 142+)
- Node 22+
- An API key for Anthropic or any OpenAI-compatible endpoint

## Development

```sh
npm install
npm run build       # build to dist/
npm run dev         # rebuild on change
npm run test        # unit tests
npm run lint:ext    # AMO validator
npm run start:firefox
```

`npx tsc --noEmit` type-checks.

### SteamOS / flatpak Firefox

`npm run start:firefox` goes through `scripts/firefox-flatpak`, which wraps
`flatpak run org.mozilla.firefox`. Two things it exists to handle, both
documented in the script itself:

- The flatpak sandbox has no access to this project by default. Grant it once:

  ```sh
  flatpak override --user org.mozilla.firefox \
    --filesystem=/home/deck/Development/web-alchemist
  ```

  Revoke with `--nofilesystem=` and the same path. Nothing outside this
  directory is exposed, and the dev profile lives in `.web-ext-profile/` inside
  the project so it stays within the grant.

- If you launch from a terminal spawned by Zed (also a flatpak), `LD_LIBRARY_PATH`
  points at Zed's runtime libs, and the host `flatpak` binary then loads Zed's
  bundled GLib and dies with `undefined symbol: g_task_set_static_name`. The
  wrapper unsets it for that one call. Running `flatpak` directly from such a
  shell needs `env -u LD_LIBRARY_PATH` in front of it.

## How it fits together

```
sidebar (browser chrome)          background script                 page
─────────────────────────         ─────────────────────────         ──────────────
intent, model output,      ←──→   credentials, provider calls,      picker highlight
code, review verdicts             storage, safety pipeline,         and drag rect
                                  script registration                (nothing else)
```

The split is deliberate. The sidebar holds everything sensitive and is browser chrome the page cannot read. The content script only ever renders a highlight. Credentials never leave the background script.

### The record

A transform carries three distinct text fields that must not be collapsed together:

| Field | Author | Purpose |
|---|---|---|
| `intent` | user (model proposes) | end-state description; the seed for every regeneration |
| `rationale` | model | targets / approach / assumptions; regenerated on every repair |
| `code` | model | the implementation |

`rationale.assumptions` is the human-readable twin of `anchor` — the anchor is what the health check tests, the assumptions are what the user is shown when it fails.

### Safety

AI-authored JavaScript passes four layers, in cost order:

1. **World CSP** (`registry.ts`) — enforcement, not detection. Each transform runs in its own `USER_SCRIPT` world whose Content Security Policy is *derived from its declared capabilities*. A transform declaring nothing runs where `connect-src` is `'none'`, so an undeclared network call fails at runtime regardless of what any analysis concluded.
2. **Declared capabilities** — default empty. Undeclared use is a rejection, not a judgement call.
3. **Static analysis** (`safety/static-analysis.ts`) — real AST parse via acorn, not regex. Always runs, costs nothing, and cannot be influenced by anything written on the page.
4. **Model review** (`prompts.ts`) — receives only the code and the stated intent, **never page content**. This is the whole point: a page that can inject text into the generator's context could inject the same text into a reviewer sharing it. Withholding the page is what makes the second opinion independent.

World isolation protects *from* hostile pages and from transforms colliding with each other. It is **not** a sandbox around AI-written code — `USER_SCRIPT` still has DOM access and credentialed same-origin fetch. Layers 1–4 are what address that.

### Durability

CSS is injected at the USER cascade origin, where `!important` outranks the site's own `!important` — so generated CSS wins without brittle specificity chains, and survives framework re-renders with no observer.

JavaScript is wrapped (`harness.ts`) in a scoped, frame-debounced `MutationObserver` and must be idempotent, which is a system-prompt rule and a static check. SPA navigation is detected via `webNavigation.onHistoryStateUpdated` rather than patching `History`, which would require the MAIN world.

## Known caveats

- **`web-ext lint` reports one warning**: `UNSAFE_VAR_ASSIGNMENT` in `disclose-version.js`. That is Svelte's runtime using `innerHTML` for template instantiation, not application code. It appears in essentially every Svelte-based extension.
- **`@types/firefox-webext-browser` still describes the MV2 legacy `userScripts` API.** The real MV3 surface is typed in `background/userscripts-api.ts` with a single cast at that boundary. Delete it when upstream catches up.
- **The world CSP needs empirical confirmation.** The API documents per-world CSP; that `connect-src` actually blocks fetch/XHR/WebSocket/sendBeacon in a user script world should be pinned down with a test page before release. See the TODO in `registry.ts`.
- **Anthropic has no third-party OAuth.** OAuth was restricted to Claude Code and Claude.ai in February 2026. Anthropic is API-key only here; OAuth is implemented only for providers that sanction it.
- **Credentials are not encrypted at rest.** Browsers give extensions no keychain equivalent — `storage.local` is plaintext in the profile directory. The settings page says so rather than implying otherwise.
- **Screenshots clip at the viewport.** `captureVisibleTab` only sees what is visible; a taller target is captured partially and reported as clipped. Scroll-and-stitch is deferred.

## Design

`docs/ui-design-prompt.md` is the brief for the interface and states the constraints any implementation must respect.

## Licence

GPL-3.0-or-later.
