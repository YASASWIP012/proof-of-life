# Friction report: building Proof of Life on Arkiv

Everything here was observed while building this project between 17 and 18 October 2026. Setup for every entry unless it says otherwise:

- `@arkiv-network/sdk` **0.8.1**, `viem` **2.57.7**, Node **24.19.0**, macOS 15.5
- Tiramisu testnet, chain `7738577`, `https://rpc.tiramisu.db-chain.testnet.arkiv.network` (with an access key in the path unless noted)
- Repro scripts live in [`scripts/`](../scripts). They need `POL_MNEMONIC` in `.env` (see `scripts/gen-wallets.ts`) and a funded publisher wallet.

Problems come first, then the paths we tested that worked, documented the same way. Measured costs are at the end.

---

## Problems

### F1. A payload at the documented 128 KiB limit can never be written

- **Surface:** TypeScript SDK `createEntity`, node transaction limits, docs ("A payload is up to 128 KiB").
- **Expected:** a payload up to 131,072 bytes is accepted, since the SDK validates against exactly that number and the docs give it as the cap.
- **Actual:** 96 KiB and 120 KiB succeed. 127 KiB and 128 KiB fail with `EntityMutationError: Transaction failed: Execution error without revert data`. 129 KiB is rejected locally with a clear message (`132096 bytes exceeds the 131072-byte payload limit`). So the SDK's own check passes payloads the network will always refuse, and the refusal does not mention size.
- **Repro:** `npx tsx scripts/probe.ts sizes`. Our run:

  ```
  single 96 KiB: ok
  single 120 KiB: ok
  single 127 KiB: FAIL Transaction failed: Execution error without revert data
  single 128 KiB: FAIL Transaction failed: Execution error without revert data
  single 129 KiB: FAIL Invalid bytes value "<132096 bytes>": 132096 bytes exceeds the 131072-byte payload limit…
  ```

- **Why it matters:** the first design split ciphertext at the documented cap. It failed on the first real upload.
- **Likely cause and fix:** the encoded transaction (payload as hex inside ABI-encoded call data, plus attributes) crosses a transaction size limit, probably the common 128 KB txpool cap, well before the payload does. Fixes, in order of value: (1) the SDK checks the **encoded transaction size** before sending and throws `PayloadTooLargeForTransaction { encodedBytes, limit }`; (2) the docs state the usable payload ceiling (about 120 KiB with a few attributes) next to the 128 KiB figure; (3) the node returns `oversized data` instead of an empty revert.
- **What we did:** chunks are 96 KiB, one per transaction ([`vault.ts`](../packages/core/src/crypto/vault.ts) `CHUNK_BYTES`, [`writes.ts`](../packages/core/src/arkiv/writes.ts) `chunksPerTx`).

### F2. The same limit applies to a whole batch, so large atomic batches are impossible

- **Surface:** `executeBatch`.
- **Expected:** a batch of creates whose payloads are each under 128 KiB goes through. Nothing in the docs says a batch has a total size limit.
- **Actual:** `2 × 48 KiB` works; `2 × 64 KiB`, `3 × 48 KiB`, `2 × 80 KiB` and `2 × 96 KiB` all fail with the same `Execution error without revert data`. Deep in the cause chain of the 2 × 96 KiB case, viem shows an `HttpRequestError` with `Details: "BAD_REQUEST"` from `eth_estimateGas`. The top-level message never says the request was too big.
- **Repro:** `npx tsx scripts/probe.ts sizes` (batch lines), or `CHUNKS_PER_TX=2 npx tsx scripts/e2e.ts` for the real-world case.
- **Why it matters:** we wanted the whole vault (ciphertext, manifest, envelopes, heartbeat) to appear in one atomic batch. With this limit the ciphertext has to go first, one chunk per transaction. Each chunk is still created and sealed atomically, and the manifest batch is what makes the vault exist, so readers never see half a vault. But "one vault, one transaction" is impossible above ~120 KiB.
- **Fix:** document a per-transaction size budget for `executeBatch`; have the SDK split or refuse with the measured size.

