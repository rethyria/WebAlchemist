# Submitting Web Alchemist to addons.mozilla.org

Web Alchemist is a Firefox extension that writes a change to a webpage from a plain-language description. This document holds everything needed to submit it to addons.mozilla.org (AMO) under issue 41: the notes for the AMO reviewer, the reason for each permission, the data collection declaration, the instructions for the source-code submission, a draft listing, a draft privacy policy, and the steps that only the account owner can do. Nothing in this repository submits or signs the extension.

The facts below were checked against the repository at the time of writing. Wherever a statement is a judgement about Mozilla's rules and not a fact about the code, it says so.

## Reviewer notes

These notes go in the "Notes for Reviewers" field of the submission.

### What the extension does

The user selects part of a page, or describes a change in words, and a language model writes CSS or JavaScript that makes the change. The user can read the code and the model's explanation before anything is saved. A saved change is applied again on every later visit to the matching site. When a site changes so that a saved change no longer applies, the extension reports it and offers to write a replacement from the original description.

The user chooses the model provider (Anthropic, or any endpoint compatible with the OpenAI chat completions interface) and enters their own API key. The extension has no server of its own and the developer receives no data.

### Why generated JavaScript is user-script code and not remote code

The JavaScript is not part of the extension package and is not fetched from a location that the developer controls. It is written on request by a model that the user configured with the user's own key, shown to the user in the approval panel together with an automatic review result, and saved only after the user approves it. The extension then registers it with the `userScripts` API, which Firefox provides for running code that the user has chosen to run. This is the same arrangement as a user-script manager, except that the code is written by a model from the user's description and not copied from a repository.

The extension enforces the following before any generated script runs:

- A saved approval record ties the exact code, its world, the transform and the site pattern to one approval token. Code that differs from what the user was shown is refused at save time, and a token works once.
- A static analysis step parses the code and refuses constructs that load or build code at run time. These include `eval`, `new Function`, string arguments to timer functions, `import()`, script element creation and similar. It also refuses use of the network, cookies and page storage unless the transform declares that capability, and it shows the user each declared capability.
- The code is checked again from storage before it is registered, so a script that did not pass is not run after a browser restart or an update.
- A separate model review receives only the code and the user's description, never the page content.

The extension itself contains no remote code. Every script in the package is bundled, and the content security policy is Firefox's default for Manifest V3 extensions.

### Remote loading is refused

The static analysis refuses dynamic `import()` with or without the network capability, and refuses the other ways of loading code from an address. This is the subject of issue 137; the reviewer should be told only what the shipped build does. Confirm the state of issue 137 and its unit test before submitting, and remove this paragraph if the behaviour is not in the submitted build.

### Network access of generated scripts

An earlier version of the design relied on a content security policy set per user script world (`connect-src 'none'`) to stop an undeclared network request. A measurement in Firefox showed that this does not work. With `connect-src 'none'` in force, `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` and `EventSource` all reached a listening server from a user script world. Only an image request was stopped, by `img-src`. The test page and results are in `test/csp/`.

The extension therefore does not treat the world's content security policy as a security boundary. The policy is still set, because it closes the image channel and costs nothing. The control that the extension relies on is the refusal to save code: the static analysis blocks every use of the network that the transform did not declare, and the user sees each declared capability before approving. The README and the comments in `src/background/registry.ts` describe this. Before submission, confirm that no remaining text calls the world policy a boundary (issue 61).

### Execution worlds

By default a script runs in the isolated user script world. The model may ask for the MAIN world when a change needs the page's own JavaScript objects, and it must state the reason. The user sees the world in the approval panel. The reason the model is allowed to choose this is tracked in issue 53. Replace this paragraph with that issue's decision before submission.

### Build probes

A build made with the environment variable `VITE_CSP_PROBE=1` adds a test handler and a sidebar button that send requests to `localhost:8787`. The release package is built without it. As of this writing, the names of the two probe message types still appear in the release build behind a check that rejects them; issue 60 tracks their removal. The packaging script reports them and fails on any mention of `localhost:8787`.

## Permissions

The manifest declares seven required permissions, two optional permissions and two optional host permission patterns. Each one is explained below, in the form to paste into the reviewer notes.

### Required permissions

Each of these appears in the install prompt, so each needs a reason a user can accept. Issue 41 asks that any permission without a good reason be removed. The owner should decide on `identity` and `tabs` in particular.

