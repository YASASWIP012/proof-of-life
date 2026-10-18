// A read relay for when Arkiv's keyless budget runs out. It forwards a short allowlist of methods with our
// access key, caches identical reads for a few seconds, and is never needed: the site reads Arkiv directly first.
import { cors, keyedRpc, clientIp, limiter } from "./_lib.js";

const ALLOWED = new Set([
  "arkiv_query", "arkiv_getEntity", "arkiv_getEntityCount", "arkiv_getBlockTiming",
  "eth_blockNumber", "eth_chainId", "eth_getBalance", "eth_getTransactionCount", "eth_getTransactionReceipt",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getBlockByNumber",
  "eth_call",
]);
// Read-only on purpose: no transaction is ever sent through our key. Writes go straight from the user's browser.
const CACHEABLE = new Set(["arkiv_query", "arkiv_getEntity", "eth_blockNumber", "eth_getBalance"]);
const cache = new Map<string, { at: number; body: string }>();
const perIp = limiter(600, 60 * 60 * 1000);

export default async function handler(req: any, res: any) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!perIp(clientIp(req))) return res.status(429).json({ error: "relay limit reached for this address" });
  const calls = Array.isArray(req.body) ? req.body : [req.body];
  const bad = calls.find((c: any) => !ALLOWED.has(c?.method));
  if (bad) return res.status(400).json({ jsonrpc: "2.0", id: bad?.id ?? null, error: { code: -32601, message: `method ${bad?.method} is not relayed` } });

  const key = JSON.stringify(calls.map((c: any) => [c.method, c.params]));
  const cacheable = calls.every((c: any) => CACHEABLE.has(c.method));
  const hit = cacheable ? cache.get(key) : undefined;
  if (hit && Date.now() - hit.at < 4000) {
    const ids = calls.map((c: any) => c.id);
    const parsed = JSON.parse(hit.body);
    const out = Array.isArray(parsed) ? parsed.map((p: any, i: number) => ({ ...p, id: ids[i] })) : { ...parsed, id: ids[0] };
    return res.status(200).json(out);
  }
  const upstream = await fetch(keyedRpc(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req.body) });
  const body = await upstream.text();
  if (cacheable && upstream.ok) {
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }
  res.setHeader("content-type", "application/json");
  return res.status(upstream.status).send(body);
}
