// How far back can atBlock read? The docs say only that "the node keeps a limited history". Repro for friction F6.
import { publicClient } from "@proof-of-life/core";
import { rpc } from "./env.js";

const c = publicClient({ rpc });
const head = await c.getBlockNumber();
let okBack = 0n;
for (const back of [100n, 1_000n, 10_000n, 50_000n, 100_000n, 200_000n, 400_000n, 700_000n]) {
  if (back > head) break;
  try {
    const r = await c.query("project = str('proof-of-life')", { select: { key: true }, limit: 1, atBlock: head - back });
    okBack = back;
    console.log(`atBlock head-${back} (${head - back}): ok, ${r.entities.length} row(s)`);
  } catch (e) {
    console.log(`atBlock head-${back} (${head - back}): ${String((e as Error).message).split("\n")[0].slice(0, 140)}`);
  }
}
console.log(`head ${head}; deepest readable offset tried: ${okBack} blocks (~${(Number(okBack) * 2 / 3600).toFixed(1)} h)`);