| Permission | Use in the code | Justification |
|---|---|---|
| `storage` | Settings, saved transforms, usage records and credentials in `storage.local`; short-lived approvals and drafts in `storage.session` | Saved changes and the user's settings must persist between sessions. |
| `scripting` | Injects the page picker, which highlights the element the user selects, and applies CSS changes | The picker and CSS injection run in the page and cannot be done from the background script. |
| `activeTab` | Lets the extension act on the current tab after the user clicks the toolbar button or opens the sidebar, without access to every site; also allows a screenshot of the visible tab | The extension asks for access to a site only when the user works on it. |
| `tabs` | Reads the address and window of tabs to decide which saved changes apply, to re-evaluate open tabs when a change is saved or access is granted, and to read a tab's address for the editor | Without it the address of a tab that the user has not just activated is not available. |
| `webNavigation` | Detects page loads and single-page-app address changes (`onCommitted`, `onHistoryStateUpdated`) so saved changes are checked after a site updates its page | Single-page sites change the address without a page load, and saved changes must be checked then. |
| `identity` | `identity.launchWebAuthFlow` and `identity.getRedirectURL` for signing in to an OpenAI-compatible provider that supports OAuth | Only the OAuth sign-in uses it. No default provider uses OAuth, and Firefox does not allow `identity` as an optional permission (see `docs/batch-plan.md`). If the OAuth sign-in is not part of the first release, remove the permission and the sign-in code instead of justifying it. |
| `alarms` | Locks the credential vault after the idle time the user chose | A timer is needed in a background script that Firefox can suspend. |

### Optional permissions

These are requested at the moment the user needs them, from a click, and the user can refuse.

| Permission | Use in the code | Justification |
|---|---|---|
| `userScripts` | Registers approved JavaScript transforms | Requested when the user first saves a JavaScript transform. CSS-only use does not need it. |
| `cookies` | Reads the container (cookie store) of the tab the editor was opened from | Requested only when the user restricts a CSS transform to one Firefox container. |

### Optional host permissions

The manifest lists `*://*/*` and `<all_urls>`. They are requested one site at a time when the user turns a saved change on for that site, or once for all sites when the user asks for screenshots, because `captureVisibleTab` accepts only the all-sites grant or `activeTab`. A saved change cannot run on a site the user did not grant.

## Data collection declaration

The manifest declares two required categories under `data_collection_permissions`: `websiteContent` and `browsingActivity`. It does not declare `none`, because the extension sends page data to a third party when the user asks for a change.

When the user asks for a change, the background script sends the following to the provider that the user configured:

- the user's description of the change;
- the text and markup of the relevant part of the page, which is `websiteContent`;
- the address of the page, which is `browsingActivity`;
- the user's API key, as the authorization header for that provider;
- a screenshot of the visible tab, only when the user asks for one, which is `websiteContent`.

Nothing is sent to the developer, and the extension has no analytics or error reporting.

The categories were chosen under these uncertainties, which the owner should confirm against Mozilla's current list of categories before submitting:

- `personalCommunications` and `financialAndPaymentInfo` are not declared. The extension does not look for such data, but a user can point it at a webmail or banking page and the page text then reaches the provider. The review in issue 41 suggests these categories may apply. If Mozilla's reviewers or guidance say they do, add them; the cost is a more alarming install prompt.
- `authenticationInfo` is not declared. The user's own key is sent only to the provider it belongs to. Whether Mozilla counts that as collection is uncertain.
- The privacy policy below is probably required for a listed add-on that sends data. This is inferred from Mozilla's policy text and has not been confirmed.

The reasoning is also recorded in `src/manifest-data-collection.test.ts`, because `manifest.json` cannot hold comments.

## Source-code submission

AMO requires the source when the submitted code is generated or minified. The package is not minified, but it is bundled, so the source is submitted. The source is a zip of the repository at the release commit, without `node_modules`, `dist`, and `web-ext-artifacts`. `git archive --format=zip HEAD` produces it.

### Build environment

The submitted package was built with these tools. Use the same versions.

- Operating system: Linux (any current distribution)
- Node 22.23.1
- npm 10.9.8

The version pins that apply are those in `package-lock.json`. CI builds with the newest Node 22 release and checks that two builds are identical.

### Build steps

Run these in the unpacked source directory.

```sh
unset VITE_CSP_PROBE WA_OUT_DIR
npm ci
npm run build
```

