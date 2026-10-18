// Seals the pilot vault: one custodian is a real, independent person (unnamed, by choice) holding a key we never see.
// The other two slots are demo keys. k = 2, so the outside custodian's piece is needed for any release that skips a bot.
//   npx tsx scripts/pilot.ts <pol-custodian invite code>
import { readFileSync, writeFileSync } from "node:fs";
import { createWalletClient, http, parseEther, getAddress, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "viem";
import { ackCustody, compressPublicKey, createVault, publicClient, sealVault, utf8, walletClient } from "@proof-of-life/core";
import { account, INDEX, rpc } from "./env.js";
import { DEMO_DOCS } from "./docs.js";

const invite = process.argv[2] ?? "";
const m = invite.match(/^pol-custodian:(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]{66})$/);
if (!m) throw new Error("pass a pol-custodian invite code");
const outside = { address: getAddress(m[1]) as Hex, pubkey: m[2] as Hex };
const derived = publicKeyToAddress(bytesToHex(secp256k1.Point.fromBytes(hexToBytes(outside.pubkey)).toBytes(false)));
if (derived.toLowerCase() !== outside.address.toLowerCase()) throw new Error("invite address does not match its public key");

const reader = publicClient({ rpc });
const REG = new URL("./demo-vaults.json", import.meta.url);
const registry = JSON.parse(readFileSync(REG, "utf8"));
if (registry.pilot) throw new Error("pilot already sealed");
const activistIdx = INDEX.demoActivist + 4;
const botIdx = [INDEX.demoCustodian + 41, INDEX.demoCustodian + 42];
const activist = account(activistIdx);
const bots = botIdx.map(account);
const publisher = createWalletClient({ chain: tiramisu, transport: http(rpc), account: account(INDEX.publisher) });
for (const [to, glm] of [[activist.address, "0.1"], [outside.address, "0.02"], ...bots.map((b) => [b.address, "0.02"])] as [Hex, string][]) {
  await reader.waitForTransactionReceipt({ hash: await publisher.sendTransaction({ to, value: parseEther(glm) }) });
}
const pub = (s: Uint8Array) => bytesToHex(compressPublicKey(secp256k1.getPublicKey(s, true))) as Hex;
const custodians = [outside, ...bots.map((b) => ({ address: b.address, pubkey: pub(b.secret) }))];
const d = DEMO_DOCS.road;
const sealed = sealVault({ title: `${d.title} (pilot)`, note: d.note, files: d.files, k: 2, custodianPubKeys: custodians.map((c) => hexToBytes(c.pubkey)) });
const res = await createVault(walletClient(activist, { rpc }), reader, { sealed, k: 2, custodians, intervalS: 7 * 86400, graceS: 3 * 86400, mode: "public", listed: true }, (p) => p.txHash && console.log(`  ${p.stage} ${p.txHash}`));
for (const [i, b] of bots.entries()) console.log(`  bot custodian ${i + 2} ack ${(await ackCustody(walletClient(b, { rpc }), { vaultId: sealed.vaultId, slot: i + 2, listed: true })).txHash}`);
registry.pilot = { vaultId: sealed.vaultId, creator: activist.address, activist: activistIdx, custodians: [null, ...botIdx], checkIn: true };
writeFileSync(REG, JSON.stringify(registry, null, 2) + "\n");
console.log(`pilot vault ${sealed.vaultId} creator ${activist.address} heartbeat ${res.heartbeatKey}`);
