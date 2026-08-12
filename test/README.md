# Live harnesses

`npm test` runs the unit tests. These are the other kind: they drive a running
Firefox over the remote debugging protocol and check what the browser actually
does — what lands on disk, what a page ends up styled with, what Firefox draws
on the toolbar.

```
npm run verify
```

Needs Firefox running with remote debugging on 41365 and the extension loaded
(`npm run start:firefox`). The runner starts the two local servers some probes
need, so a sweep cannot quietly skip them.

Expect ten to fifteen minutes. Several probes poll for a condition rather than
sleeping a fixed time — the crypto ones wait up to 45 seconds for
`storage.local` to reach the disk, because a fixed four-second wait found the
canary on one run and missed it on the next, which made the control fail and
the run meaningless. Individual probes can be run on their own:
`node test/badge/probe.mjs`.

## What each one answers

| Probe | Question |
|---|---|
| `crypto/probe.mjs` | Does a non-extractable key stay off the disk? (#46) |
| `crypto/session-probe.mjs` | Does `storage.session` reach the disk? |
| `crypto/vault-probe.mjs` | Does passphrase mode work end to end? (#46) |
| `injection/measure.mjs` | Which page-controlled channels reach the model? (#44) |
| `oauth/identity-check.mjs` | Is `identity` accepted, and where? (#32) |
| `badge/probe.mjs` | Do the four badge states appear? (#29) |
| `ratelimit/probe.mjs` | Does `retry-after` reach the panel? (#35) |
| `authoring/probe.mjs` | Can a transform be written by hand? (#27) |
| `intent/probe.mjs` | Does `context-for-anchor` return a tree? |
| `editor/probe.mjs` | Does the editor page load, colour, gate and save? |
| `suspend/probe.mjs` | Does suspend take a transform off the page, and resume put it back? |
| `contrast/probe.mjs` | Does every surface meet WCAG in both schemes? (#38) |
| `csp/server.mjs` | Does the user script world enforce `connect-src`? (#21) |

The CSP one is separate — `npm run verify:csp` — because it needs a probe-only
build.

## The rule these are written to

**Every claim gets a control that would have caught it failing.** A test that
cannot fail proves nothing, and this project has been caught by that more than
once:

- A CSP harness printed "all egress was contained" while the probe had never
  run, because a match pattern carried a port and matched nothing.
- A contrast run measured the light pass's still-open page during the dark pass
  and reported identical numbers for both.
- A suspend run styled the tab it created and measured a different one the
  profile already had open, then reported the transform as never applying.

In each case the control is what found it. So each probe prints its controls
alongside its tests, and a run whose controls fail is reported as saying
nothing rather than as a pass.

## Things worth knowing before writing another one

- **A message from the background does not reach the background's own
  listener.** `runtime.sendMessage` and `runtime.connect` exclude the sender, so
  anything testing a message handler has to send from another extension
  context. The options page works and needs no user gesture; the sidebar cannot
  be opened without one.
- **Match patterns cannot contain a port.** `http://localhost:8787/*` is
  accepted and then matches nothing.
- **Use a unique page URL.** `ctx.tab('example.com')` finds the *first* tab
  serving it, which on a real profile is very likely one the user already had
  open. `uniqueUrl()` in `crypto/rdp.mjs` exists for this.
- **The flatpak Firefox cannot see `/tmp`.** Anything it must read has to live
  inside the project directory.
- **Long values need `long()`, not `raw()`.** The console returns a grip above
  about 10k, and `raw()` will hand back `"object"` instead of the string.
- **Nothing should spend the user's credit.** The stub provider in
  `badge/stub-provider.mjs` is a real OpenAI-compatible endpoint on loopback,
  which needs no credential, and can be told to hold a request open or to return
  a 429 with a `retry-after`.
