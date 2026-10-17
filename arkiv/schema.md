# Proof of Life: data contract on Arkiv

This file is the whole contract. Another team can build a reader, a custodian bot or a different front end from it, with no code or permission from us. Everything below runs on the Tiramisu testnet (chain `7738577`) with `@arkiv-network/sdk` 0.8.1. The source of truth in code is [`packages/core/src/arkiv/schema.ts`](../packages/core/src/arkiv/schema.ts).

## The idea in one paragraph

An activist seals documents into a vault and keeps a **heartbeat** entity alive by extending it. While it beats, the documents stay encrypted. If it stops (Arkiv drops it at its expiry block), the activist's custodians publish their pieces of the key, and once `k` pieces are public anyone can decrypt. Arkiv carries the parts that must not depend on us: the deadline, the ciphertext nobody can delete, and the record of who published which piece.

## Entity types

Every entity carries these four attributes:

| Attribute | Type | Value |
|---|---|---|
| `project` | `str` | `proof-of-life` |
| `v` | `i32` | `1` (schema version) |
| `type` | `str` | one of `vault`, `chunk`, `envelope`, `heartbeat`, `ack`, `release` |
| `vault_id` | `bytes32` | random 32 bytes chosen in the activist's browser; links every entity of one vault |

`vault_id` is a link, not a credential. Anyone can write an entity with any `vault_id`. Trust comes only from `$creator`, as the trust rules below say.

| Type | Written by | Extra attributes | Payload | Flags | Owner after the write | Lifetime |
|---|---|---|---|---|---|---|
| `chunk` | activist | `idx` `i32` | ≤ 96 KiB of AES-256-GCM ciphertext | readonly, permissionlessExtension | `0x…dEaD` | vault term (default 365 days, min 30); anyone can extend |
| `vault` (manifest) | activist | `k` `i32`, `n` `i32`, `mode` `str`, `interval_s` `u64`, `grace_s` `u64`, `chunks` `i32`, `sealed_at_ms` `u64` | JSON manifest (below) | readonly, permissionlessExtension | `0x…dEaD` | vault term; anyone can extend |
| `envelope` | activist | `slot` `i32`, `custodian` `addr` | one key share, ECIES-encrypted to that custodian's key | readonly, permissionlessExtension | `0x…dEaD` | vault term; anyone can extend |
| `heartbeat` | activist | `interval_s` `u64`, `grace_s` `u64` | empty | readonly, **not** permissionless | activist | `interval_s + grace_s`, reset by every check-in |
| `beat` | activist | none | one encrypted ok/duress flag per custodian, fixed size (`n` × 77 bytes) | readonly | activist | `interval_s + grace_s`, one per check-in |
| `ack` | custodian | `slot` `i32` | empty | readonly | custodian | 14 days, reset by the custodian's watcher |
| `release` | custodian | `slot` `i32` | JSON: the share (or the share encrypted to a newsroom) | readonly, permissionlessExtension | `0x…dEaD` | vault term; anyone can extend |

### Why each lifetime is what it is

- **heartbeat: interval + grace, reset on check-in.** The expiry *is* the dead man's switch. Only its owner can extend it, and nobody else may, so a supporter cannot keep a dead activist "alive". Deleting it, for example under coercion, just stops it sooner.
- **ack: 14 days, renewed by activity.** A custodian's "I still hold my key" is a lease. When a custodian stops renewing, the activist sees it and can seal a new vault with someone else.
- **chunk, vault, envelope, release: a long term anyone can extend.** The evidence must outlive the activist. Each check-in carries forward any sealed entity due to expire within 30 days, and after a release anyone can press "keep alive". The UI and CLI say plainly when data nears its end.

### Why "sealed" means readonly plus `0x…dEaD`

`readonly` alone stops edits, but the owner can still delete. So every sealed entity is handed to `0x000000000000000000000000000000000000dEaD` **in the same atomic batch that creates it** (keys come from `predictEntityKeys`). From the first block it exists, nobody can delete it, including the activist under duress and including us. `permissionlessExtension` still lets anyone keep it alive.

## Manifest (payload of `vault`, `application/json`)

```jsonc
{
  "v": 1,
  "vault_id": "0x…32 bytes",
  "k": 2, "n": 3,
  "custodians": [{ "slot": 1, "address": "0x…", "pubkey": "0x02…33 bytes" }],   // one-time keys, one per vault
  "commitments": ["0x…"],          // sha256("proof-of-life/share/v1" ‖ vault_id ‖ share), one per slot
  "chunks": { "count": 2, "hashes": ["0x…"], "bytes": 120034 },
  "ciphertext_sha256": "0x…",
  "interval_s": 604800, "grace_s": 259200,
  "release": { "mode": "public" },  // or { "mode": "newsroom", "newsroom_pubkey": "0x02…" }
  "sealed_at_ms": 1760700000000,
  "tag": "short public label, never a name"
}
```

Nothing in the manifest identifies the activist, the custodians or the documents. Titles, notes and file names live inside the ciphertext.

## Release payload (`release`, `application/json`)

```jsonc
{ "v": 1, "slot": 1, "share": "0x01…", "sealed_to_newsroom": false, "observed_lapse_block": "1234567" }
```

In newsroom mode, `share` is the share ECIES-encrypted to `newsroom_pubkey`. The public can see that slot 1 released, and when, but only the newsroom can combine the pieces.

## Trust rules (what readers accept)

