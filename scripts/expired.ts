// Is an expired entity still readable at a past block? Repro for friction F7.
import { publicClient } from "@proof-of-life/core";
import { rpc } from "./env.js";

const c = publicClient({ rpc });
const KEY = (process.argv[2] ?? "0xe200010f7547d9757e76db92e910bfc31f81acb59e7499b9828112831b3daf8a") as `0x${string}`;
try {
  await c.getEntity(KEY);
  console.log("getEntity at head: still live");
} catch (e) {
  console.log(`getEntity at head: ${String((e as Error).name)} (${String((e as Error).message).split("\n")[0].slice(0, 80)})`);
}
const now = await c.query(`$key = key(${KEY})`, { select: { key: true, expiresAt: true }, limit: 1 });
console.log(`query at head ${now.blockNumber}: ${now.entities.length} row(s)`);
for (const at of [692_620n, 692_650n, 692_700n]) {
  const past = await c.query(`$key = key(${KEY})`, { select: { key: true, expiresAt: true, createdAt: true }, limit: 1, atBlock: at });
  console.log(`query atBlock ${at}: ${past.entities.length} row(s)${past.entities[0] ? `, expiresAt ${past.entities[0].expiresAt}` : ""}`);
}
