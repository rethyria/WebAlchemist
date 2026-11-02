# Web Alchemist

Web Alchemist is a Firefox extension that changes how a webpage looks or behaves, based on a description written in plain language. The user points at part of a page and describes the change. A language model from an AI provider that the user chooses, called with the user's own API key, writes the CSS or JavaScript. Before anything is saved, the user sees the code and an explanation of it, and JavaScript is also checked by a second model call. A saved change, called an elixir, is applied again on every later visit to the matching site. When a site changes so that an elixir no longer applies, the extension reports it and offers to write a replacement from the original description.

As of November 2026 the extension works on desktop Firefox and has not been published. The interface for Firefox for Android is built but has not been tested. The material for a submission to addons.mozilla.org (AMO) is in `docs/amo.md`.

## Requirements

- Firefox 140 or later on desktop, or Firefox for Android 142 or later. The Android interface has not been tested; see "Platforms".
- An API key for Anthropic, or for an AI provider that is compatible with the OpenAI chat completions interface. A provider that allows OAuth sign-in can be used with a sign-in instead of a key. Anthropic does not allow third-party OAuth, so Anthropic needs an API key.
- An account with that AI provider, which bills the user for each model call. With Anthropic, the default model for both writing and checking code is Opus 5.5, and both can be changed in the settings. Each generation, each code check and each question about a draft is one call. Writing or repairing JavaScript therefore takes two calls, one to write the code and one to check it, and CSS takes one call. The settings page shows the recorded token use and cost for each provider and month.
- Node 22 or later, only to build from source. The release package is built with Node 22.23.1 and npm 10.9.8.

## Platforms

On desktop Firefox the interface is a sidebar, a settings page and an editor page. Firefox for Android has no sidebars, so there the extension's toolbar action, which is in the Firefox menu, opens the same panel in a browser tab. The panel works on the tab that was open when the action was used.

Picking on Android works by touch. A tap selects the element under the finger, and a finger movement before half a second has passed scrolls the page as usual. Touching and holding still for half a second, then dragging, draws a selection rectangle. After a pick, the panel lists the elements around the picked one, so that the selection can be moved to the element around it, an element inside it or a neighbouring element.

