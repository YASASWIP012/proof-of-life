# Friction report: building Proof of Life on Arkiv

Every entry below is something we reproduced ourselves on 17 October 2026, with the command that reproduces it and the block or transaction where we saw it. Setup for all of them:

- `@arkiv-network/sdk` **0.8.1**, `viem` **2.57.7**, Node **24.19.0**, macOS 15.5
- Tiramisu testnet, chain `7738577`, `https://rpc.tiramisu.db-chain.testnet.arkiv.network` with an access key in the path (except where an entry says keyless)
- Probe scripts are in [`scripts/probe.ts`](../scripts/probe.ts) and [`scripts/e2e.ts`](../scripts/e2e.ts). They need `POL_MNEMONIC` in `.env` (`npx tsx scripts/gen-wallets.ts` makes one) and a funded publisher wallet (`npx tsx scripts/fund.ts`).

Problems come first, then paths we tested that worked, documented with the same rigour. Measured costs are at the end.

---

## Problems

### F1. One RPC limit, two symptoms, one unhelpful message

One root cause, the public RPC's request-body limit, shows up as two failures that the SDK reports with the same text.

- **Surface:** SDK `createEntity` and `executeBatch`; docs, Mutating data ("A payload is up to 128 KiB").
- **Expected:** any payload up to 131,072 bytes is accepted, since the SDK validates against exactly that number; a batch of creates each under the cap goes through, since nothing documents a batch limit.
- **Actual, symptom 1 (single payload):** 96 KiB and 120 KiB succeed. 127 KiB and 128 KiB fail with `EntityMutationError: Transaction failed: Execution error without revert data`. 129 KiB is refused locally with a clear message.
- **Actual, symptom 2 (batch):** `2 × 48 KiB` works (`0x925daa42…bd226d3`); `2 × 64 KiB`, `3 × 48 KiB`, `2 × 80 KiB` and `2 × 96 KiB` fail with the same message. Deep in the 2 × 96 KiB cause chain, viem holds an `HttpRequestError` with `Details: "BAD_REQUEST"`.
- **Cause, measured:** the public RPC refuses any request body over **262,144 bytes** with `HTTP 413 {"error":"BAD_REQUEST","message":"request body too large"}`. A payload travels hex-encoded inside ABI call data inside JSON, so it doubles on the wire, and around 125 KiB the `eth_estimateGas` request crosses the limit. Reproduce the limit with nothing but curl:

  ```bash
  pad() { python3 -c "import sys;n=int(sys.argv[1]);b='{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_chainId\",\"params\":[],\"pad\":\"\"}';print(b[:-2]+'x'*(n-len(b))+'\"}',end='')" $1; }
  pad 262144 | curl -s -w ' HTTP %{http_code}\n' -H 'content-type: application/json' --data-binary @- https://rpc.tiramisu.db-chain.testnet.arkiv.network
  pad 262200 | curl -s -w ' HTTP %{http_code}\n' -H 'content-type: application/json' --data-binary @- https://rpc.tiramisu.db-chain.testnet.arkiv.network
  ```

  Our run on 17 October at 16:09 UTC: 262,144 bytes returned `{"result":"0x7614d1"} HTTP 200`; 262,200 bytes returned `{"error":"BAD_REQUEST","message":"request body too large"} HTTP 413`. The SDK symptoms reproduce with `npx tsx scripts/probe.ts sizes` (around block 692412).
- **Cost to us:** the first design split ciphertext at the documented cap and failed on the first real upload; we also wanted a whole vault in one atomic batch, which this limit rules out above ~120 KiB.
- **What would fix it:** (1) the SDK computes the JSON-RPC body size before sending and throws a size error naming the byte count and the 262,144-byte limit; (2) the docs give the usable payload ceiling (about 125 KiB with a few attributes) next to the 128 KiB figure, and say a batch shares one request; (3) the SDK passes through the RPC's own `request body too large` text.
- **Our workaround:** 96 KiB chunks, one per transaction, each created and sealed atomically; the manifest batch is what makes a vault exist, so readers never see half a vault ([`vault.ts`](../packages/core/src/crypto/vault.ts) `CHUNK_BYTES`, [`writes.ts`](../packages/core/src/arkiv/writes.ts) `chunksPerTx`).

### F2. An unfunded wallet gets the same message, while a plain transfer gets a clear one

- **Surface:** `EntityMutationError` from `createEntity`.
- **Expected:** "insufficient funds" with the address and balance.
- **Actual:** a `createEntity` from a fresh wallet with 0 GLM fails with exactly the F1 text, `Transaction failed: Execution error without revert data`. A plain GLM transfer from a wallet that is short (`walletClient.sendTransaction`, viem 2.57.7) fails clearly: `InsufficientFundsError: The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.` So the information exists at the RPC; the entity-write path drops it.
- **Repro:** `npx tsx scripts/probe.ts unfunded` prints `unfunded write: Transaction failed: Execution error without revert data`. For the contrast, any `sendTransaction` from an empty wallet (we hit it on 18 October funding test wallets from a drained publisher).
- **What would fix it:** map an `insufficient funds` estimate failure to an `InsufficientGLM { address, balance }` error in the entity-write path, as viem already does for transfers.

