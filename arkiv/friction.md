# Friction report: building Proof of Life on Arkiv

Every entry below is something we reproduced ourselves on 17 October 2026, with the command that reproduces it and the block or transaction where we saw it. Setup for all of them:

- `@arkiv-network/sdk` **0.8.1**, `viem` **2.57.7**, Node **24.19.0**, macOS 15.5
- Tiramisu testnet, chain `7738577`, `https://rpc.tiramisu.db-chain.testnet.arkiv.network` with an access key in the path (except where an entry says keyless)
- Probe scripts are in [`scripts/probe.ts`](../scripts/probe.ts) and [`scripts/e2e.ts`](../scripts/e2e.ts). They need `POL_MNEMONIC` in `.env` (`npx tsx scripts/gen-wallets.ts` makes one) and a funded publisher wallet (`npx tsx scripts/fund.ts`).

Problems come first, then paths we tested that worked, documented with the same rigour. Measured costs are at the end.

---

## Problems

### F1. A payload at the documented 128 KiB limit cannot be written

- **Surface:** SDK `createEntity`; docs, Mutating data ("A payload is up to 128 KiB").
- **Expected:** any payload up to 131,072 bytes is accepted. The SDK validates against exactly that number.
- **Actual:** 96 KiB and 120 KiB succeed. 127 KiB and 128 KiB fail with `EntityMutationError: Transaction failed: Execution error without revert data`. 129 KiB is refused locally with a clear message. The SDK's own check passes payloads the network always refuses, and the refusal does not mention size.
- **Seen:** around block 692412 (`single 120 KiB: ok 0xa74c6664…cd443`; the 127 and 128 KiB attempts in the same run failed before broadcast).
- **Repro:** `npx tsx scripts/probe.ts sizes`

  ```
  single 96 KiB: ok
  single 120 KiB: ok
  single 127 KiB: FAIL Transaction failed: Execution error without revert data
  single 128 KiB: FAIL Transaction failed: Execution error without revert data
  single 129 KiB: FAIL Invalid bytes value "<132096 bytes>": 132096 bytes exceeds the 131072-byte payload limit…
  ```

- **Cost to us:** the first design split ciphertext at the documented cap and failed on the first real upload.
- **Likely cause:** the encoded transaction (payload as hex inside ABI-encoded call data, plus attributes) crosses a transaction size limit before the payload reaches 128 KiB. We did not find the node-side number in the docs.
- **What would fix it:** (1) the SDK checks the encoded transaction size before sending and throws a size error naming the encoded byte count and the limit; (2) the docs state the usable ceiling next to the 128 KiB figure; (3) the node answers with an oversize error instead of an empty revert.
- **Our workaround:** 96 KiB chunks, one per transaction ([`vault.ts`](../packages/core/src/crypto/vault.ts) `CHUNK_BYTES`, [`writes.ts`](../packages/core/src/arkiv/writes.ts) `chunksPerTx`).

### F2. The same limit covers a whole batch, with no documentation and the same opaque error

- **Surface:** `executeBatch`.
- **Expected:** a batch of creates, each under 128 KiB, goes through. Nothing in the docs mentions a batch size limit.
- **Actual:** `2 × 48 KiB` works (`0x925daa42…bd226d3`). `2 × 64 KiB`, `3 × 48 KiB`, `2 × 80 KiB` and `2 × 96 KiB` all fail with `Execution error without revert data`. In the 2 × 96 KiB case, the cause chain holds a viem `HttpRequestError` with `Details: "BAD_REQUEST"` from `eth_estimateGas`; the top-level message never says the request was too big.
- **Repro:** `npx tsx scripts/probe.ts sizes` (batch lines), or `CHUNKS_PER_TX=2 npx tsx scripts/e2e.ts 2` for the real case.
- **Cost to us:** we wanted a whole vault (ciphertext, manifest, envelopes, heartbeat) in one atomic batch. Above about 120 KiB that is impossible, so ciphertext goes first, one chunk per transaction, each chunk created and sealed atomically. The manifest batch is what makes the vault exist, so readers still never see half a vault.
- **What would fix it:** a documented per-transaction size budget for `executeBatch`, and an SDK that splits or refuses with the measured size.

### F3. An unfunded wallet gets the same "Execution error without revert data"