### F3. "Execution error without revert data" covers too many different failures

- **Surface:** `EntityMutationError` message.
- **Expected:** a reason a builder can act on.
- **Actual:** we saw the same top-level text for an oversized transaction (F1, F2) and, in other teams' reports, for an unfunded wallet. In contrast, ownership errors are excellent (see W5).
- **Fix:** map the HTTP 400 from `eth_estimateGas` to a size error, and an `insufficient funds` estimate failure to `InsufficientGLM { address, balance }`.

### F4. The faucet needs a browser wallet and a human, so a project's own server wallets cannot be funded directly

- **Surface:** Hub faucet (`hub.arkiv.network/faucet`).
- **Expected:** paste an address, pass a human check, receive GLM.
- **Actual:** the faucet needs a connected browser wallet and Sign-In with Ethereum before it shows the form. It does have a **"Use a different address"** link once you are signed in, which is what a project needs; we found it only after sending GLM by hand. One claim per wallet per hour, 10 GLM.
- **What we did:** one human claim to a MetaMask wallet, one transfer to a project treasury, and everything else derived from one mnemonic ([`scripts/env.ts`](../scripts/env.ts), [`scripts/fund.ts`](../scripts/fund.ts)). 10 GLM covered the whole build: every probe, the end-to-end runs, the demo seeding and a gas tap for judges.
- **Fix:** put "Use a different address" on the first screen, and document the 10 GLM per hour per wallet numbers on the Tiramisu page.

### F5. MetaMask showed 0 GLM while the node reported 10 GLM for the same address

- **Surface:** MetaMask with a manually added Tiramisu network.
- **Expected:** MetaMask shows the balance the node reports.
- **Actual:** right after a faucet claim, MetaMask's Send screen showed `0 GLM available` for `0x3617…2c9c`, while `eth_getBalance` on the public RPC returned `10.0`. We checked the network entry field by field (name, RPC URL, chain ID `7738577`, symbol `GLM`, explorer) and it matched the docs. Adding the access key to the RPC URL in MetaMask, and re-selecting the network, made the balance appear.
- **We could not prove the cause.** The most likely explanation is that MetaMask's polling hit the keyless read budget (see F6) and showed 0 instead of an error. We are reporting what we saw, not a confirmed diagnosis.
- **Fix to consider:** a short "Add Tiramisu to MetaMask" note recommending an access-key RPC URL for wallets.

### F6. A public site cannot carry an access key, but the keyless budget is small

- **Surface:** public RPC rate limit, Access Keys docs.
- **Expected (from the docs):** keys belong on a server; browsers use the public endpoint.
- **Actual:** the docs are right, and that forces every censorship-resistant app into a choice: read directly (and risk the budget running out mid-demo) or run a relay (and add the server the app was meant to avoid). Our page loads cost **1 query** for a vault page and **3** for the directory, because we designed for this.
- **What we did:** direct reads by default; on a rate-limit style failure the app retries once through a small allowlisted relay with our key ([`api/rpc.ts`](../api/rpc.ts)), and the footer says which path is in use. The CLI and the curl recipes never need us.
- **Fix to consider:** a per-origin browser quota, or an origin-locked "publishable" key designed to be public.

### F7. No event when an entity expires

- **Surface:** `watchEntityEvents`, Live Events docs (documented: "An entity that reaches its expiration date fires no event").
- **Expected (for this product):** the heartbeat lapsing is the single most important moment, so we wanted an event.
- **Actual:** as documented, nothing fires. In our WebSocket probe, an entity created with a 20-second life and later extended produced `created` and `extended` events and nothing at expiry.
- **What we did:** the page and the CLI set a timer from the heartbeat's own `$expiresAt` block, then confirm with one query ([`events.ts`](../packages/core/src/arkiv/events.ts)).
- **Fix to consider:** a synthetic `EntityExpired` event, or `arkiv_expiringBetween(from, to)` so a watcher can catch up after downtime.

