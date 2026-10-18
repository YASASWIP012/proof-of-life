// Live test of the covert duress signal: a normal and a duress check-in look the same on chain,
// the public phase stays "alive", and only a custodian can read the flag and release early.
import { createWalletClient, http, parseEther, type Hex } from "viem";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "viem";
import {
  ackCustody, beatPayload, checkIn, newBeatTokens, compressPublicKey, createVault, duressSignal, loadVault, publicClient, releaseMyShare, sealVault, utf8, walletClient,
} from "@proof-of-life/core";
import { account, INDEX, rpc } from "./env.js";

const reader = publicClient({ rpc });
const base = 970_000 + (Date.now() % 1000) * 10;
const activist = account(base);
const cs = [1, 2, 3].map((i) => account(base + i));
const pub = (s: Uint8Array) => compressPublicKey(secp256k1.getPublicKey(s, true));
const publisher = createWalletClient({ chain: tiramisu, transport: http(rpc), account: account(INDEX.publisher) });
for (const to of [activist.address, ...cs.map((c) => c.address)]) await reader.waitForTransactionReceipt({ hash: await publisher.sendTransaction({ to, value: parseEther("0.03") }) });

const pubs = cs.map((c) => bytesToHex(pub(c.secret)) as Hex);
const tokens = newBeatTokens();
const sealed = sealVault({ title: "duress test", note: "synthetic", k: 2, custodianPubKeys: cs.map((c) => pub(c.secret)), files: [{ name: "a.txt", type: "text/plain", bytes: utf8("synthetic") }], beatTokens: tokens });
const res = await createVault(walletClient(activist, { rpc }), reader, { sealed, k: 2, intervalS: 3600, graceS: 3600, mode: "public", listed: true, vaultDays: 30, custodians: cs.map((c, i) => ({ address: c.address, pubkey: pubs[i] })) });
const w = walletClient(activist, { rpc });
const beat = (duress: boolean) => ({ vaultId: sealed.vaultId, payload: beatPayload(sealed.vaultId, pubs, duress ? tokens.duress : tokens.ok), listed: true });

const normal = await checkIn(w, { heartbeatKey: res.heartbeatKey, intervalS: 3600, graceS: 3600, beat: beat(false) });
let v = await loadVault(reader, sealed.vaultId, activist.address);
console.log(`normal check-in ${normal.txHash}: phase ${v.status.phase}, custodian 2 reads ${duressSignal(v, 2, cs[1].secret)}`);
try {
  await releaseMyShare(walletClient(cs[0], { rpc }), reader, v, cs[0].secret);
  console.log("BAD: release allowed after a normal check-in");
} catch (e) {
  console.log(`release after normal check-in refused: ${(e as Error).message}`);
}

const forced = await checkIn(w, { heartbeatKey: res.heartbeatKey, intervalS: 3600, graceS: 3600, beat: beat(true) });
v = await loadVault(reader, sealed.vaultId, activist.address);
const [rn, rf] = await Promise.all([normal.txHash, forced.txHash].map((h) => reader.getTransaction({ hash: h })));
console.log(`duress check-in ${forced.txHash}: phase ${v.status.phase}, custodian 2 reads ${duressSignal(v, 2, cs[1].secret)}`);
console.log(`calldata length normal ${rn.input.length}, duress ${rf.input.length}; same target ${rn.to === rf.to}`);

for (const i of [0, 2]) {
  v = await loadVault(reader, sealed.vaultId, activist.address);
  const r = await releaseMyShare(walletClient(cs[i], { rpc }), reader, v, cs[i].secret);
  console.log(`custodian ${i + 1} released on the duress signal ${r.txHash}`);
}
v = await loadVault(reader, sealed.vaultId, activist.address);
console.log(`after release: phase ${v.status.phase}, early-release flag ${v.status.earlyRelease}, valid pieces ${v.releases.filter((r) => r.valid).length}`);
console.log(`vault ${sealed.vaultId} creator ${activist.address}`);