- **Surface:** `EntityMutationError` message.
- **Expected:** "insufficient funds" with the address and balance, which is what viem produces for a plain transfer.
- **Actual:** a `createEntity` from a fresh wallet with 0 GLM fails with exactly the text of F1 and F2: `Transaction failed: Execution error without revert data`. Three different causes (payload too large, batch too large, no gas) share one message.
- **Repro:** `npx tsx scripts/probe.ts unfunded` prints `unfunded write: Transaction failed: Execution error without revert data`.
- **What would fix it:** map an `insufficient funds` estimate failure to an `InsufficientGLM { address, balance }` error and the HTTP 400 from F2 to a size error. The ownership errors already show the standard to aim for (see W5).

### F4. Lifetime is not priced, although the docs say it is

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

### F5. The faucet needs a browser wallet and a person, so project wallets cannot be funded from a script

- **Surface:** Hub faucet (`hub.arkiv.network/faucet`).
- **Expected:** paste an address, pass a human check, receive GLM.
- **Actual:** the faucet first needs a connected browser wallet and Sign-In with Ethereum. After that it does offer "Use a different address", but only on the second screen; we found it after transferring by hand. One claim per wallet per hour, 10 GLM per claim.
- **What we did:** one claim to a MetaMask wallet, one transfer to a project treasury, and every other wallet derived from one mnemonic ([`scripts/env.ts`](../scripts/env.ts), [`scripts/fund.ts`](../scripts/fund.ts)). Those 10 GLM covered the whole build: every probe, four end-to-end runs, demo seeding and the gas tap judges use.
- **What would fix it:** show "Use a different address" on the first screen, and put the 10 GLM per hour per wallet numbers on the Tiramisu page.

### F6. A public site cannot carry an access key, and the keyless budget is small

- **Surface:** public RPC limits; Access Keys docs ("Keep the key out of the browser").
- **Expected:** a censorship-resistant app reads Arkiv directly from the browser.
- **Actual:** the docs are right that a key in the page can be stolen. That leaves two options: read keyless and risk running out mid-demo, or run a relay with a key and add the server the app exists to avoid.
- **What we did:** we designed for the budget. A vault page costs **one query** (W6) and the directory three. Reads go direct by default; on a rate-limit style failure the app retries once through a small allowlisted relay ([`api/rpc.ts`](../api/rpc.ts)), and the footer says which path is in use. The CLI and curl recipes never use the relay.
- **What would fix it:** an origin-locked "publishable" key that is meant to be public, or a per-origin browser quota.

### F7. No event when an entity expires

- **Surface:** `watchEntityEvents`; documented in Live Events ("An entity that reaches its expiration date fires no event").
- **Expected (for this product):** the heartbeat lapsing is the one moment that matters, so we wanted an event.
- **Actual:** as documented, nothing fires. In `scripts/probe.ts ws` an entity created with a 20-second life produced `created` and `extended` events and nothing when it expired (blocks 692428 to 692435).
- **Our workaround:** pages and the CLI set a timer from the heartbeat's own `$expiresAt`, then confirm with one query ([`events.ts`](../packages/core/src/arkiv/events.ts)).
- **What would fix it:** a synthetic `EntityExpired` event, or `arkiv_expiringBetween(from, to)` so a watcher can catch up after downtime.

---

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
- **Actual:** confirmed. In run 3 a check-in moved the heartbeat from block 692371 to 692379, which is now plus 30 blocks, not the old expiry plus 30. A dead man's switch needs exactly this.

### W4. WebSocket events over `wss://` with the key in the path

- **Expected:** `watchEntityEvents` on a `webSocket` transport with no `fromBlock` pushes events.
- **Actual:** `npx tsx scripts/probe.ts ws` printed `["created 692428","extended 692430","created 692433","deleted 692435"]` within 81 seconds, every operation in order.

### W5. Ownership errors name both addresses

- Wrong-owner writes fail with `entity 0x… is owned by 0x…, not 0x…`. This made the trust tests easy to write, and F3 asks for the same quality everywhere.

### W6. `NOT (type = str('chunk'))` loads a whole vault except its ciphertext in one query

- `project = str('proof-of-life') AND vault_id = bytes32(V) AND NOT (type = str('chunk'))` works as documented, and it is the main reason a vault page stays inside the keyless budget.

### W7. The full lifecycle, end to end

`npx tsx scripts/e2e.ts <run>` funds four fresh wallets, seals a three-chunk vault, confirms custody, checks in, waits for the lapse, releases 2 of 3 and decrypts from the chain alone. Run 3 finished in 134 seconds with `{"phase":"released","verified":true,"bigMatches":true}` ([`scripts/e2e-report-3.json`](../scripts/e2e-report-3.json)).

---

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

Make transaction failures say why (F1, F2, F3). Three different problems share one message today, and every builder storing real files will hit at least two of them.
