// Re-checks the friction report against the live network with no wallet, no key and no .env: `npm run friction`.
// Each line prints what the docs led us to expect, what the network does today, and whether the finding still holds.
// F2, F3 and F7 need a funded wallet; they reproduce with `npx tsx scripts/probe.ts unfunded|lifetime|ws`.
import { publicClient } from "@proof-of-life/core";

const RPC = process.env.ARKIV_RPC ?? "https://rpc.tiramisu.db-chain.testnet.arkiv.network";
const c = publicClient({ rpc: RPC });
let held = 0;
const report = (id: string, expected: string, actual: string, holds: boolean) => {
  if (holds) held++;
  console.log(`${id}  ${holds ? "STILL HOLDS" : "FIXED?    "}\n    expected: ${expected}\n    actual:   ${actual}\n`);
};

// F1: the RPC refuses request bodies over 262,144 bytes, which caps payloads well below the documented 128 KiB.
const body = (n: number) => {
  const b = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[],"pad":""}';
  return b.slice(0, -2) + "x".repeat(n - b.length) + '"}';
};
const post = async (n: number) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: body(n) });
  return `${r.status} ${(await r.text()).slice(0, 70)}`;
};
const [at, over] = [await post(262_144), await post(262_200)];
report("F1", "a 128 KiB payload (about 262 KB of hex in JSON) is accepted", `262,144 B -> ${at}; 262,200 B -> ${over}`, over.startsWith("413"));

// F5: attribute names and values are global, so a generic `type` mixes projects.
const page = await c.query(`type = str('report')`, { select: { key: true, attributes: true }, limit: 200 });
const projects = new Set(page.entities.map((e) => String((e.attributes as Record<string, { value: unknown }> | undefined)?.project?.value ?? "(none)")));
report("F5", "type = str('report') returns one project's reports", `${page.entities.length} entities from ${projects.size} distinct project tags at block ${page.blockNumber}`, projects.size > 1);

// F6: an expired entity is gone at the head but still readable with atBlock.
const KEY = "0xe200010f7547d9757e76db92e910bfc31f81acb59e7499b9828112831b3daf8a"; // released demo vault's heartbeat, expired at block 692660
const now = await c.query(`$key = key(${KEY})`, { select: { key: true }, limit: 1 });
const past = await c.query(`$key = key(${KEY})`, { select: { key: true, expiresAt: true }, limit: 1, atBlock: 692_650n });
report("F6", "after expiry the entity is gone, and old blocks are rejected", `at head ${now.blockNumber}: ${now.entities.length} row(s); atBlock 692650: ${past.entities.length} row(s)`, now.entities.length === 0 && past.entities.length === 1);

console.log(`${held} of 3 keyless findings still hold on ${RPC} (sdk 0.8.1, ${new Date().toISOString()}).`);
