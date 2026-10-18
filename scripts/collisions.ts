// How many other projects share a generic `type` value on Tiramisu. Repro for friction F5.
import { publicClient } from "@proof-of-life/core";
import { rpc } from "./env.js";

const c = publicClient({ rpc });
for (const t of ["vault", "heartbeat", "release", "report", "record"]) {
  const page = await c.query(`type = str('${t}')`, { select: { key: true, creator: true, attributes: true }, limit: 200 });
  const byProject = new Map<string, number>();
  for (const e of page.entities) {
    const p = String((e.attributes as Record<string, { value: unknown }> | undefined)?.project?.value ?? "(none)");
    byProject.set(p, (byProject.get(p) ?? 0) + 1);
  }
  console.log(`type = str('${t}'): ${page.entities.length} entities at block ${page.blockNumber}; projects: ${[...byProject].map(([p, n]) => `${p} ${n}`).join(", ")}`);
}
