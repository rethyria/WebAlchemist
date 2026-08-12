# What a non-extractable key buys, measured

#46 proposes encrypting stored credentials with a non-extractable `CryptoKey`
held in IndexedDB, and says the on-disk question has to be measured before the
change is described to users as protection.

It was measured. **It buys nothing against reading the profile directory.**

## Result

```
ok    control  the sealed key refuses export (InvalidAccessError)
ok    control  the sealed key survives IndexedDB and still decrypts (hello)
ok    control  it is still non-extractable after the round trip (false)
ok    control  the plaintext canary is on disk (1 file(s))
ok    control  a string never written is not found (0 file(s))
ok    control  the imported sealed key also refuses export (InvalidAccessError)
ok    control  the extractable key's raw bytes are on disk in the clear (1 file(s))
ok    TEST     a NON-EXTRACTABLE key's raw bytes are on disk in the clear (1 file(s))
```

The key material was found verbatim in

```
storage/default/moz-extension+++<uuid>/idb/<hash>.sqlite
```

Firefox 143, profile at `.web-ext-profile`.

## Method, and why it is a direct measurement

A generated non-extractable key cannot be exported, so its bytes are unknown and
cannot be searched for. The obvious workaround is to store an *extractable* key
beside it and reason that both took the same code path — but that is an
inference, and the conclusion would rest on it.

It does not have to. `crypto.subtle.importKey('raw', knownBytes, …, false, …)`
produces a key that is non-extractable in exactly the way a generated one is:
same flag, same `InvalidAccessError` on export, same structured-clone path into
IndexedDB. Its bytes are known because they were supplied. Searching for *those*
measures the thing directly.

Both are in the probe. The generated key is what a real implementation would
use, so its behaviour is pinned too; the imported one is what makes the result a
measurement rather than an argument.

Controls, all of which passed:

- A plaintext canary written in the same transaction — found. Without this,
  "the key was not found" could just mean the search was reading the wrong
  files.
- A string never written anywhere — not found. Without this, a search that
  matched everything would look like a positive result.
- Both sealed keys refusing export — otherwise "non-extractable" is not what is
  being measured.
- The sealed key surviving the round trip and still decrypting — the premise of
  the whole design is that a stored non-extractable key remains usable. It does.

## Reading

`extractable: false` is enforced at the WebCrypto API boundary, inside the
process. It stops *JavaScript* from reading the key — ours included. It does not
stop anything from reading the profile directory, because Firefox writes the key
material into the IndexedDB file in the clear.

So the design in #46's first proposal has the exact shape #46 itself warns
against: the decryption key sits next to the ciphertext at rest, in the same
directory, under the same file permissions. Moving it from `storage.local` to
`idb/*.sqlite` changes the file an attacker greps, not whether they succeed.

That is obfuscation. #46 says obfuscation should be rejected on those grounds
rather than shipped for the appearance of security, and this measurement is the
grounds.

## What it does still buy, stated exactly so it is not oversold

One real thing, and it is small: an attacker who has already achieved script
execution in an extension context can use the key but cannot copy it. They can
decrypt every credential in place, so it does not protect the credentials — it
only means the key itself cannot be carried away for offline use. Against the
threat #46 is about, reading the profile, it is worth nothing.

It is also unchanged with respect to #45: code running in an extension context
can simply ask the key to decrypt.

## What actually works

Only a passphrase-derived key. Nothing on disk decrypts without something the
user knows, so reading the profile yields ciphertext and nothing else.

The costs are real and land on the user, not on us:

- An unlock step after every browser start. The MV3 background is an event page
  and is torn down routinely, so the derived key cannot simply live in memory
  for the session — it has to be re-derived, and every teardown is another
  prompt unless it is cached somewhere, and anywhere it could be cached is the
  profile directory again.
- A forgotten passphrase means the stored credentials are gone. There is no
  recovery that does not reintroduce the original problem.

That is why it is offered as a choice rather than imposed as a default.

## What was built instead, and what is verified about it

`src/background/vault.ts`. Passphrase mode, off by default: PBKDF2-HMAC-SHA256
at 600,000 iterations derives an AES-GCM key, the credential map is stored as
ciphertext, and the derived key lives in `storage.session`.

`storage.session` is the reason this is usable rather than theoretical. The MV3
background is an event page torn down whenever it idles, so a derived key cannot
live in a module variable, and re-deriving after every teardown would mean a
prompt every few minutes. `session-probe.mjs` measured it: a value written to
`storage.session` was not found anywhere in the 3823 files of the profile, while
the same string written to `storage.local` in the same run was found
immediately. That control is what makes the result mean something. So the user
unlocks once per browser session.

Verified by `vault-probe.mjs`, through a real browser:

- what `storage.local` holds afterwards is `{"sealed":true,…}` and not a
  credential map;
- locking reports locked, and reading credentials then raises rather than
  returning an empty map;
- a wrong passphrase is refused — AES-GCM authenticates, so this needs nothing
  stored to compare against;
- the credential survives seal → lock → unlock → unseal unchanged.

And by `src/background/vault.test.ts`: fresh IV per encryption, plaintext absent
from the sealed value in both raw and base64 form, altered ciphertext rejected,
wrong salt rejected — each with a right-key control, since three rejections
would otherwise pass against a function that always threw.

## Two things the measurement could NOT establish

**Whether the plaintext is absent from the profile.** The obvious check — write
a canary credential, seal it, search the profile — is not reliable here. Asked
for values known to be in `storage.local` right now, the search found a
transform's id and name and did *not* find that same transform's `code`, or
`settings.accent`. So some `storage.local` content is findable on disk and some
is not, and a negative result cannot be attributed to encryption.

The first run of `vault-probe.mjs` did pass its control and did find the canary
after sealing. Later runs failed the control, which is why this section says
inconclusive rather than either answer. **The at-rest claim rests on what is
stored being ciphertext — which is verified at the API level — and not on a
successful disk search.**

**Residue.** In the run whose control passed, the canary was on disk before
sealing and still on disk after. That is the expected behaviour of an
IndexedDB-backed store: writing over a value does not erase the bytes already
written, and no extension API can compact the database.

So enabling passphrase mode protects everything from that point on and cannot
retract what was already written. The settings copy says exactly that, and
suggests replacing the key at the provider — which makes the residue worthless
without needing to erase it.

## Reproducing

Requires a running Firefox with remote debugging on 41365 and the extension
loaded.

```
node test/crypto/probe.mjs          # W1: what a non-extractable key buys
node test/crypto/session-probe.mjs  # whether storage.session reaches disk
node test/crypto/vault-probe.mjs    # the passphrase vault, end to end
```

The probe creates and deletes its own IndexedDB database and touches nothing the
extension uses.

One environment note: the flatpak Firefox on this machine cannot see `/tmp`, so
anything it must read has to live inside the project directory.
