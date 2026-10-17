// Seeds the demo vaults judges see between 19 and 23 October. Run once:  npx tsx scripts/seed.ts
//   always-alive  checked in by the keeper workflow every few hours, so its heartbeat never stops
//   lapses-oct-21 nobody checks in; it stops at 12:00 IST on 21 October and the keeper's custodians release it
//   released      lapses during seeding, is released 2-of-3, and carries a forged piece and a forged heartbeat
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createWalletClient, http, parseEther, type Hex } from "viem";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk";
import {
  ackCustody, attrs, compressPublicKey, createVault, loadVault, publicClient, releaseMyShare, sealVault, walletClient,
} from "@proof-of-life/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "viem";
import { account, INDEX, rpc } from "./env.js";
import { DEMO_DOCS } from "./docs.js";

const reader = publicClient({ rpc });
const OUT = new URL("./demo-vaults.json", import.meta.url);
const registry: Record<string, { vaultId: Hex; creator: Hex; activist: number; custodians: number[]; checkIn: boolean }> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const publisher = createWalletClient({ chain: tiramisu, transport: http(rpc), account: account(INDEX.publisher) });

async function fund(addresses: Hex[], amount: string) {
  for (const to of addresses) {
    const hash = await publisher.sendTransaction({ to, value: parseEther(amount) });
    await reader.waitForTransactionReceipt({ hash });
  }
}

const pub = (secret: Uint8Array) => compressPublicKey(secp256k1.getPublicKey(secret, true));

async function seedVault(name: string, slot: number, doc: keyof typeof DEMO_DOCS, intervalS: number, graceS: number, checkIn: boolean) {
  if (registry[name]) return console.log(`${name}: already seeded`), registry[name];
  const activistIdx = INDEX.demoActivist + slot;
  const custodianIdx = [0, 1, 2].map((i) => INDEX.demoCustodian + slot * 10 + i);
  const activist = account(activistIdx);
  const custodians = custodianIdx.map(account);
  await fund([activist.address], "0.4");
  await fund(custodians.map((c) => c.address), "0.05");
  const d = DEMO_DOCS[doc];
  const sealed = sealVault({ title: d.title, note: d.note, files: d.files, k: 2, custodianPubKeys: custodians.map((c) => pub(c.secret)) });
  const res = await createVault(walletClient(activist, { rpc }), reader, {
    sealed, k: 2, intervalS, graceS, mode: "public", tag: name,
    custodians: custodians.map((c) => ({ address: c.address, pubkey: bytesToHex(pub(c.secret)) })),
  }, (p) => p.txHash && console.log(`  ${name} ${p.stage} ${p.done}/${p.total} ${p.txHash}`));
  for (const [i, c] of custodians.entries()) {
    const r = await ackCustody(walletClient(c, { rpc }), { vaultId: sealed.vaultId, slot: i + 1 });
    console.log(`  ${name} custodian ${i + 1} ack ${r.txHash}`);
  }
  registry[name] = { vaultId: sealed.vaultId, creator: activist.address, activist: activistIdx, custodians: custodianIdx, checkIn };
  writeFileSync(OUT, JSON.stringify(registry, null, 2) + "\n");
  console.log(`${name}: vault ${sealed.vaultId} heartbeat ${res.heartbeatKey}`);
  return registry[name];
}

// 1. Always alive.
await seedVault("always-alive", 1, "ration", 6 * 3600, 6 * 3600, true);

// 2. Stops at a fixed moment during judging.
const target = Date.parse("2026-10-21T06:30:00Z");
const grace = 12 * 3600;
const interval = Math.floor((target - Date.now()) / 1000) - grace;
if (interval > 3600) await seedVault("lapses-oct-21", 2, "hospital", interval, grace, false);

// 3. Released now, with forgeries alongside.
const rel = await seedVault("released", 3, "road", 60, 60, false);
let v = await loadVault(reader, rel.vaultId, rel.creator);
if (v.status.phase !== "released") {
  console.log("released: waiting for the heartbeat to stop…");
  while (v.status.phase === "alive" || v.status.phase === "overdue") {
    await new Promise((r) => setTimeout(r, 15_000));
    v = await loadVault(reader, rel.vaultId, rel.creator);
  }
  const forger = account(INDEX.demoForger);
  await fund([forger.address], "0.02");
  const fw = walletClient(forger, { rpc });
  const fakeRelease = await fw.createEntity({
    payload: jsonToPayload({ v: 1, slot: 2, share: "0x02" + "ab".repeat(32), sealed_to_newsroom: false, observed_lapse_block: "0" }),
    contentType: "application/json", attributes: attrs.release(rel.vaultId, 2), expires: ExpirationTime.fromDays(30),
  });
  const fakeBeat = await fw.createEntity({
    payload: new Uint8Array(), contentType: "application/octet-stream",
    attributes: attrs.heartbeat(rel.vaultId, 60, 60), expires: ExpirationTime.fromDays(30),
  });
  console.log(`  forged release ${fakeRelease.txHash}, forged heartbeat ${fakeBeat.txHash}`);
  for (const i of [0, 2]) {
    v = await loadVault(reader, rel.vaultId, rel.creator);
    const c = account(rel.custodians[i]);
    const r = await releaseMyShare(walletClient(c, { rpc }), reader, v, c.secret);
    console.log(`  custodian ${i + 1} released ${r.txHash}`);
  }
  v = await loadVault(reader, rel.vaultId, rel.creator);
}
console.log(`released: phase ${v.status.phase}, rejected ${v.rejected.length}`);
