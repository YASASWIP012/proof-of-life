# Proof of Life: data contract on Arkiv

This file is the whole contract. Another team can build a reader, a custodian bot or a different front end from it, with no code or permission from us. Everything below runs on the Tiramisu testnet (chain `7738577`) with `@arkiv-network/sdk` 0.8.1. The source of truth in code is [`packages/core/src/arkiv/schema.ts`](../packages/core/src/arkiv/schema.ts).

## The idea in one paragraph

An activist seals documents into a vault and keeps a **heartbeat** entity alive by extending it. While it beats, the documents stay encrypted. If it stops (Arkiv drops it at its expiry block), the activist's custodians publish their pieces of the key, and once `k` pieces are public anyone can decrypt. Arkiv carries the parts that must not depend on us: the deadline, the ciphertext nobody can delete, and the record of who published which piece.

## Entity types

**Listed and unlisted.** A listed vault (the demo vaults) carries the attributes in the table below. An unlisted vault, the default for real use, carries only `vault_id`, the hashed `type`, and on envelopes the custodian's one-time address. It has no `project`, no `v`, no `idx`, no `slot` and none of the vault's numbers: `k`, `n`, rhythm and mode live only in the manifest payload, chunk order comes from matching each chunk's hash to the manifest, and a custodian's slot is its position in the manifest. No query on `project`, `type` or a number lists an unlisted vault (verified on Tiramisu: a vault sealed this way is absent from `type = str('vault')`; see friction F5). An unlisted vault is hidden from queries, not invisible: someone who scans every entity on the chain, follows the event stream, or walks the gas tap's transfers can still find entities that carry a `vault_id` and read their manifest, which is plaintext (`k`, `n`, rhythm and the custodians' one-time addresses). That scan never yields the documents, their titles, or who the activist or custodians are, because every key is fresh for each vault. **A release is always public**: it carries `project`, the plain `type = str('release')`, `slot` and `vault_creator`, so a vault that stayed hidden while alive becomes findable from the chain the moment its evidence is out.

