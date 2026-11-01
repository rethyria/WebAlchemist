# WebAlchemist

WebAlchemist is a Firefox extension that changes how a webpage looks or behaves from a description written in plain language. The user points at part of a page and describes the change. A language model that the user chose, with the user's own API key, writes the CSS or JavaScript. The user reads the code and a review of it before anything is saved. A saved change is applied again on every later visit to the matching site. When a site changes so that a saved change no longer applies, the extension reports it and offers to write a replacement from the original description.

As of November 2026 the architecture, the data model, the safety checks and the interface are implemented for desktop Firefox. The extension is not a scaffold, and it is not yet published. The material prepared for a submission to addons.mozilla.org (AMO) is in `docs/amo.md`.

## Requirements

- Firefox 140 or later on desktop. The manifest declares Firefox for Android 142 as the minimum there; see "Platforms".
- Node 22 or later to build. The release package is built with Node 22.23.1 and npm 10.9.8, as `docs/amo.md` states.
- An API key for Anthropic, or for an endpoint that is compatible with the OpenAI chat completions interface. A sign-in through OAuth is available for providers that allow it. Anthropic does not allow third-party OAuth, so Anthropic needs an API key.

## Platforms

The interface is a Firefox sidebar and a settings page, which exist on desktop Firefox. The manifest sets 142 as the minimum for Firefox for Android, and Firefox for Android has no sidebars. A tab-based interface for Android is tracked in issue 128 and is not in this version of the code. No part of the extension has been run on an Android device.

## Development

All commands run from the repository root.

```sh
npm install
npm run build         # release build into dist/
npm run dev           # rebuild on change, with source maps
npm run check         # type check (svelte-check)
npm test              # unit tests
npm run lint:ext      # AMO validator, on dist/
npm run check:icons   # fails when an icon in dist/manifest.json is missing from dist/
npm run package       # unsigned AMO package in web-ext-artifacts/
npm run start:firefox # run in Firefox with a development profile
```

`npm run package` removes `dist/`, builds in release mode with `VITE_CSP_PROBE` and `WA_OUT_DIR` unset, fails if the build contains a source map or any part of the network probe, and writes the zip. The steps for the AMO submission are in `docs/amo.md`.

Two other kinds of test exist. `npm run verify` drives a running Firefox and is described in `test/README.md`. `npm run verify:csp` repeats the measurement of the user script world's content security policy and needs a separate build, as `test/csp/README.md` describes.

As of the last run for this document, `npm run lint:ext` reports no errors and one warning. The warning is `UNSAFE_VAR_ASSIGNMENT`, for an assignment to `innerHTML` in the Svelte runtime that is bundled into `excluded-sites.js`. The application's own code does not assign to `innerHTML`.

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

The extension has three parts.

- The sidebar, the settings page and the editor are extension pages. They show the description, the model's output, the code and the review, and they hold no credentials.
- The background script holds the credentials, calls the provider, owns storage, runs the safety checks and registers scripts with the browser. It accepts privileged messages only from extension pages.
- The content script runs on the page being edited. It draws the highlight and the selection rectangle, and it reads the part of the page that is sent to the provider.

### The record

A saved transform keeps three text fields that are not merged.

| Field | Author | Purpose |
|---|---|---|
| `intent` | user, with a model's proposal | The end state that the user wants. It is the starting point for every regeneration. |
| `rationale` | model | The targets, the approach and the assumptions. It is written again on every repair. |
| `code` | model, or the user in the editor | The implementation. |

`rationale.assumptions` is the readable form of `anchor`. The anchor is what the health check tests, and the assumptions are what the user sees when the check fails. The last five versions of a transform are kept, and the editor can restore one after a confirmation.

## Safety design

Model-written code runs on pages where the user is signed in, so the extension decides whether to save and run code before any of it runs. Four measures apply to JavaScript, and a fifth applies to CSS. None of them is a complete defence, and the design does not claim that one is.

### Static analysis

The static analysis (`src/safety/static-analysis.ts`) parses the code with acorn and accepts it only when everything it uses is on an allowlist of ordinary DOM reading and writing. It refuses code that builds code at run time, reaches the global object by an alias or by a computed name, loads or creates elements that run or load things, sets addresses, and uses the network, cookies or page storage without a declared capability. When a computed name cannot be resolved, the result is a refusal and not a warning. The analysis runs without a model and cannot be influenced by text on a page.

The analysis does not follow data between function calls, so it cannot prove that an element passed in from elsewhere is not a script element. It cannot judge intent: code that reads page text and writes it into a permitted element passes. Code that it accepts runs with the page's cookies and the user's session.

### Model review

A second model call receives the user's own typed instructions, the generating model's summary of the intent, the saved description when there is one, and the code. It does not receive the page. The user's typed instructions are the standard that the code is judged against. The summary and the saved description are labelled as not written by the user, because a page can influence the model that wrote them. When the user typed nothing in the session, the reviewer answers "uncertain" unless the code only changes appearance. The code is placed between markers that carry a different random value on every request.

### Approval

A review returns a one-time approval token. The token is tied to the exact code, its execution world, the transform and the match pattern. Saving requires the token and deletes it, so a token cannot be used twice, for other code, or for another transform or site. Tokens are kept in session storage. The approval panel shows the code, the world, the sites and the full review before the user can approve. When the user removes a declared capability, the existing token still applies, because a smaller set allows less.

### Execution world