On Firefox for Android, screenshots are not offered. Signing in with a provider account is not offered where Firefox does not provide the identity API, and an API key still works there. Both limits come from what is known about the Firefox for Android APIs. None of the Android behaviour has been run on a device or an emulator.

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
npm run start:firefox # run in a flatpak Firefox with a development profile
```

`npm run package` removes `dist/`, builds in release mode with `VITE_CSP_PROBE` and `WA_OUT_DIR` unset, fails if the build contains a source map or any part of the network probe, and writes the zip. The steps for the AMO submission are in `docs/amo.md`.

`npm run start:firefox` starts Firefox through a script for a flatpak installation; see the next section. With Firefox installed in another way, the extension can be run with `npx web-ext run --source-dir ./dist`.

Two other kinds of test exist. `npm run verify` drives a running Firefox and is described in `test/README.md`. `npm run verify:csp` repeats the measurement of the content security policy of the user script world and needs a separate build, as `test/csp/README.md` describes.

On 2 November 2026, `npm run lint:ext` reported no errors and one warning. The warning is `UNSAFE_VAR_ASSIGNMENT`, for an assignment to `innerHTML` in the Svelte runtime, which the build bundles into a shared file. The extension's own code does not assign to `innerHTML`.

### Firefox installed as a flatpak

`npm run start:firefox` starts Firefox through `scripts/firefox-flatpak`, which runs `flatpak run org.mozilla.firefox`. The script was written for SteamOS, where Firefox is a flatpak, and its comments describe the two problems it handles.

The flatpak sandbox cannot read the project directory by default. Access is granted once with this command, where the path is the location of the repository:

```sh
flatpak override --user org.mozilla.firefox --filesystem=~/path/to/web-alchemist
```

The same command with `--nofilesystem=` in place of `--filesystem=` removes the access. The grant covers only the project directory, and the development profile is kept in `.web-ext-profile/` inside the project so that the grant covers it too.

In a terminal that another flatpak application started, such as the Zed editor, `LD_LIBRARY_PATH` points at that application's libraries. The host `flatpak` command then loads the wrong GLib library and exits with `undefined symbol: g_task_set_static_name`. The script removes the variable for its own call. To run `flatpak` directly from such a terminal, put `env -u LD_LIBRARY_PATH` in front of it.

## How it fits together

The extension has three parts.

- The sidebar, the settings page and the editor are extension pages. They show the description, the model's output, the code and the checks, and they hold no credentials.
- The background script holds the credentials, calls the AI provider, reads and writes storage, runs the safety checks and registers scripts with the browser. It accepts privileged messages only from extension pages.
- The content script runs on the page being edited. It draws the highlight and the selection rectangle, and it reads the part of the page that is sent to the AI provider.

### The record

A saved elixir keeps three text fields that are not merged.

| Field | Author | Purpose |
|---|---|---|
| `intent` | user, with a model's proposal | The end state that the user wants. It is the starting point for every regeneration. |
| `rationale` | model | The targets, the approach and the assumptions. It is written again on every repair. |
| `code` | model, or the user in the editor | The implementation. |

An elixir can also offer settings. The model proposes a short list of fields (a key, a label, a type and a default) together with the code, and the code reads their values. The types are text, number, yes or no, choice, colour, list and table. An elixir has at most 20 fields, and the stored values take at most 64 KB. The fields are stored in `configFields` and are part of what the approval covers. The values that the user sets are stored apart from them, in `configValues`, as overrides: a field without a value uses its default. When a Refine or a repair changes the fields, a value is kept only if its field has the same key and type and the value is still valid, and the approval panel names each value that is not kept. The user changes values in a "Settings" section that is closed by default on the elixir's row in the sidebar and on the editor page. JavaScript reads them through a frozen object named `CONFIG`, and CSS reads text, number, choice and colour settings through `var(--setting-<key>)` with no fallback, which the extension replaces with the value before the CSS is checked. A change to the values of a CSS elixir shows on the open pages at once. A script cannot change a page that is already open, so after the values of a JavaScript elixir change, the row offers a "Reload page" button.

An elixir also stores an `anchor`, a set of signals that identify the elements the code targets. The health check tests the anchor on each visit. `rationale.assumptions` states the same conditions in words, and the user sees them when the check fails. The last five versions of an elixir are kept, and the editor can restore one after a confirmation.

## Safety design

Model-written code runs on pages where the user is signed in, so the extension checks code before it saves or runs it. The CSS check applies to CSS. The other measures below apply to JavaScript. None of them is a complete defence, and the design does not claim that one is.

### Safety check

The safety check (`src/safety/static-analysis.ts`) is a static analysis of the code. It parses the code with acorn and accepts it only when everything it uses is on an allowlist of ordinary DOM reading and writing. It refuses code that builds code at run time, reaches the global object by an alias or by a computed name, loads or creates elements that run or load things, sets addresses, and uses the network, cookies or page storage without having asked for that access. When a computed name cannot be resolved, the result is a refusal and not a warning. The check runs without a model and cannot be influenced by text on a page.

The check does not follow data between function calls, so it cannot prove that an element passed in from elsewhere is not a script element. It cannot judge intent: code that reads page text and writes it into a permitted element passes. Code that it accepts runs with the page's cookies and the user's session.

### Code check

Every JavaScript result is checked by a second model call, called the code check, before it can be previewed or saved. The code check starts by itself when a new JavaScript result arrives and the safety check has passed, after a first generation, a refinement, an import or a repair. It runs once for each combination of code and description. Where it does not start by itself, for example after the user edits the description, the "Check the code" button starts it. CSS is not sent for the code check.

The code check receives the user's own typed instructions, the generating model's summary of the intent, the saved description when there is one, and the code. It does not receive the page, and it does not receive the questions that the user asked about the draft or their answers. The user's typed instructions are the standard that the code is judged against. The summary and the saved description are labelled as not written by the user, because a page can influence the model that wrote them. When the user typed nothing in the session, the code check answers "uncertain" unless the code only changes appearance. The code is placed between markers that carry a different random value on every request.

### Approval

A code check returns a one-time approval token. The token is tied to the exact code, its execution world, the access it asks for (network, storage or cookies), the elixir and the match pattern, which is the pattern of addresses the elixir runs on. A JavaScript preview needs a token from a code check with the verdict "match", and it runs the script only on the exact address of the page being edited. Saving also needs the token and deletes it, so a token cannot be used twice, for other code, or for another elixir or site. Tokens are kept in session storage. The approval panel shows the code, the world, the sites and the full code check before the user can approve. When the user removes some of the access that the code asks for, the existing token still applies, because a smaller set allows less.

### Settings

A user can change the values of an elixir's settings later without a new code check. The reason is that the safety check already treats every member of `CONFIG` as arbitrary text at every place where text matters, in the same way as text read from the page. A value therefore cannot become a selector, an address, a tag name, an attribute name, a property name, HTML or code, and it cannot add a style value that can load an address. A value that is used where the check refuses text from the page is refused for `CONFIG` as well. Writing to `CONFIG`, and declaring a name `CONFIG` in the code, are refused. The `CONFIG` object is frozen, so a write that the check does not see throws an error at run time.

The approval token covers the fields, with their keys, types, options and defaults, and does not cover the values. A change of fields needs a new code check and a new token, and a change of values needs neither. A value edit changes only `configValues`: it cannot change the code, the world, the access, the match pattern or the fields. The background validates every value against the stored fields on every write, and again when a script is registered, and a stored value that is not valid is replaced by the default. A value is a single line of at most 2,000 characters for text, and a list or table has at most 1,000 entries of at most 500 characters.

The code check is told that values can change after the review and is asked to judge the code for every value that a field can hold. The fields, including the labels and help texts, were written by the generating model, and the code check receives them in a block that is marked as data. The values that the user sets are never sent to any model: not to the model that writes code, not to the code check, and not to the model that answers questions. The page context that is sent with a Refine or a Repair (computed styles, element text and an optional screenshot) can show the effect of applied values, and the reason sent with a Repair is worked out from the stored record without its values.

For CSS, the settings are put into the CSS first, and everything that checks CSS or inserts it uses that one text: saving, previewing, applying, the check in the approval panel, import and the overlap finder. A text value is written as a closed double-quoted CSS string in which the quote, the backslash and line breaks are escaped, a number as the number with its unit, a choice as a plain word, and a colour as a `#rrggbb` value. A value therefore cannot start a `url()`, an `@import` or a new rule, and the CSS check covers the text that the page receives. A text setting is refused inside a custom property declaration (`--x: var(--setting-key)`), because the page's own CSS could read the property in a function that loads an address, and JavaScript needs the network capability to do the same. A change of values is refused when the CSS with the new values would not pass the check.