---

## Paths we tested that worked

### W1. Sealing in the same transaction with `predictEntityKeys` + `ownershipChanges`

- **Expected:** create readonly entities and hand them to `0x…dEaD` atomically, so they are undeletable from their first block.
- **Actual:** works. Each chunk batch and the manifest batch predict their keys, create with the predicted salts, and transfer in the same `executeBatch`. The result's `createdEntities` matched the prediction every time.
- **Checked:** in `scripts/e2e.ts`, the activist then tries `deleteEntity` on its own sealed manifest. Refused: `entity 0xc04a44fc…db80d4 is owned by 0x000000000000000000000000000000000000dEaD, not 0x90E400c9…`.
- **Note:** a prediction is valid only within one transaction, because keys derive from the account nonce. We first planned to predict the vault key before uploading chunks in earlier transactions. The JSDoc on `predictEntityKeys` warned us in time, so we link children with a random `vault_id` attribute and trust `$creator` instead.

### W2. Non-permissionless extension really is owner-only

- **Expected:** a custodian cannot keep an activist's heartbeat alive.
- **Actual:** `extendEntity` on the heartbeat from a custodian wallet is refused with an ownership error. Repro: `scripts/e2e.ts`, field `strangerExtendHeartbeat` in the report.

### W3. `extendEntity` sets, not adds

- **Expected (from the docs):** a check-in of `fromSeconds(interval + grace)` counts from now.
- **Actual:** confirmed. In run 3 a check-in moved the heartbeat from block 692371 to 692379, which is now plus 30 blocks, not the old expiry plus 30. This is exactly what a dead man's switch needs.

### W4. WebSocket events over `wss://` with the key in the path

- **Expected:** `watchEntityEvents` on a `webSocket` transport with no `fromBlock` pushes events.
- **Actual:** `npx tsx scripts/probe.ts ws` printed `["created 692428","extended 692430","created 692433","deleted 692435"]` within 81 seconds: every operation, in order.

### W5. Ownership errors name both addresses

- Wrong-owner writes fail with `entity 0x… is owned by 0x…, not 0x…`, which made the trust tests easy to write. Every Arkiv error should read like this.

### W6. `NOT (type = str('chunk'))` lets one query load everything but the ciphertext

- One query per vault page: `project = … AND vault_id = bytes32(V) AND NOT (type = str('chunk'))`. Works as documented; it is the main reason the app stays inside the keyless budget.

### W7. Full lifecycle, end to end

`npx tsx scripts/e2e.ts <run>` funds four fresh wallets, seals a 3-chunk vault, confirms custody, checks in, waits for the lapse, releases 2-of-3, and decrypts from the chain alone. Run 3 finished in 134 seconds with `{"phase":"released","verified":true,"bigMatches":true}`. Report: `scripts/e2e-report-3.json`.

---

## Measured costs (Tiramisu, 17 October 2026)

| Operation | Gas | GLM |
|---|---|---|
| One 96 KiB ciphertext chunk, 30-day life, sealed | 3,967,360 | 0.00397 |
| Manifest + 3 envelopes + heartbeat, sealed | 680,792 | 0.00068 |
| Custodian acknowledgement | 105,384 | 0.00011 |
| Check-in (extend heartbeat) | 25,180 | 0.000025 |
| Release (create + seal) | 127,720 | 0.00013 |

A weekly check-in for a year costs about 0.0013 GLM. Storage dominates, and it scales with lifetime, which suits a product where the activist chooses how long the evidence must survive.

## The one thing Arkiv should improve first

Make transaction-size failures say so (F1 to F3). It cost us more time than everything else combined, and every builder storing real files will hit it.