### F3. Lifetime is not priced, although the docs say it is

- **Surface:** docs, Mutating data: "Start with a short lifetime and extend it while the data still matters, because you pay for the lifetime you choose."
- **Expected:** a longer lifetime costs more gas for the same payload.
- **Actual:** the same 32 KiB payload costs the same at 1, 30 and 365 days, within 0.05%:

  ```
  32 KiB for 1 day(s):   gas 1340430  0x06139ebe…cd504
  32 KiB for 30 day(s):  gas 1340190  0xbbcb0912…e19d
  32 KiB for 365 day(s): gas 1340880  0xdf17a6af…e221
  ```

  Block 692986.
- **Repro:** `npx tsx scripts/probe.ts lifetime`
- **Why it matters:** we designed the vault term around paying for time (short lifetimes plus carry-forward on each check-in). On Tiramisu today, a 365-day lifetime costs the same as a 1-day one, so the "pay for what you keep" advice does not hold. Either the docs describe future pricing or testnet pricing differs; the docs should say which.
- **What would fix it:** one line on the Tiramisu page saying whether lifetime is priced on this network.

### F4. The faucet needs a browser wallet and a person, so project wallets cannot be funded from a script

- **Surface:** Hub faucet (`hub.arkiv.network/faucet`) with a MetaMask wallet in Chrome, 17 October 2026.
- **Steps:** open the faucet page; it asks to connect a wallet and then to "Sign in with Ethereum" before any form appears; after signing, it shows "Send to", the network (Tiramisu testnet), "10 testnet $GLM per claim", a "Verify you're human" check and a claim button; after claiming, the button reads "Next claim in 58m".
- **Expected:** paste an address, pass a human check, receive GLM.
- **Actual:** the faucet first needs a connected browser wallet and Sign-In with Ethereum. After that it does offer "Use a different address", but only on the second screen; we found it after transferring by hand. One claim per wallet per hour, 10 GLM per claim.
- **What we did:** one claim to a MetaMask wallet, one transfer to a project treasury, and every other wallet derived from one mnemonic ([`scripts/env.ts`](../scripts/env.ts), [`scripts/fund.ts`](../scripts/fund.ts)). Those 10 GLM covered the whole build: every probe, four end-to-end runs, demo seeding and the gas tap judges use.
- **What would fix it:** show "Use a different address" on the first screen, and put the 10 GLM per hour per wallet numbers on the Tiramisu page.

---

### F5. Generic attribute values collide across projects, and anything typed can be enumerated

- **Surface:** queries over shared attribute names; docs, Querying data.
- **Expected:** `type = str('vault')` finds this project's vaults.
- **Actual:** attribute names and values are global. On 18 October at block 725981, `type = str('report')` returned 177 entities, 129 of them another project's; `type = str('heartbeat')` returned 28, 23 of them without our project tag. The flip side bit us: our first "unlisted" vaults dropped the project tag but kept `type = str('vault')` and typed numbers like `interval_s`, so a single query listed them anyway (2 of the 14 `type = str('vault')` results are those early vaults).
- **Repro:** `npx tsx scripts/collisions.ts`.
- **What we did:** every read filters by `project`, `vault_id` or `$creator`. Unlisted vaults now store only `vault_id` and a `type` hashed with the vault id ([`schema.ts`](../packages/core/src/arkiv/schema.ts) `kindTag`), with all numbers inside the encrypted manifest, so nothing can be listed without the link.
- **What would help:** a line in the docs that attribute names and values share one global space, with a recommended namespacing pattern.

## Paths we tested that worked

### W1. Sealing in the creating transaction with `predictEntityKeys` + `ownershipChanges`

- **Expected:** create read-only entities and hand them to `0x…dEaD` atomically, so they are undeletable from their first block.
- **Actual:** works. Every chunk batch and the manifest batch predict their keys, create with the predicted salts and transfer in the same `executeBatch`; `createdEntities` matched the prediction every time.
- **Checked:** in `scripts/e2e.ts` run 3 the activist then calls `deleteEntity` on its own sealed manifest and is refused: `entity 0xc04a44fc…db80d4 is owned by 0x000000000000000000000000000000000000dEaD, not 0x90E400c9…`.
- **Note:** a prediction holds only within one transaction, because keys derive from the account nonce. The JSDoc on `predictEntityKeys` warned us before we built multi-transaction predictions, so children link to a vault through a random `vault_id` attribute and trust comes from `$creator`.