One risk remains in the MAIN world: the page can replace the functions that the code calls and so read the values that the code passes to them. The approval panel lists this with the other MAIN risks. A value used to build a regular expression can make a page slow, and the generation prompt asks the model to escape such values. A value that the code writes into the page is visible to the page.

### Execution world

JavaScript runs in the isolated user script world by default. The model can ask for the MAIN world, which is the page's own world, where the code can use everything the page's scripts can, and must give a reason. The request has no effect until the user approves it. The panel and the editor then show five risks of MAIN: the page can change the code, the code can read what the page keeps in memory, the safety check cannot see what the page's own functions do, the restriction on image requests does not apply, and the page can read the values of the elixir's settings. Restoring an earlier version or a backup that runs in MAIN needs a separate confirmation. A JavaScript elixir that runs in MAIN with no record of the user's approval is moved to the isolated world once, when the extension starts.

### Stored code is checked again

The safety check, and the CSS check for CSS, run when code is saved, before a preview, when a script is registered and when stored CSS is applied. Code that was saved under an earlier version of the checks is therefore checked again by the current version and does not run if it fails. A script that stops with an error when it runs is reported as a broken elixir.

### CSS addresses

CSS can make the browser request an address, and the request can carry page data, for example one character of a token at a time through attribute selectors. The CSS check (`src/safety/css-check.ts`) tokenizes the CSS as a browser does and refuses `@import`, `url()`, `src()` and bare strings in `image-set()` or `image()`. The default allows only `data:` addresses. A setting for each site allows addresses on the page's own origin (the same domain, protocol and port), or addresses that the user approved one at a time for an elixir. An `@import` rule is refused in every mode.

### The content security policy of the script world

