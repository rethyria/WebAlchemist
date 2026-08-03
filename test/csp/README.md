# Verifying the user script world CSP

The capability model rests on one claim that cannot be established by reading
code: that a transform which declared no capabilities runs in a world whose CSP
actually stops it reaching the network.

That claim is made in `registry.ts`, in the review UI, and to the user at the
moment they approve code. This harness is how it gets checked.

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

1. Open the WebAlchemist sidebar on any page.
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
