// End-to-end test against Tiramisu: seal → ack → check in → lapse → release 2-of-3 → open from chain only.
// Also measures what the friction report needs: batch size limits and gas per operation.
import { writeFileSync } from "node:fs";
import { createWalletClient, formatEther, http, parseEther, type Hex } from "viem";
import { tiramisu } from "@arkiv-network/sdk/chains";
import {
  ackCustody, checkIn, compressPublicKey, extendableKeys, createVault, loadCiphertext, loadVault, publicClient, randomBytes, releaseMyShare,
  sealVault, unsealVault, utf8, walletClient,
} from "@proof-of-life/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "viem";
import { account, INDEX, rpc } from "./env.js";

const reader = publicClient({ rpc });
const run = Number(process.argv[2] ?? Date.now() % 1000);
const base = 900_000 + run * 10;
const activist = account(base);
const cs = [1, 2, 3].map((i) => account(base + i));
const publisher = createWalletClient({ chain: tiramisu, transport: http(rpc), account: account(INDEX.publisher) });
const report: Record<string, unknown> = { run, sdk: "0.8.1", started: new Date().toISOString() };
const gasUsed = async (hash: Hex) => {
  const r = await reader.waitForTransactionReceipt({ hash });
  return { gas: r.gasUsed.toString(), glm: formatEther(r.gasUsed * r.effectiveGasPrice) };
};
const t0 = Date.now();
const step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

for (const to of [activist.address, ...cs.map((c) => c.address)]) {
  const hash = await publisher.sendTransaction({ to, value: parseEther(to === activist.address ? "0.3" : "0.02") });
  await reader.waitForTransactionReceipt({ hash });
}
step("funded actors");

const pub = (s: Uint8Array) => compressPublicKey(secp256k1.getPublicKey(s, true));
const big = randomBytes(150_000); // forces two ciphertext chunks
const sealed = sealVault({
  title: "e2e", note: "synthetic", k: 2, custodianPubKeys: cs.map((c) => pub(c.secret)),
  files: [{ name: "a.txt", type: "text/plain", bytes: utf8("synthetic e2e") }, { name: "noise.bin", type: "application/octet-stream", bytes: big }],
});
step(`sealed locally: ${sealed.chunks.length} chunks`);

const chunksPerTx = Number(process.env.CHUNKS_PER_TX ?? 2);
const txs: Hex[] = [];
const res = await createVault(walletClient(activist, { rpc }), reader, {
  sealed, k: 2, intervalS: 40, graceS: 20, mode: "public", listed: process.env.LISTED !== "0", keepAliveByAnyone: process.env.KEEP !== "0", vaultDays: 30, chunksPerTx,
  custodians: cs.map((c) => ({ address: c.address, pubkey: bytesToHex(pub(c.secret)) })),
}, (p) => {
  if (p.txHash) txs.push(p.txHash);
  step(`createVault ${p.stage} ${p.done}/${p.total} ${p.txHash}`);
});
report.createTxs = await Promise.all(txs.map(async (h) => ({ h, ...(await gasUsed(h)) })));

let v = await loadVault(reader, sealed.vaultId, activist.address);
step(`loaded: phase ${v.status.phase}, sealed ${v.sealed}, envelopes sealed ${v.envelopes.filter((e) => e.sealed).length}/3`);
report.afterCreate = { phase: v.status.phase, sealed: v.sealed };

const acks = await Promise.all(cs.map((c, i) => ackCustody(walletClient(c, { rpc }), { vaultId: sealed.vaultId, slot: i + 1, listed: process.env.LISTED !== "0" })));
report.ackGas = await gasUsed(acks[0].txHash);
step("3 acks");

// Releasing while alive must be refused by the library.
try {
  v = await loadVault(reader, sealed.vaultId, activist.address);
  await releaseMyShare(walletClient(cs[0], { rpc }), reader, v, cs[0].secret);
  report.earlyReleaseRefused = false;
} catch (e) {
  report.earlyReleaseRefused = (e as Error).message;
}

// The activist cannot delete sealed data.
try {
  if (process.env.KEEP === "0") throw new Error("skipped: with keep-alive off the activist owns its data by design");
  await walletClient(activist, { rpc }).deleteEntity({ entityKey: v.key });
  report.activistDeleteSealed = process.env.KEEP === "0" ? "deleted (expected: keep-alive off leaves ownership with the activist)" : "DELETED (bad)";
} catch (e) {
  report.activistDeleteSealed = `refused: ${(e as Error).message.split("\n")[0]}`;
}
// A stranger cannot extend the heartbeat (not permissionless).
try {
  await walletClient(cs[0], { rpc }).extendEntity({ entityKey: res.heartbeatKey, expires: (await import("@arkiv-network/sdk")).ExpirationTime.fromDays(5) });
  report.strangerExtendHeartbeat = "EXTENDED (bad)";
} catch (e) {
  report.strangerExtendHeartbeat = `refused: ${(e as Error).message.split("\n")[0]}`;
}
step("negative checks done");

const before = v.heartbeat!.expiresAt;
// Carry forward everything the activist may extend. With KEEP=0 this is the case that used to revert the batch.
const carry = await extendableKeys(reader, v, "activist");
report.carryForward = carry.length;
const ci = await checkIn(walletClient(activist, { rpc }), { heartbeatKey: res.heartbeatKey, intervalS: 40, graceS: 20, sealed: carry, head: v.head, vaultDays: 31 });
report.checkInGas = await gasUsed(ci.txHash);
v = await loadVault(reader, sealed.vaultId, activist.address);
report.checkInMovedExpiry = `${before} -> ${v.heartbeat?.expiresAt}`;
step(`checked in: ${report.checkInMovedExpiry}`);

while (v.status.phase === "alive" || v.status.phase === "overdue") {
  await new Promise((r) => setTimeout(r, 5000));
  v = await loadVault(reader, sealed.vaultId, activist.address);
}
step(`heartbeat gone: phase ${v.status.phase} at head ${v.head}`);

for (const i of [0, 2]) {
  v = await loadVault(reader, sealed.vaultId, activist.address);
  const r = await releaseMyShare(walletClient(cs[i], { rpc }), reader, v, cs[i].secret);
  if (i === 0) report.releaseGas = await gasUsed(r.txHash);
  step(`custodian ${i + 1} released ${r.txHash}`);
}
v = await loadVault(reader, sealed.vaultId, activist.address);
const { ciphertext } = await loadCiphertext(reader, v);
const out = unsealVault(v.vaultId, ciphertext, v.releases.filter((r) => r.valid).map((r) => r.share!));
report.final = { phase: v.status.phase, verified: out.verified, files: out.files.map((f) => f.name), bigMatches: out.files[1].bytes.every((b, i) => b === big[i]) };
step(`opened from chain: ${JSON.stringify(report.final)}`);
report.vault = { vaultId: sealed.vaultId, creator: activist.address };
report.seconds = (Date.now() - t0) / 1000;
writeFileSync(new URL(`./e2e-report-${run}.json`, import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