Readers (web app, CLI, any third party) apply these rules. Anything that fails is shown under "ignored" and never used.

1. The vault is the `vault` entity whose `$creator` is the creator in the vault link. If one creator wrote two, the earliest `$createdAt` wins.
2. `chunk`, `envelope` and `heartbeat` count only if their `$creator` is the vault's creator. A stranger's heartbeat cannot keep a vault alive.
3. `ack` and `release` count only if their `$creator` is the custodian address in that `slot` of the manifest.
4. A public `release` counts only if its share matches the slot's commitment. One valid release per slot.
5. Phase comes from the heartbeat's `$expiresAt` against the head block: **alive** before `expiresAt − grace`, **overdue** inside the grace window, **lapsed** once it is gone, then **releasing** and **released** as valid pieces arrive. A valid release while the heartbeat still beats is flagged as an **early release**.

## Queries the app runs

| Question | Query | Where |
|---|---|---|
| Everything about one vault except ciphertext (one request per page view) | `project = str('proof-of-life') AND vault_id = bytes32(V) AND NOT (type = str('chunk'))` | `loadVault` in [`reads.ts`](../packages/core/src/arkiv/reads.ts) |
| The ciphertext, only from the vault's creator, paginated with a cursor | `project = … AND vault_id = bytes32(V) AND type = str('chunk')` + `.createdBy(C)` | `loadCiphertext` |
| Every vault in the directory | `project = … AND type = str('vault')`, plus the same for `heartbeat` and `release` | `listVaults` |
| Envelopes addressed to one custodian key | `project = … AND type = str('envelope') AND custodian = addr(A)` | `envelopesFor` |
| Is this heartbeat alive? | `… AND type = str('heartbeat') AND $creator = addr(C)` and compare `$expiresAt` with the head | vault page "Check this without us" panel |

Arkiv has no server-side ordering, so chunks are ordered by their `idx` attribute and releases by `$createdAt` on the client.

## Live updates

Pages and the CLI watcher subscribe with `watchEntityEvents` over a **WebSocket** transport, with no `fromBlock`:

- `ExpiryExtended` on the heartbeat key → a check-in, shown at once.
- `EntityCreated` owned by a custodian address → an `ack` or a `release`; the page re-reads once.
- **No event fires when an entity expires.** The page and the CLI set a timer for the heartbeat's own expiry block, then confirm with one query.

## Writes (each one is a single atomic batch)

| Action | Batch |
|---|---|
| Seal | N × `chunk` creates, each batch handing its chunks to `0x…dEaD`; then one batch: `vault` + n × `envelope` + `heartbeat`, with `vault` and envelopes handed to `0x…dEaD`. The vault appears whole, and its clock starts, in one block |
| Check in | extend `heartbeat` by `interval + grace`, create one `beat` note, and extend any sealed entity due within 30 days |
| Confirm custody | create `ack`, or extend the existing one by 14 days |
| Release | create `release` and hand it to `0x…dEaD` in the same batch |
| Keep alive | extend sealed entities (anyone) |

## What different people can see

| Who | What they see | What they do not see |
|---|---|---|
| Anyone reading Arkiv | random `vault_id`s, ciphertext sizes, `k` and `n`, rhythm, the heartbeat deadline, check-in times, one-time custodian addresses, which slots released | names, titles, file names, document contents, which vaults belong to the same person (each vault is sealed by a fresh activist key) |
| The Arkiv RPC node (and our read relay, when it is used) | the IP address of every read and every check-in, and which vault it touched | contents, names, or whether a check-in was a duress one |
| The gas tap (our Vercel function) | the fresh address it funds and the request's IP address | keys, documents, vault ids. It keeps no log of its own; the hosting platform's request logs still exist |
| Someone holding the activist's phone | a list of passphrase-sealed blobs | addresses, roles, labels and vaults. Vaults are not stored on the phone; the app finds them on Arkiv after unlocking |
| Someone forcing a check-in | a normal check-in, on the phone, on the vault page and on chain | that the duress passphrase was used: the key blob looks like any other, and the check-in note has the same size and shape as a normal one |

Check-in timing stays visible to anyone watching the chain, and the RPC node sees the IP address a check-in comes from. An activist facing a capable adversary should check in over Tor or a VPN they already use, and at times they would be online anyway. The app says this before sealing.

## What stays off Arkiv, on purpose

| Kept off | Why |
|---|---|
| Plaintext documents, titles, notes, file names | Everything on Arkiv is public. Only ciphertext goes up |
| Private keys and passphrases | Keys live in the browser as passphrase-sealed blobs (scrypt + AES-256-GCM) that hide even the key's address and role; backups are the same blobs |
| Who the activist and custodians are | Custodians use a fresh key per vault; nothing on chain names anyone |
| How to contact anyone | Custodians reach the activist through their own channels |
| Gas funding | A small serverless tap sends test GLM to fresh keys. It never sees a key, a document or a vault |

## Wallets that write for this project

| Address | Role |
|---|---|
| `0x7C7e8C4e1463d2Bb3a459209fC846D361504847B` | publisher: funds demo actors |
| `0x0EB8778DDEBAF8d6dD95148698Fc99885Afc2b69` | gas tap: sends test GLM to fresh browser keys |
| demo activists and custodians | listed in [`scripts/demo-vaults.json`](../scripts/demo-vaults.json) once seeded |
| every other creator | real users and the in-browser drill: fresh keys made in their browsers |
