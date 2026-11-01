# Can a content script read the vault key in storage.session? (#79)

The passphrase vault keeps the key it derives from the passphrase in `storage.session` while the vault is unlocked. The design assumed that content scripts cannot read that storage area. Chrome hides it from content scripts by default, and the earlier session probe (`test/crypto/session-probe.mjs`) measured only whether the stored value reaches the disk. This probe measures which contexts can read it.

## Result

Content scripts cannot read `storage.session` in Firefox 159.0 (flatpak build, SteamOS), measured on 2026-11-01. The `storage` object in a content script has the properties `local`, `managed`, `sync` and `onChanged`. It has no `session` property, so every call on it throws a TypeError before any request is made. No fix is needed, and no call to `setAccessLevel` is available or required: that method does not exist on the area in either context in this Firefox build.

## Method

A content script cannot be evaluated into directly over the debugging protocol. The probe therefore runs `scripting.executeScript` from the background with a function in the isolated world of a new tab at `https://example.com/`. That world is the one the extension's registered content script (`wa-content`) runs in, and it has the same extension API surface. The probe does not read the vault key. It writes a canary value under its own key name, and it removes the canary and the tab at the end.

## Measurements and controls

| Measurement | Result |
|---|---|
| Content context reads the canary with `storage.session.get(key)` | Throws, because `browser.storage.session` is undefined |
| Content context lists the area with `get()` and `get(null)`, and calls `getBytesInUse` | Throws, for the same reason |
| Content context writes to the area | Throws; the background then reads the value it had written itself |
| `storage.onChanged` in the content context, after the background writes to the area | No event for the session area |
| `runtime.sendMessage` with the `vault-state` message | Returns an object with the fields `ok` and `data` (status only, no key). Other routes through the background were not enumerated. |

| Control | Result |
|---|---|
| The background reads the session canary | Passes, so the canary was stored |
| The executed function runs in a content context | Passes: `location.href` is the web page, and `browser.tabs` does not exist |
| `storage.local` is readable from the content context | Passes, so the storage API itself is present there |
| A `storage.local` write from the content context reaches the background | Passes, so the write check can detect a write that lands |
| A `storage.local` write is reported to a `storage.onChanged` listener in the content context | Passes, so the listener check can detect an event |
| The background still reads the canary at the end | Passes |

## What was not verified

- Only the isolated content-script world was measured. The user script world was not, because its extension API surface is configured separately and is not used to hold credentials.
- Message handlers in the background were not enumerated for a route that returns the key. That question belongs to the sender-check issue, and the `vault-state` message returns status only.
- The probe does not unlock a real vault. It uses a canary under another key name, so it shows that the area is absent from the content context, not that the real key could not be reached by some other path.
- Other Firefox versions were not measured. The extension requires Firefox 140 or later, and `storage.session` access for content scripts could differ before 159.

## Reproducing

Run Firefox with the extension and remote debugging, then:

```
WA_RDP_PORT=<port> node test/vault-session/probe.mjs
```

`WA_RDP_PORT` is optional and defaults to 41365. `web-ext run` picks a free port at random and does not print it. The port is the one the Firefox process listens on, which `ss -ltnp` shows.