### W2. Non-permissionless extension is owner-only

- **Expected:** a custodian cannot keep an activist's heartbeat alive.
- **Actual:** `extendEntity` on the heartbeat from a custodian wallet is refused with an ownership error (`scripts/e2e.ts`, report field `strangerExtendHeartbeat`).

### W3. `extendEntity` sets the expiry, it does not add to it

- **Expected (docs):** a check-in of `fromSeconds(interval + grace)` counts from now.
- **Actual:** confirmed. Run 3 used `interval + grace = 60 s`, which is 30 blocks. The heartbeat's expiry before the check-in was block 692371; after it, 692379. Adding 30 blocks to the old expiry would have given 692401. The new expiry, 692379, is 22 blocks earlier than that, so the extension counted from the check-in, not from the old expiry. (Both numbers are in `scripts/e2e-report-3.json`, field `checkInMovedExpiry`.)

### W4. WebSocket events over `wss://` with the key in the path

- **Expected:** `watchEntityEvents` on a `webSocket` transport with no `fromBlock` pushes events.
- **Actual:** `npx tsx scripts/probe.ts ws` printed `["created 692428","extended 692430","created 692433","deleted 692435"]` within 81 seconds, every operation in order.

### W5. Ownership errors name both addresses

- Wrong-owner writes fail with `entity 0x… is owned by 0x…, not 0x…`. This made the trust tests easy to write, and F3 asks for the same quality everywhere.

### W6. `NOT (type = …)` loads a whole vault except its ciphertext in one query

- `vault_id = bytes32(V) AND NOT (type = str('chunk')) AND NOT (type = str(<hashed chunk kind>))` works as documented. One query loads everything about a listed or unlisted vault except the ciphertext, which is the main reason a vault page stays inside the keyless budget ([`reads.ts`](../packages/core/src/arkiv/reads.ts) `loadVault`).

### W7. The full lifecycle, end to end

`npx tsx scripts/e2e.ts <run>` funds four fresh wallets, seals a three-chunk vault, confirms custody, checks in, waits for the lapse, releases 2 of 3 and decrypts from the chain alone. Run 3 finished in 134 seconds with `{"phase":"released","verified":true,"bigMatches":true}` ([`scripts/e2e-report-3.json`](../scripts/e2e-report-3.json)).

---

## Documented constraints we tested and designed around

These match the docs, so they are not defects. We list what we expected, what we measured, and what we built.

### D1. A public site cannot carry an access key, so we designed for the keyless budget

- **Surface:** public RPC limits; Access Keys docs ("Keep the key out of the browser").
- **Expected:** a censorship-resistant app reads Arkiv directly from the browser.
- **Actual:** the docs are right that a key in the page can be stolen. That leaves two options: read keyless and risk running out mid-demo, or run a relay with a key and add the server the app exists to avoid.
- **What we did:** we designed for the budget. A vault page costs **one query** (W6) and the directory three. Reads go direct by default; on a rate-limit style failure the app retries once through a small allowlisted relay ([`api/rpc.ts`](../api/rpc.ts)), and the footer says which path is in use. The CLI and curl recipes never use the relay.
- **What would fix it:** an origin-locked "publishable" key that is meant to be public, or a per-origin browser quota.

### D2. No event fires when an entity expires

- **Surface:** `watchEntityEvents`; documented in Live Events ("An entity that reaches its expiration date fires no event").
- **Expected (from the docs):** no event at expiry.
- **Actual:** as documented, nothing fires. In `scripts/probe.ts ws` an entity created with a 20-second life produced `created` and `extended` events and nothing when it expired (blocks 692428 to 692435).
- **Our workaround:** pages and the CLI set a timer from the heartbeat's own `$expiresAt`, then confirm with one query ([`events.ts`](../packages/core/src/arkiv/events.ts)).
- **What would fix it:** a synthetic `EntityExpired` event, or `arkiv_expiringBetween(from, to)` so a watcher can catch up after downtime.

## Measured costs (Tiramisu, 17 October 2026)

| Operation | Gas | GLM |
|---|---|---|
| One 96 KiB ciphertext chunk, sealed | 3,967,360 | 0.00397 |
| Manifest + 3 envelopes + heartbeat, sealed | 680,792 | 0.00068 |
| Custodian acknowledgement | 105,384 | 0.00011 |
| Check-in (extend heartbeat) | 25,180 | 0.000025 |
| Release (create + seal) | 127,720 | 0.00013 |
| 32 KiB entity for 1, 30 or 365 days | ~1,340,000 | 0.00134 (F4) |

Gas tracks payload size and does not depend on lifetime. A weekly check-in for a year costs about 0.0013 GLM.

## The one thing Arkiv should improve first

Make transaction failures say why (F1, F2). Three different problems share one message today, and every builder storing real files will hit at least two of them.
