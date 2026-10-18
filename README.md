# Proof of Life · धड़कन

**If my heartbeat stops, the truth comes out.**

A dead-hand vault for India's RTI activists, whistleblowers and the journalists and lawyers who stand with them. Seal your documents and check in with one tap. If you stop, the people you chose can open them, and the record they open cannot be deleted by you, by us, or by whoever comes for you.

If you have filed an RTI application, the [RTI clock](https://proof-of-life-khaki.vercel.app/#/rti) works for you today: it gives your reply deadline and appeal dates under the RTI Act, drafts the First Appeal in English, Hindi or Telugu, and puts nothing sensitive on chain.

Built on [Arkiv](https://arkiv.network), the Web3 database, for **Arkiv: Global Tour Stop** (9 to 18 October 2026). Tracks: **Best Indian Use Case**, **Censorship Resistance**, **Privacy**, **Security**, **Open Source**.

| | |
|---|---|
| Live app | **https://proof-of-life-khaki.vercel.app** |
| Demo video (2:35) | **https://youtu.be/JUY5HGdk234** |
| Five-minute drill (no wallet needed) | https://proof-of-life-khaki.vercel.app/#/drill |
| A vault that was released, with a forged piece and a forged heartbeat beside it | [released](https://proof-of-life-khaki.vercel.app/#/v/0xff209ceea0104dab5d737fc1e7d5c740c717832d74af8e8970dafd1cb7077bca/0x126B45be97c649DcA7A44e3eB41e8dacf79436d8) |
| A vault kept alive by a check-in bot every few hours | [always-alive](https://proof-of-life-khaki.vercel.app/#/v/0x87935a7665533da43c4b562fa4a39951c6fe2a4d3a82a19b24c2aef7bca31dc9/0x8C8adBA31c57C51b4cBAdA5c503826378260e01e) |
| A vault whose heartbeat stops at **12:00 IST on 21 October**, during judging, and is then released by its custodians | [lapses-oct-21](https://proof-of-life-khaki.vercel.app/#/v/0x612ecb90f7fd74b4c11feeeeaeec9840841be40f5cab2a1d52235af64fd6270d/0x5D40aE116e255576B0D5F1FE706e3a236c59bDF1) |
| **Pilot-2: the team cannot release it.** Two custodians, two needed: an outside person, unnamed by choice, holding a key we never see, and one demo key. Without the outside custodian's piece the vault stays sealed | [pilot-2](https://proof-of-life-khaki.vercel.app/#/v/0xad33705f0d1b3aa36b45ae52d42b6b78f933544fe056bdfab6c19c4710d07082/0x7C4E28e08183601dB2090Eb3F805c813d89c4B25) |
| A pilot vault whose slot-1 custodian is an outside person, unnamed by choice, holding a key we never see. They confirmed custody from their own phone | [pilot](https://proof-of-life-khaki.vercel.app/#/v/0x54f8db01e47e3128e19b5ce5e746e8aabea9dc28cddbd8b5bb73431d9384a12f/0xa15eeDe179654Fe9807F39099392E084EDC9143f) |
| One-file reader: save it anywhere, open a released vault with no site, server or install | [`reader.html`](reader.html) (also at [/reader.html](https://proof-of-life-khaki.vercel.app/reader.html)) |
| Data contract | [`arkiv/schema.md`](arkiv/schema.md) |
| Friction report | [`arkiv/friction.md`](arkiv/friction.md) |

All documents in this build are synthetic and the network is a testnet. **Testnet versus real use:** this build proves the design end to end on Tiramisu. Real activists need a network that will still exist in a year; until Arkiv runs a mainnet, a vault's term is only as durable as the testnet it lives on. Nothing about the design changes on mainnet.

## The problem

Under the RTI Act, any citizen can ask a public office for its records. People who use it to expose fraud have been killed for it. CHRI's tracker lists at least 107 RTI users murdered since 2005 ([The Week, October 2025](https://www.theweek.in/magazine/theweek/cover/2025/10/04/rti-act-at-20-why-india-needs-better-whistleblower-protection-for-activists.html)). The Whistle Blowers Protection Act passed in 2014 and has still not been brought into force ([The Wire](https://thewire.in/government/govt-says-amendment-to-whistle-blowers-protection-act-not-in-agenda-of-current-parliament-session-report)).

When an activist dies, the evidence often dies too. A study of RTI killings in Maharashtra found that some families burned the documents out of fear, and that police files were incomplete years later ([Moneylife](https://moneylife.in/article/probing-rti-killings-in-maharashtra-a-tough-instructive-task/62848.html)). The Information Commission once ordered that whatever a murdered activist had requested be published immediately. That only works if someone still has the papers and dares to act.

Today an activist's protection is a folder on a laptop, a copy with a friend, or an email draft. Each one can be seized, deleted, or simply never opened.

## What changes for them

- **The evidence cannot be destroyed.** Files are encrypted in the activist's browser and written to Arkiv. Every encrypted piece is read-only and handed, in the same transaction, to an address nobody holds. Not the activist under duress, not us under a court order, not anyone can delete it.
- **Silencing the activist releases the evidence.** The activist checks in on a rhythm they choose (weekly, fortnightly, monthly). If they stop, the heartbeat disappears from Arkiv at its deadline, and their custodians publish their pieces of the key. Once enough are public, anyone's browser can open the documents. Killing the activist no longer buries the findings, which takes away one reason to kill, as long as `k` custodians stay free to act.
- **A forced check-in can still raise the alarm.** An activist can set a duress passphrase. Every check-in carries a small note encrypted to the custodians with a random token; only the custodians know which token means "duress". A forced check-in looks identical on screen, on the public vault page and on the chain (same calldata length, measured), and tells the custodians to release now. The phone never stores a duress flag, and every key has two same-size blobs whether or not a duress passphrase exists.
- **No single person can betray them.** The key is split among custodians (a journalist, a lawyer, a friend), and any `k` of them together can open the vault. Fewer learn nothing. One unreachable custodian does not block the release.
- **Editors can check before anything is published.** In newsroom mode the pieces are sealed to one newsroom's key, so its editors read the documents first and decide what to publish.
- **An RTI filer can use it today, with nothing sensitive on chain.** The RTI clock (`/#/rti`) takes the date the PIO received an application and shows the reply deadline (30 days, or 48 hours when it concerns life or liberty, plus 5 days through an Assistant PIO), when silence becomes a deemed refusal, and the First and second appeal windows, each with its section of the RTI Act, 2005. Once the deadline passes it drafts a First Appeal in English, Hindi or Telugu to copy or print. All of that runs in the browser and works for a real application now. Optionally, the browser hashes the application, mixes the hash with a random 32-byte salt that never leaves the device, and writes one sealed Arkiv entity holding only that salted value and the block the reply is due. Without the salt nobody can test a guessed document or name against the stored value, so the record reveals nothing about the application or the filer. The filer downloads a receipt with the salt; the receipt plus the application prove the record is theirs. The block it lands in shows the application existed by then. The entity stays readable through the appeal windows and expires 165 days after the reply deadline, when the second appeal window closes (s.19(1), s.19(6), s.19(3)). That record is on testnet, so the postal or online receipt is still the proof of filing.
- **It runs in a phone browser today.** No wallet to install, no crypto to buy, every screen in English, हिन्दी and తెలుగు. It runs on Arkiv's testnet, so for now it is a working rehearsal, not a home for real evidence: a real vault needs a network that will still exist in a year (see the testnet note below).

## How it works

```
 activist's browser                        Arkiv (Tiramisu)                          anyone
 ──────────────────                        ────────────────                          ──────
 files ─► AES-256-GCM ─► ciphertext ─────► chunk × n      readonly, owner 0x…dEaD
 data key ─► split k-of-n ─► one per custodian, encrypted to that custodian's key
                                   ──────► envelope × n   readonly, owner 0x…dEaD
                                   ──────► vault          manifest, hashes, commitments
                                   ──────► heartbeat      expires at interval + grace
 one tap each week ── extendEntity ──────► heartbeat      (only its owner can extend it)

                      no check-in ► heartbeat expires ► custodians publish
                                   ──────► release × k    accepted only from the right $creator
                                                             └─► any browser rebuilds the key
                                                                 and decrypts the chunks
```

## Who has to do what

Arkiv enforces three things: the deadline, the undeletable record, and who wrote each piece. The release itself needs `k` of the activist's custodians to publish their pieces. If enough custodians are silenced or refuse, the vault stays sealed, so an activist should pick people in different places and set `k` below the total. Custodians can run the [CLI watcher](cli/src/main.ts) (`watch --auto-release`) on their own machines, so a release does not wait on anyone opening a website. The demo vaults' custodians are bots run by one GitHub workflow, which is fine for a demo and not how a real vault should be set up. The [pilot vault](https://proof-of-life-khaki.vercel.app/#/v/0x54f8db01e47e3128e19b5ce5e746e8aabea9dc28cddbd8b5bb73431d9384a12f/0xa15eeDe179654Fe9807F39099392E084EDC9143f) is the first step past that: its slot-1 custodian is an outside person, unnamed by choice, who made their key on their own phone, sent only the invite code, and confirmed custody on Arkiv from that phone (`0x5a96eD4f…2460`). In [pilot-2](https://proof-of-life-khaki.vercel.app/#/v/0xad33705f0d1b3aa36b45ae52d42b6b78f933544fe056bdfab6c19c4710d07082/0x7C4E28e08183601dB2090Eb3F805c813d89c4B25) the team holds one piece of the two required, so it cannot release that vault on its own.

## Why it has to be Arkiv

The product falls apart without three Arkiv properties:

1. **Expiry the database enforces.** The heartbeat is an Arkiv entity whose lifetime is `interval + grace`. Only its owner can extend it. When nobody extends it, Arkiv drops it. A Postgres row with a `deadline` column needs a cron job and a server someone keeps running. That server is exactly what a powerful opponent can switch off, seize or lean on. Custodians do still run a watcher, but that is a different thing: many independent watchers on machines and accounts we never see, each holding one piece. None of them can move the deadline, fake a check-in or delete the evidence; the most an opponent gains by silencing one is a slower release. With Postgres, whoever runs the server can change the deadline, the data and the trust rules for everyone at once.
2. **Data nobody can delete, including its author.** Sealed entities are read-only and handed, in the creating batch, to an address nobody holds (`0x…dEaD` for listed vaults, a per-vault address for unlisted ones, so an owner query cannot list them). On IPFS, data survives only while someone pins it, and it carries no deadline. On our own API we would hold a delete button, which makes us a target for a gag order.
3. **Authorship nobody can forge.** A release counts only if its `$creator` is the custodian named for that slot, and a heartbeat only if it comes from the vault's creator. Anyone can write entities that claim to belong to a vault; the [released demo vault](https://proof-of-life-khaki.vercel.app/#/v/0xff209ceea0104dab5d737fc1e7d5c740c717832d74af8e8970dafd1cb7077bca/0x126B45be97c649DcA7A44e3eB41e8dacf79436d8) carries a forged piece and a forged heartbeat, both shown as ignored. A subgraph indexes someone else's contract; it gives no lifetimes, no per-entity ownership flags and no queryable store of its own.

**Deliberately kept off Arkiv:** plaintext, titles, file names and any label (inside the ciphertext; the manifest has no free text); every private key and passphrase (kept in the browser, wrapped with scrypt + AES-GCM); anything that names the activist or custodians (each custodian uses a fresh key per vault, with one exception disclosed in [`arkiv/schema.md`](arkiv/schema.md): our outside pilot custodian used one key for both pilot vaults; **each vault is sealed by a fresh activist key**, so nobody can list "all vaults by this person", and vaults are **unlisted by default**: only `vault_id` and hashed kind values are public, so no query lists them, while released evidence becomes findable from the chain; a scan of every entity still finds vault-shaped entities, as the threat model below says); contact details; and gas funding (a small serverless tap that never sees a key or a document).

## How each Arkiv feature is used

| Feature | Where | What the user sees |
|---|---|---|
| Entity Expiration per type | heartbeat: interval + grace · ack: 14 days · sealed data: vault term | the countdown on every vault page; a vault that goes **Alive → Overdue → Heartbeat stopped** with no server involved |
| Lifetime Extension as a lease | one-tap check-in ([`writes.ts`](packages/core/src/arkiv/writes.ts) `checkIn`); custodian leases (`ackCustody`) | "Check-in due in 6d 4h"; "Holding the key · renews in 13d" |
| Creation flags | `readonly` on everything; `permissionlessExtension` on sealed data, **not** on the heartbeat | "Keep this vault alive for another year" works for anyone; nobody but the activist can keep the heartbeat alive |
| `$creator` / `$owner` + ownership transfer | sealing to `0x…dEaD` in the creating batch; trust rules in [`reads.ts`](packages/core/src/arkiv/reads.ts) `assembleVault` | "Sealed: read-only and owned by an address nobody holds"; an **Ignored entities** list for forgeries |
| Atomic batch writes | each chunk is created and sealed in one batch; manifest + envelopes + heartbeat in one batch; each check-in extends the heartbeat and writes its `beat` note together | the vault appears whole, with its clock started, in one block; a duress check-in is indistinguishable from a normal one |
| Typed attributes vs payload | `u64` lifetimes and timestamps, `i32` slots, `bytes32` vault ids, `addr` custodians; ciphertext and manifests in payloads | one query loads a whole vault |
| Queries: compound, `NOT`, ranges, `createdBy`, cursor pinned with `atBlock` | `vault_id = … AND NOT (type = 'chunk')`; chunks with `createdBy(creator)`; ranges `$expiresAt <= u64(…)` and `interval_s >= u64(…)` ([`reads.ts`](packages/core/src/arkiv/reads.ts) `listVaults`) | a vault page costs one read, so it stays inside the keyless budget; the directory's "Stops within 3 days" filter runs on the node |
| WebSocket entity events | `watchEntityEvents` on `wss://`, no `fromBlock` ([`events.ts`](packages/core/src/arkiv/events.ts)) | check-ins and releases appear live; the lapse is caught by a timer set from the heartbeat's own expiry block, because Arkiv fires no expiry event |

## Threat model, briefly

| If… | then… |
|---|---|
| the activist is forced to delete the vault | refused: it belongs to `0x…dEaD` (tested in `scripts/e2e.ts`) |
| the activist is forced to delete the heartbeat | the release only starts sooner |
| someone else tries to keep the heartbeat alive | refused: it is not permissionless (tested) |
| a stranger publishes a "piece" | ignored: wrong `$creator` (see the released demo vault) |
| a custodian publishes a wrong piece | ignored: it fails the slot's public commitment |
| a custodian publishes early | the app and CLI refuse; if done anyway, the vault page shows a red **early release** warning, and fewer than `k` pieces still reveal nothing |
| one custodian is unreachable | `k`-of-`n`: the others are enough |
| someone forces the activist to check in | the duress passphrase makes a check-in that is identical on chain; only the custodians can read that it means "release now" |
| someone queries Arkiv for every vault | unlisted vaults have no project tag, no plain kinds and no numbers to range over, so no query lists them. An unlisted vault is hidden from queries, not invisible: someone who scans every entity on the chain, follows the event stream, or walks the gas tap's transfers can still find entities that carry a `vault_id` and read their manifest, which is plaintext (`k`, `n`, rhythm and the custodians' one-time addresses). That scan never yields the documents, their titles, or who the activist or custodians are, because every key is fresh for each vault. Released evidence is deliberately findable |
| someone takes the activist's phone | they find opaque encrypted blobs: no address, role, label or vault list without the passphrase (vaults are found on Arkiv by key, never stored on the phone) |
| our website disappears | the one-file [`reader.html`](reader.html), the CLI, the curl recipe and any other reader built from [`schema.md`](arkiv/schema.md) still work |
| someone watches the chain | they see random ids, ciphertext and check-in times, not names, titles or links between vaults. Check-in timing remains visible; the app says so before sealing |

## Released evidence, readable by anyone

A vault may stay unlisted while its heartbeat beats, but every released piece carries the project tag and its vault's creator. This one call lists every released vault, with no website involved:

```bash
curl -s https://rpc.tiramisu.db-chain.testnet.arkiv.network -H 'content-type: application/json' --data-binary @- <<'Q'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["project = str('proof-of-life') AND type = str('release')",{"select":{"key":true,"creator":true,"attributes":true},"limit":"0xc8"}]}
Q
```

Each row's `vault_id` and `vault_creator` open the vault (`/#/v/<vault_id>/<vault_creator>`); `$creator` must be the custodian named for that slot in the manifest, which every reader checks. The CLI does the same with `proof-of-life released`.

**The vault that stops during judging:** `lapses-oct-21` was sealed on 17 October in transactions [`0x21035f1e…`](https://tiramisu.explorer.arkiv.network/tx/0x21035f1ef9885badcb44f6cd9691b307e43f600d8dab8af0271dca7bea7c6af9) (ciphertext) and [`0xcac01637…`](https://tiramisu.explorer.arkiv.network/tx/0xcac016376c837a7408ee421a3fa05cea971ed1fa7bd872356bb08d9568982366) (manifest, envelopes and heartbeat). Its heartbeat stops at 12:00 IST on 21 October; the keeper's custodians then release it, and the release transactions appear on its page and in the call above.

## Why Security: forged data never counts

A forged release could open a vault early; a forged heartbeat could keep a dead activist looking alive. Every reader here (the site, the CLI, [`reader.html`](reader.html) and [`examples/list-released.mjs`](examples/list-released.mjs)) decides trust from the on-chain `$creator`, never from a field anyone can write. A piece counts only if its creator is the custodian named for that slot in the sealed manifest and its share matches the commitment sealed with the vault; a heartbeat counts only if the vault's creator wrote it, and it has permissionless extension off, so nobody else can keep it going. The [released demo vault](https://proof-of-life-khaki.vercel.app/#/v/0xff209ceea0104dab5d737fc1e7d5c740c717832d74af8e8970dafd1cb7077bca/0x126B45be97c649DcA7A44e3eB41e8dacf79436d8) carries a forged piece and a forged heartbeat written by a stranger; its page lists both as ignored, with the reason, and the directory counts only valid pieces.

## Why Open Source: build on it without asking

The code is MIT and the data contract is public in two forms: [`arkiv/schema.md`](arkiv/schema.md) in prose and [`arkiv/contract.schema.json`](arkiv/contract.schema.json) as JSON Schema, generated from the schemas the app validates with (a test fails if they drift). [`examples/list-released.mjs`](examples/list-released.mjs) is about 40 lines using only the Arkiv SDK: it lists released evidence and applies the same `$creator` and commitment checks, so a newsroom or legal-aid group can run its own reader or watcher with nothing of ours. The CLI, the one-file reader and the [custodian watcher workflow](examples/custodian-watcher.yml) read the same public entities.

## Run your own custodian watcher

A custodian does not need our website or our servers. On any machine with Node 20+:

```bash
npx github:YASASWIP012/proof-of-life watch <vault_id> <creator> --key-file my-custodian-backup.json --auto-release
```

It follows check-ins over a WebSocket, says when the activist is overdue, recognises a duress check-in, and publishes this custodian's piece the moment the heartbeat stops. `POL_PASSPHRASE` can hold the passphrase for unattended use.

`--key-file` takes the backup the website gives a custodian, exactly as downloaded. The command renews the custodian's 14-day lease when fewer than four days are left.

A custodian without a machine that stays on can run the same check every hour from their own GitHub account: copy [`examples/custodian-watcher.yml`](examples/custodian-watcher.yml) into a private repository and add the four secrets it lists. Each custodian runs their own, on an account we never see. Our [demo keeper](.github/workflows/keeper.yml) only plays the bot custodians of the demo vaults; it holds no key of a real custodian, and no real vault depends on it. A failed run is the alarm: GitHub emails the custodian when the activist is overdue, under duress, or the vault has lapsed.

## Reproduce it in three minutes

1. Open the **[drill](https://proof-of-life-khaki.vercel.app/#/drill)** and press **Start**. Your tab creates an activist and three custodians, seals a synthetic RTI reply, and shows every transaction. Check in once, then let it lapse. Custodian 2 plays unreachable and a forger posts a fake piece. Two real custodians release, and the public page decrypts.
2. From any terminal, with no site involved:

   ```bash
   npx github:YASASWIP012/proof-of-life status 0xff209ceea0104dab5d737fc1e7d5c740c717832d74af8e8970dafd1cb7077bca 0x126B45be97c649DcA7A44e3eB41e8dacf79436d8
   npx github:YASASWIP012/proof-of-life open 0xff209ceea0104dab5d737fc1e7d5c740c717832d74af8e8970dafd1cb7077bca 0x126B45be97c649DcA7A44e3eB41e8dacf79436d8
   ```

   `status` exits with 0 alive, 1 overdue, 2 lapsed, 3 releasing, 4 released. `open` rebuilds the key from the public pieces, decrypts, checks every file hash, and writes the files to disk.
3. The exact query behind any vault page is in its **Check this without us** panel, ready for curl.

Full lifecycle as a script (funds four wallets, seals, checks in, waits for the lapse, releases 2-of-3, decrypts from chain):

```bash
npx tsx scripts/e2e.ts 7
```

## Run it

```bash
npm install
npm test                    # crypto, trust rules and the vault state machine
npm run dev                 # web app on http://localhost:5173
npm run build -w cli        # single-file CLI in cli/dist/
```

Scripts need `POL_MNEMONIC` in `.env` (`npx tsx scripts/gen-wallets.ts` creates one) and test GLM from the [faucet](https://hub.arkiv.network/faucet). `ARKIV_ACCESS_KEY` is optional.

## Layout

```
packages/core   crypto (Shamir over GF(256), AES-GCM, ECIES on secp256k1, scrypt keystore) and the Arkiv layer
web             React app: drill, seal, check in, custodians, vault pages, directory, verify
cli             proof-of-life status | watch | ack | release | open
api             gas tap and a read relay (fallback only), as Vercel functions
scripts         seeding, the demo keeper, the end-to-end test and the friction probes
arkiv           schema.md and friction.md
```

## On-chain evidence

| Address | Role |
|---|---|
| `0x7C7e8C4e1463d2Bb3a459209fC846D361504847B` | publisher: funds demo actors |
| `0x0EB8778DDEBAF8d6dD95148698Fc99885Afc2b69` | gas tap for visitors' fresh keys |
| `0x8C8adBA31c57C51b4cBAdA5c503826378260e01e` | demo activist, always-alive vault |
| `0x5D40aE116e255576B0D5F1FE706e3a236c59bDF1` | demo activist, lapses-oct-21 vault |
| `0x126B45be97c649DcA7A44e3eB41e8dacf79436d8` | demo activist, released vault |
| `0x90E400c9569e01Ec94798C4BFec8452731095A45` | end-to-end test activist (run 3) |
| `0xa15eeDe179654Fe9807F39099392E084EDC9143f` | pilot vault activist |
| `0x5a96eD4fD61a72aE06Ba3468c1eE6C0aB33D2460` | pilot and pilot-2 custodian, slot 1: an outside person's own key |
| `0x7C4E28e08183601dB2090Eb3F805c813d89c4B25` | pilot-2 activist |

Demo custodians are listed by derivation index in [`scripts/demo-vaults.json`](scripts/demo-vaults.json), and the [keeper workflow](.github/workflows/keeper.yml) acts for them every 30 minutes. Every other creator is a visitor's fresh key.

## What this is for, and what it is not

For lawfully obtained records: RTI replies, public records and your own evidence. Not for classified material, other people's personal data, or anything you could not lawfully hold. For real use, choose newsroom release so editors check documents before anything is published.

## Team

Yasaswi Paruchuri (Indian national), KL University. Solo build.

## Built during the challenge

All code, data and design were made between 9 and 18 October 2026. No pre-existing work; the baseline is the first commit of this repository. Libraries: React, Vite, Tailwind, viem, `@noble/*`, zod, `@arkiv-network/sdk` 0.8.1.

MIT licensed.