Each elixir runs in its own user script world with a content security policy that is built from the access it asks for. The policy is set, but it is not a security boundary. A measurement on 2026-08-07 in Firefox 145 showed that Firefox does not apply `connect-src` in a user script world: `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` and `EventSource` all reached a server with `connect-src 'none'` in force. Only image requests were stopped, by `img-src`. The result and the method are in `test/csp/README.md`. The access that an elixir asks for (`network`, `storage` and `cookies`) is shown to the user at approval. It is enforced by the safety check, which refuses code that uses access it did not ask for, and by the runtime guard described in the next section.

### The runtime guard

Before an elixir runs in its user script world, a guard (`src/background/runtime-guard.ts`) replaces, with properties that throw an error, every feature that the elixir did not ask for access to. These are the network features, storage, cookies, workers, `open`, `eval`, `Function`, strings given to timers, `FontFace`, the audio worklet, `navigator.storage` (the origin private file system), the form submit methods, the page's real window and the windows of frames. The guard works independently of the safety check. Measurements in Firefox 159 on 2026-11-01 showed that it hides these features from every route to the window that was tried, and that the page's own use of them is unaffected.

The measurements also showed what the guard does not close. Firefox's Xray waiver (`wrappedJSObject` and `XPCNativeWrapper.unwrap`) works on every page object. Only the window, `document`, `navigator`, `location`, `history` and the prototype objects could be hidden, so the waiver on any element, event or collection still reaches the page's window and `Function`. Other open routes are windows reached by index (`window[0]`), requests made by inserted `style` and `iframe` elements, a `video` poster, `link rel="modulepreload"`, and a click on a submit button. Resource-loading APIs that were not measured are not covered. For these routes the protection is the safety check, which refuses the waiver names. The method, the controls and the full list are in `test/runtime-guard/README.md`.

The guard cannot be applied to the MAIN world, so an elixir that runs there is protected only by the safety check and by the user's approval.

### Other protections

- The kill switch, "Stop running all elixirs", stops CSS and JavaScript elixirs on every site. CSS is removed from open tabs when the switch is turned on. A tab that already ran JavaScript keeps running it until the tab is reloaded.
- Each site can also be turned off on its own. Turning a site off removes its CSS and reloads every open tab of that site that ran JavaScript.
- The excluded sites list starts empty. On a listed host and its subdomains the extension does not pick, generate, run saved JavaScript, apply saved CSS, check elixirs or load its content script. A warning asks for confirmation before text from a page with password or payment fields is sent.
- Picking, generating, capturing and saving are refused in private windows. Saved elixirs still apply there.
- A credential is bound to the provider address it was entered for, and a request to an AI provider treats a redirect as a failure, so a credential and a prompt are not sent to a second address.

## Storage

Settings, elixirs and usage records are in `storage.local`. API keys and sign-in credentials are stored as plain text by default. The user can set a passphrase of at least 12 characters, and the credentials are then sealed with a key derived from it (PBKDF2 and AES-GCM). While the sealed credentials are unlocked, the derived key is kept in session storage, and they lock again after 30 minutes without use unless the user changes that time. Elixirs are always stored unencrypted, even when a passphrase is set. Firefox deletes an extension's storage when the extension is removed, but it cannot revoke an API key at the AI provider, so the user has to delete the key in the provider's console. The extension tells the user this.

## What is sent to the AI provider

When the user generates, refines or repairs an elixir, or asks a question about a draft, the background script sends the following to the AI provider that the user chose:

- the user's description and earlier follow-up requests for the same elixir, with the code generated for them;
- for the picked element, its tag, id, class values and role, its ancestors up to four levels, the elements inside it, and the text of those elements, up to 80 characters for each element without children, including text that is hidden on the page;
- the matching CSS rules, the custom properties in scope and a fixed set of computed style values;
- the same details for each reference element the user adds;
- for a repair, the saved code, its description and rationale, and the reason that the elixir stopped working;
- for a refinement, a repair or a question, the settings of the elixir (their keys, labels, types, options and defaults), and never the values that the user set;
- for a question, the question, the earlier questions and answers of the same session, and the current draft's code and explanation;
- the page address, with the part after # and the query values removed, and parts that look like tokens removed;
- a screenshot, only when the user adds one.

