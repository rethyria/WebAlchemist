# Verifying the user script world CSP

The capability model rested on one claim that cannot be established by reading
code: that a transform which declared no capabilities runs in a world whose CSP
actually stops it reaching the network.

That claim was made in `registry.ts`, in the review UI, and to the user at the
moment they approve code. This harness is how it got checked.

## The result: it does not

Run on 2026-08-07, Firefox 145 on SteamOS, against a world configured with
`default-src 'none'; connect-src 'none'; img-src 'none'`:

```
ESCAPED  fetch        connect-src   probe saw: resolved
ESCAPED  xhr          connect-src   probe saw: loaded
ESCAPED  websocket    connect-src   probe saw: error event
ESCAPED  beacon       connect-src   probe saw: queued
ESCAPED  eventsource  connect-src   probe saw: error event
blocked  image        img-src       probe saw: error event
```

Five of six arrived. The two that reported `error event` still reached the
server — the socket and the event stream failed for their own reasons after
the request was made, which is no comfort at all: the bytes left.

**The CSP is applied.** Re-running with `network` declared, so `img-src 'none'`
becomes `img-src *`, flips the image from blocked to arriving and nothing else
changes. So the directives are read; Firefox simply does not bind
`connect-src` — or `default-src` — against these APIs in a user script world.

The consequence, applied in commit form: `network` moved from `csp` to
`disclosure` in `CAPABILITY_ENFORCEMENT`, and every claim that the browser
stops an undeclared request was rewritten. The only control over any
capability is refusing to save the code, which is what an undeclared use
already triggers. `img-src` is kept because it does close the image-beacon
channel, and the rest of the directives are kept because they cost nothing and
a browser that starts honouring them would tighten this for free.

## Two ways this test can lie, and what stops each

`arrived` proves egress. *Nothing* arriving proves egress was blocked only if
the probe ran, and the probe running is not implied by the page loading. An
earlier version of this harness had only the page-level control, and reported
`All egress was contained` for a run in which the user script never executed —
the exact false pass it was built to prevent. Both controls are now required
before any verdict is printed:

- the **page control** (`/control`) proves the network path to this server;
- the **probe report** proves the code under test actually ran.

Missing either is `INCONCLUSIVE`, exit 2.

A third trap, found the same way: a match pattern's host cannot contain a
port. `http://localhost:8787/*` is accepted by `userScripts.register` without
complaint and then matches nothing, which is why this ran clean for months
without ever having run. The probe registers for `localhost/*` and puts the
port in the target URL, where it is allowed. Real transforms were never
affected — `matchPresetsFor` builds from `url.hostname`, which has no port.

## What it proves, and how

The probe fires six kinds of egress at `http://localhost:8787/egress`:

| method        | directive     |
| ------------- | ------------- |
| `fetch`       | `connect-src` |
| `XMLHttpRequest` | `connect-src` |
| `WebSocket`   | `connect-src` |
| `sendBeacon`  | `connect-src` |
| `EventSource` | `connect-src` |
| `new Image().src` | `img-src` |

**The server decides the verdict, not the probe.** Anything that arrives at
`/egress` escaped. Asking the probe to report its own outcome would be weaker
evidence — a `fetch` rejects for plenty of reasons that are not CSP, and a
`catch` block cannot tell them apart. A request that reaches the server is
unambiguous.

The page also fires a control request to `/control`. It has no extension CSP,
so it must always arrive. If it does not, the run is reported INCONCLUSIVE
rather than passing — otherwise "the probe never ran" and "everything was
blocked" would look identical, which is the most dangerous false negative this
test could produce.

The probe is registered through `registerTransform`, the same path a real
transform takes, so it gets the same world, the same `cspForCapabilities`
output and the same harness. A probe that took a shortcut would be testing the
shortcut.

## Running it

Two terminals.

```
# 1. the oracle
npm run verify:csp

# 2. Firefox with the probe build loaded
npm run start:firefox:probe
```

Then, in that Firefox:

1. Open the Web Alchemist sidebar on any page.
2. Click **Run CSP probe** (only present when built with `VITE_CSP_PROBE=1`).
3. Grant the permission prompt — `localhost:8787` and user scripts.

The tab navigates to the fixture, the probe runs, and the verdict prints in
terminal 1. Exit code is 0 if everything was contained, 1 if anything escaped,
2 if the run was inconclusive.

## If something escapes

Do not leave the claim as written. Either tighten the directives in
`cspForCapabilities` until the method is contained, or move that capability
from `csp` to `disclosure` in `CAPABILITY_ENFORCEMENT` and let the review UI
tell the user the truth — that refusing it means refusing the code, because
the browser will not stop it.