Every entity of a **listed** vault carries these four attributes (an unlisted vault's entities carry only `type`, hashed, and `vault_id`, as above):

| Attribute | Type | Value |
|---|---|---|
| `project` | `str` | `proof-of-life`, **only on listed vaults**. Unlisted vaults (the default) omit it, so our directory query and any `type` or range query miss them; the app finds them by `vault_id` from the link |
| `v` | `i32` | `1` (schema version) |
| `type` | `str` | listed vaults: one of `vault`, `chunk`, `envelope`, `heartbeat`, `beat`, `ack`, `release`. Unlisted vaults: `x` + the first 12 bytes of `sha256("proof-of-life/kind/v1" ‖ vault_id ‖ kind)` as hex, for every kind except `release` (see below) |
| `vault_id` | `bytes32` | random 32 bytes chosen in the activist's browser; links every entity of one vault |

`vault_id` is a link, not a credential. Anyone can write an entity with any `vault_id`. Trust comes only from `$creator`, as the trust rules below say.

| Type | Written by | Extra attributes | Payload | Flags | Owner after the write | Lifetime |
|---|---|---|---|---|---|---|
| `chunk` | activist | `idx` `i32` | ≤ 96 KiB of AES-256-GCM ciphertext | readonly, permissionlessExtension (the activist can turn this off) | `0x…dEaD` | vault term (default 365 days, min 30); anyone can extend |
| `vault` (manifest) | activist | `k` `i32`, `n` `i32`, `mode` `str`, `interval_s` `u64`, `grace_s` `u64`, `chunks` `i32`, `sealed_at_ms` `u64` | JSON manifest (below) | readonly, permissionlessExtension | `0x…dEaD` | vault term; anyone can extend |
| `envelope` | activist | `slot` `i32`, `custodian` `addr` | one key share, ECIES-encrypted to that custodian's key | readonly, permissionlessExtension | `0x…dEaD` | vault term; anyone can extend |
| `heartbeat` | activist | `interval_s` `u64`, `grace_s` `u64` | empty | readonly, **not** permissionless | activist | `interval_s + grace_s`, reset by every check-in |
| `beat` | activist | none | the check-in's 16-byte token encrypted to each custodian, fixed size (`n` × 77 bytes) | readonly | activist | `interval_s + grace_s`, one per check-in |
| `ack` | custodian | `slot` `i32` | empty | readonly | custodian | 14 days, reset by the custodian's watcher |
| `release` | custodian | `project` `str` and plain `type = str('release')` on every release, listed vault or not; `slot` `i32`; `vault_creator` `addr` (the vault's creator, so released evidence is findable from the chain alone) | JSON: the share (or the share encrypted to a newsroom) | readonly, permissionlessExtension | `0x…dEaD` | vault term; anyone can extend |

### Why each lifetime is what it is

- **heartbeat: interval + grace, reset on check-in.** The expiry *is* the dead man's switch. Only its owner can extend it, and nobody else may, so a supporter cannot keep a dead activist "alive". Deleting it, for example under coercion, just stops it sooner.
- **ack: 14 days, renewed by activity.** A custodian's "I still hold my key" is a lease. When a custodian stops renewing, the activist sees it and can seal a new vault with someone else.
- **chunk, vault, envelope, release: a long term anyone can extend.** The evidence must outlive the activist. Each check-in carries forward any sealed entity due to expire within 30 days, and after a release anyone can press "keep alive". The UI and CLI say plainly when data nears its end.

### When the activist turns off "let anyone keep the evidence alive"

Then chunks, manifest and envelopes are created read-only **without** `permissionlessExtension` and **stay owned by the activist**. Only the activist can extend them, and it can let them lapse. (Sealing them to `0x…dEaD` as well would leave entities nobody could ever extend.) The trade-off is stated in the app: an owner can also delete, so this option gives up protection against forced deletion in exchange for full control of the data's lifetime.

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
  "listed": false                    // shown in the public directory or not
}
```

Nothing in the manifest identifies the activist, the custodians or the documents, and it holds no free text at all. Titles, notes, file names and any label the activist uses live inside the ciphertext. (The three demo vaults seeded on 17 October carry a short `tag`; new vaults never write one.)

## The duress signal

Each activist key has two random 16-byte tokens, `ok` and `duress`. At sealing, both go to every custodian **inside its envelope** (envelope plaintext = share ‖ ok ‖ duress). Each check-in writes a `beat` whose payload is the session's token encrypted to every custodian. On the phone, the key opened by the real passphrase checks in with `ok`; the second blob, opened by the duress passphrase, holds the same key and checks in with `duress`. Neither blob contains a flag: a token is random bytes, and only a custodian comparing it with its envelope can classify it. A key made without a duress passphrase gets a decoy second blob sealed under a random passphrase, so a phone always holds two blobs of the same size per key. Measured on Tiramisu: a normal and a forced check-in have identical calldata length (4042 bytes) and target, and the public phase stays "alive" (`scripts/duress.ts`). Code: [`crypto/duress.ts`](../packages/core/src/crypto/duress.ts).

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
| Everything about one vault except ciphertext (one request per page view) | `vault_id = bytes32(V) AND NOT (type = str('chunk'))` | `loadVault` in [`reads.ts`](../packages/core/src/arkiv/reads.ts) |
| The ciphertext, only from the vault's creator, paginated with a cursor | `vault_id = bytes32(V) AND type = str('chunk')` + `.createdBy(C)` | `loadCiphertext` |
| Released evidence, including vaults unlisted while alive | `project = str('proof-of-life') AND type = str('release')`, grouped by `vault_id` and `vault_creator` |
| A vault as it stood at a past block (proof it was alive then) | the vault query with `.atBlock(N)` |
| Listed vaults for the directory, every page walked with the cursor pinned to one block | `project = str('proof-of-life') AND type = str('vault')`, plus the same for `heartbeat` and `release` | `listVaults` |
| Vaults about to stop (directory filter "Stops within 3 days", `vaults --stops-within 3d`) | `project = str('proof-of-life') AND type = str('heartbeat') AND $expiresAt <= u64(head + 129600)`, a range on the heartbeat's own expiry | `listVaults({ stopsWithinS })` |
| Vaults with a slow rhythm (filter "Weekly check-in or slower", `--rhythm-at-least 7d`) | `project = str('proof-of-life') AND type = str('vault') AND interval_s >= u64(604800)` | `listVaults({ rhythmAtLeastS })` |

The two range filters cover **listed** vaults only, on purpose. An unlisted vault carries no number to range over, which is exactly what keeps it out of every such query. A custodian or activist who holds an unlisted vault's id reads its deadline straight from the heartbeat's `$expiresAt` in the one-query vault load.
| One activist key's own vaults, listed or not (check-in page) | `$creator = addr(key)`, kinds recognised by `kindOf` | `listVaults` |
| Envelopes addressed to one custodian key | `custodian = addr(A)`, kinds recognised by `kindOf` | `envelopesFor` |
| Is this heartbeat alive? | `… AND type = str('heartbeat') AND $creator = addr(C)` and compare `$expiresAt` with the head | vault page "Check this without us" panel |

Arkiv has no server-side ordering, so chunks are ordered by their `idx` attribute and releases by `$createdAt` on the client.

**Pagination.** Every multi-page read goes through one helper (`fetchAll` in [`reads.ts`](../packages/core/src/arkiv/reads.ts)). A single page costs one query. When there are more, the walk restarts with `.atBlock()` set to the first page's block, so no row moves between pages and a new block cannot invalidate the cursor halfway.

**What the typed numbers on a listed vault are for.** `interval_s` and the heartbeat's `$expiresAt` are ranged over by the two directory filters above. `k`, `n` and `mode` are read straight from attributes to draw the directory and the CLI's `vaults` list without decoding any payload. `chunks` and `sealed_at_ms` let a third party size or date a vault from attributes alone, for example `chunks >= i32(2)`. We do not run that last query ourselves.

## Live updates

Pages and the CLI watcher subscribe with `watchEntityEvents` over a **WebSocket** transport, with no `fromBlock`:

- `ExpiryExtended` on the heartbeat key → a check-in, shown at once.
- `EntityCreated` owned by a custodian address → an `ack` or a `release`; the page re-reads once.
- **No event fires when an entity expires.** The page and the CLI set a timer for the heartbeat's own expiry block, then confirm with one query.

## Writes (each one is a single atomic batch)

| Action | Batch |
|---|---|
| Seal | N × `chunk` creates, each batch handing its chunks to `0x…dEaD`; then one batch: `vault` + n × `envelope` + `heartbeat`, with `vault` and envelopes handed to `0x…dEaD`. The vault appears whole, and its clock starts, in one block |
| Check in | extend `heartbeat` by `interval + grace`, create one `beat` note, and extend every vault entity due within 30 days that the activist may extend (`extendableKeys`: permissionless ones, plus ones it still owns), chunks included, so a check-in batch can never revert |
| Confirm custody | create `ack`, or extend the existing one by 14 days |
| Release | create `release` and hand it to `0x…dEaD` in the same batch |
| Keep alive | extend sealed entities (anyone) |

## What different people can see

| Who | What they see | What they do not see |
|---|---|---|
| Anyone reading Arkiv | for a vault whose link they hold: ciphertext sizes, `k` and `n`, rhythm, the heartbeat deadline, check-in times, one-time custodian addresses, which slots released | names, titles, file names, document contents, which vaults belong to the same person (each vault is sealed by a fresh activist key) |
| The Arkiv RPC node (and our read relay, when it is used) | the IP address of every read and every check-in, and which vault it touched | contents, names, or whether a check-in was a duress one |
| The gas tap (our Vercel function) | the fresh address it funds. Its code never reads the caller's IP: spam is held off by a proof of work the browser solves ([`api/_lib.ts`](../api/_lib.ts) `powValid`), a per-address limit and an hourly budget | keys, documents, vault ids. It keeps no log of its own. The hosting platform still sees the request's IP in its own logs, and the tap's transfers are public, so every key it funds is visibly a Proof of Life key. For a real vault, the app's "own gas" option funds the key from elsewhere |
| Someone holding the activist's phone | a list of passphrase-sealed blobs | addresses, roles, labels and vaults. Vaults are not stored on the phone; the app finds them on Arkiv after unlocking |
| Someone forcing a check-in | a normal check-in, on the phone, on the vault page and on chain | that the duress passphrase was used: the key blob looks like any other, and the check-in note has the same size and shape as a normal one |

Expiry is not erasure: Arkiv keeps history, and an expired entity can still be read with `atBlock` at a block where it was alive (measured, friction F6). Everything Proof of Life stores is either ciphertext or meant to be public, so this changes nothing about what can be read, but an activist who lets a vault expire should know the ciphertext is not gone. It stays unreadable without `k` key pieces. Check-in timing stays visible to anyone watching the chain, and the RPC node sees the IP address a check-in comes from. An activist facing a capable adversary should check in over Tor or a VPN they already use, and at times they would be online anyway. The app says this before sealing.

## What stays off Arkiv, on purpose

| Kept off | Why |
|---|---|
| Plaintext documents, titles, notes, file names | Everything on Arkiv is public. Only ciphertext goes up |
| Private keys and passphrases | Keys live in the browser as passphrase-sealed blobs (scrypt + AES-256-GCM) that hide even the key's address and role; backups are the same blobs |
| Who the activist and custodians are | The app makes a fresh key for every vault, for activists and custodians alike; nothing on chain names anyone. One honest exception: our outside pilot custodian used the same custodian key for `pilot` and `pilot-2`, so those two vaults are visibly linked through it |
| How to contact anyone | Custodians reach the activist through their own channels |
| Gas funding | A small serverless tap sends test GLM to fresh keys after a proof of work. It never sees a key, a document, a vault or (in its code) an IP address |

## Wallets that write for this project

| Address | Role |
|---|---|
| `0x7C7e8C4e1463d2Bb3a459209fC846D361504847B` | publisher: funds demo actors |
| `0x0EB8778DDEBAF8d6dD95148698Fc99885Afc2b69` | gas tap: sends test GLM to fresh browser keys |
| demo activists and custodians | listed in [`scripts/demo-vaults.json`](../scripts/demo-vaults.json) once seeded |
| every other creator | real users and the in-browser drill: fresh keys made in their browsers |