Questions go to the model that writes the code. Their answers are shown to the user and are not added to the requests that write or check code. The code check of JavaScript sends the code, the user's typed instructions, the generating model's summary, the saved description and the settings (without values), and never the page. Each of these calls is billed by the AI provider. Nothing is sent to the developer, and the extension has no analytics or error reporting. A first-run disclosure with this information is shown before a credential can be entered, and again when its version changes.

## Import, export and backup

The settings page has an "Export and import" section with three actions: "Export to share", "Back up" and "Import from file". Both kinds of export are JSON files, and either can be encrypted with a passphrase of at least 12 characters (PBKDF2 and AES-GCM). Neither file contains credentials or provider settings, and a backup does not contain provider addresses. Both hold text and addresses taken from the pages the elixirs were written for.

- A shared export carries CSS code with its settings fields and their defaults, and for JavaScript only the description (the intent), without code or settings. It never carries the values that the user set, because they can hold personal words, and it does not carry the approved CSS addresses, which can be built from a value.
- A backup also carries JavaScript code, the access it asks for, the world it runs in, the settings fields and the values that the user set, and two settings, the accent colour and the health check mode. On a restore, each value is checked against its field and a value that is not valid is dropped, so that the default applies. The approval panel for restored code lists the fields and the values from the file.

An import shows what it would add before anything is saved, and the elixirs that it adds are always turned off. The importing extension rebuilds each record from the fields that an import may take, so a file cannot set an approval or an elixir's enabled state. A shared file cannot set the world either: its JavaScript always runs in the isolated world.

What happens to imported code depends on its kind:

- JavaScript from a shared file has no code until the importer's own model has written code that passes the importer's safety check and code check.
- JavaScript code from a backup must pass the safety check, and it stays off until the user has read and approved it. Code that the backup marks for the MAIN world keeps that world, and the approval panel shows the MAIN risks and asks for their confirmation.
- CSS from either file is kept only if it passes the CSS check under the importer's settings.

The values of one elixir's settings can also be shared apart from the elixir. "Export settings" in the Settings section writes a small file that holds only that elixir's values, with the elixir's name and the key and type of each setting. "Import settings" applies such a file to an elixir. Each value is checked against the target elixir's own fields with the rules that a normal change of values uses. A key that the elixir does not have is ignored, a value whose type differs or that is not valid is skipped, and the panel lists what was applied and what was skipped. The file cannot change the code, the fields, the world, the access or the match pattern.

A pattern in a file is refused when it covers every site, when it starts with a wildcard host, when it names a local or private address, or when it reaches a site on the importer's excluded list. An import is limited to 20 sites, 1000 records and 5 MB. A restore applies only the accent colour and the health check mode from a backup's settings.

## Durability

CSS is inserted at the user cascade origin, where `!important` in the extension's CSS outranks the site's own `!important`. JavaScript is wrapped in a scoped `MutationObserver` that runs it at most once for each animation frame. The code must therefore be idempotent, which means that running it again on a page it already changed has no further effect, and the generation prompt requires this. Single-page navigation is detected with `webNavigation.onHistoryStateUpdated`, so the extension does not need to patch `History` in the page.

## Known caveats

- The safety check and the code check are not complete, and the content security policy of the script world does not limit network access. Approving code is the control that the user holds.
- A tab that already ran JavaScript keeps running it after the kill switch is turned on, until the tab is reloaded.
- Every JavaScript result costs a second model call for the code check, and with the defaults both calls use Opus 5.5.
- Screenshots show only the visible part of the tab. A taller target is captured partly and reported as clipped, and a screenshot whose longer side is over 1568 pixels is reduced before it is sent. Capturing needs either a click on the toolbar button or access to all sites.
- The Android tab interface has not been run on a device or an emulator.
- `@types/firefox-webext-browser` describes the Manifest V2 `userScripts` API. The Manifest V3 API is typed in `src/background/userscripts-api.ts` with one cast, which can be removed when the package covers the new API.

## Design

`docs/ui-design-prompt.md` is the brief for the interface and states the constraints that any implementation has to respect. `docs/batch-plan.md` records the batch of August 2026 and is superseded where later issues changed the design.

## Licence

GPL-3.0-or-later.