`VITE_CSP_PROBE` adds a test handler and a sidebar button to the build, and `WA_OUT_DIR` moves the output away from `dist/`. Both must be unset. `npm ci` installs exactly the versions in `package-lock.json`; `npm install` must not be used.

The output is in `dist/`. A release build writes no source maps, and `npm run build` is a release build. The development command `npm run dev` is the only one that writes maps.

### Comparing the output

The submitted package is a zip of `dist/`. To compare, unzip it into a separate directory and run this from the source directory:

```sh
diff -r dist /path/to/unzipped-package
```

The command prints nothing when the two are identical. The `npm run package` command removes `dist/` and builds again before it zips, so a package made that way matches a fresh build. The CI job "Check that the build is reproducible" builds twice and compares the two outputs.

## Listing draft

### Summary

Describe a change to any webpage in plain words. A model you choose writes it, you review it, and it is applied again on every visit.

### Description

Web Alchemist changes how websites look and behave, using a description that you write in plain language. Select part of a page or type what you want, for example "hide the sidebar" or "make the text larger and the background dark". A language model writes the CSS or JavaScript, and Web Alchemist shows you the code, an explanation, and the result of an automatic review before anything is saved.

Saved changes apply again each time you visit the site. When a site updates its design and a change stops working, Web Alchemist tells you and offers to write a new version from your original description.

You provide the model. Web Alchemist works with the Anthropic API and with any provider that uses the OpenAI chat completions interface, and you enter your own API key. When you ask for a change, the text of the relevant part of the page, the page address and your description are sent to the provider you chose, and to no one else. The developer receives nothing. You can turn on encryption of stored keys with a passphrase.

JavaScript changes need the optional permission to run user scripts, which Web Alchemist requests when you first save one. Access to a site is requested one site at a time.

Web Alchemist is free software under the GPL-3.0-or-later licence. Android support is planned with a tab-based interface (issue 128) and the Android listing should not be published until that work is complete.

## Privacy policy draft

This text is a draft for the owner to review. It has not been reviewed by a lawyer.

### What Web Alchemist is

Web Alchemist is a Firefox extension that writes changes to webpages from descriptions given by the user.

### Data that leaves the browser

Data leaves the browser only when the user asks for a change to be written, checked or repaired. The extension then sends the following to the AI provider that the user selected in the settings:

- the user's description of the change;
- the text and markup of the relevant part of the page;
- the address of the page;
- a screenshot of the visible tab, if the user asked for one;
- the user's API key, to authenticate the request.

The provider is the only recipient. It handles the data under its own terms and privacy policy, which the user accepted when creating the key. Web Alchemist has no server and does not send anything to its developer, to an analytics service or to any other party.

### Data stored in the browser

Settings, saved changes, usage records and API keys are stored in the browser profile on the user's own computer. Keys are stored as plain text unless the user turns on passphrase encryption. Removing the extension deletes this data.

### Contact

The contact address is to be added by the owner before submission.

## Checklist for the account owner

These steps can be done only by the owner of the AMO account.

1. Confirm the open items named above: issues 53, 60, 61 and 137, and the decision about `identity` and `tabs`.
2. Ask Mozilla, before preparing the listing, whether a user-approved script written by a remote model and registered through `userScripts` is acceptable. The review in issue 41 recommends doing so first.
3. Check Mozilla's current data collection categories and adjust the manifest and this document if they differ from those named here.
4. Raise the version in `package.json` and `src/manifest.json` together if this is not the first upload.
5. Run `npm run check`, `npm test`, `npm run build`, `npm run lint:ext` and `npm run package` on a clean checkout of the release commit.
6. Test an update from the previous signed version, where one exists. Confirm that every user script and content script is registered again after the update (`onInstalled` with reason "update") and that settings and saved transforms are kept. For a first upload this step does not apply.
7. Create the source zip with `git archive --format=zip HEAD` and check that its build matches the package, as described above.
8. Upload `web-ext-artifacts/web_alchemist-0.1.0.zip` on AMO, attach the source zip, and paste the reviewer notes, permission justifications, summary and description from this document.
9. Publish the privacy policy at a stable address or paste it into the policy field, with the contact address filled in.
10. Add screenshots and the icon for the listing. Do not publish an Android listing until issue 128 is complete.
11. Choose listed or self-distributed signing, and submit.