JavaScript runs in the isolated user script world by default. The model can ask for the MAIN world, which is the page's own JavaScript context, and must give a reason. The request has no effect until the user approves it. The panel and the editor then show four risks of MAIN: the page can change the code, the code can read what the page keeps in memory, the static analysis cannot see what the page's own functions do, and the restriction on image requests does not apply. Restoring an earlier version that runs in MAIN needs a separate confirmation. A JavaScript transform that runs in MAIN with no record of the user's approval is moved to the isolated world once, when the extension starts.

### Stored code is checked again

The static analysis, and the CSS check for CSS, run when code is saved, before a preview, when a script is registered and when stored CSS is applied. Code that was saved under an earlier version of the checks is therefore checked again by the current version and does not run if it fails. A script that throws when it runs is reported as a broken transform.

### CSS addresses

CSS can make the browser request an address, and the request can carry page data, for example one character of a token at a time through attribute selectors. The CSS check (`src/safety/css-check.ts`) tokenizes the CSS as a browser does and refuses `@import`, `url()`, `src()` and bare strings in `image-set()` or `image()`. The default allows only `data:` addresses. A setting for each site allows addresses on the page's own origin, or addresses that the user approved one at a time for a transform. An `@import` rule is refused in every mode.

### The content security policy of the script world

Each transform runs in its own user script world with a content security policy that is built from its declared capabilities. The policy is set, but it is not a security boundary. A measurement on 2026-08-07 in Firefox 145 showed that Firefox does not apply `connect-src` in a user script world: `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` and `EventSource` all reached a server with `connect-src 'none'` in force. Only image requests were stopped, by `img-src`. The result and the method are in `test/csp/README.md`. The declared capabilities (`network`, `storage` and `cookies`) are therefore disclosures that the user sees at approval, and the control over them is that the static analysis refuses code that uses a capability it did not declare.

### Other protections

- The kill switch, "Stop running all transforms", stops CSS and JavaScript transforms on every site, and each site can also be turned off. CSS is removed from open tabs when the switch is turned on. A tab that already ran JavaScript keeps running it until the tab is reloaded.
- The excluded sites list starts empty. On a listed host and its subdomains the extension does not pick, generate, run saved JavaScript, apply saved CSS, check transforms or load its content script. A warning asks for confirmation before text from a page with password or payment fields is sent.
- Picking, generating, capturing and saving are refused in private windows. Saved transforms still apply there.
- A credential is bound to the provider address it was entered for, and a request to a provider treats a redirect as a failure, so a credential and a prompt are not sent to a second address.

## Storage

Settings, transforms and usage records are in `storage.local`. API keys and sign-in credentials are stored as plain text by default. The user can set a passphrase of at least 12 characters, and the keys are then sealed with a key derived from it (PBKDF2 and AES-GCM). The derived key is kept in session storage while the vault is unlocked, and the vault locks after 30 minutes without use unless the user changes that. Transforms are always stored unencrypted, also when a passphrase is set. Firefox deletes an extension's storage when the extension is removed, but it cannot revoke an API key at the provider, so the user has to delete the key in the provider's console. The extension says so.

## What is sent to the provider

When the user generates, repairs or edits a transform, the background script sends the following to the provider that the user chose:

- the user's description and earlier follow-up requests for the same transform, with the code generated for them;
- for the picked element, its tag, id, class values and role, the picked element's ancestors up to four levels, the elements inside it, and the text of those elements (up to 80 characters for each element without children, including text that is hidden on the page);
- the matching CSS rules, the custom properties in scope and a fixed set of computed style values;
- the same details for each reference element the user adds;
- for a repair, the saved code, its description and rationale, and the reason that the transform stopped working;
- the page address, with the fragment, query values and token-like parts removed;
- a screenshot, only when the user adds one.

The model review sends the code and the user's instructions, not the page. Nothing is sent to the developer, and the extension has no analytics or error reporting. A first-run disclosure with this information is shown before a credential can be entered, and again when its version changes.

## Import, export and versions

The background script can export all transforms as a file with a schema version, and import such a file. Credentials and provider settings are never exported. An imported JavaScript transform arrives without its code and disabled, and is marked for regeneration by the importer's own model under the importer's own checks. An imported CSS transform keeps its code only if it passes the CSS check, and approvals for external addresses in the file are discarded. No screen in the extension sends the export or import messages as of November 2026, so there is no way to use them from the interface. Earlier versions of a transform, the last five, are restored from the editor.

## Durability

CSS is inserted at the user cascade origin, where `!important` in the extension's CSS outranks the site's own `!important`. JavaScript is wrapped in a scoped `MutationObserver` that is debounced to one run for each animation frame, and it must be idempotent, which the generation prompt requires. Single-page navigation is detected with `webNavigation.onHistoryStateUpdated`, so the extension does not need to patch `History` in the page.

## Known caveats

- `@types/firefox-webext-browser` describes the Manifest V2 `userScripts` API. The Manifest V3 API is typed in `src/background/userscripts-api.ts` with one cast. The cast can be removed when the package covers the new API.
- Anthropic has no third-party OAuth, so Anthropic needs an API key. OAuth is implemented for providers that allow it.
- Screenshots show only the visible part of the tab. A taller target is captured partly and reported as clipped. Capturing needs either the toolbar button click or the all-sites access grant.
- The static analysis and the model review are not complete, and the CSP of the script world does not limit network access. Approving code is the control that the user holds.
- A tab that already ran JavaScript keeps running it after the kill switch or a site's off switch is used, until the tab is reloaded.
- The extension has not been run on an Android device, and the Android tab interface is not in this version of the code.

## Design

`docs/ui-design-prompt.md` is the brief for the interface and states the constraints that any implementation has to respect. `docs/batch-plan.md` records the batch of August 2026 and is superseded where later issues changed the design.

## Licence

GPL-3.0-or-later.
