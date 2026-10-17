// Shared by the two serverless functions. Neither ever sees a document, a key of a user, or a vault secret.
export const ARKIV_RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network";

export const keyedRpc = () => (process.env.ARKIV_ACCESS_KEY ? `${ARKIV_RPC}/${process.env.ARKIV_ACCESS_KEY}` : ARKIV_RPC);

export function cors(res: { setHeader(k: string, v: string): void }) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

/** A fixed-window counter per key. Per instance only, which is enough to stop casual draining of test gas. */
export function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.until < now) {
      hits.set(key, { n: 1, until: now + windowMs });
      return true;
    }
    if (h.n >= max) return false;
    h.n++;
    return true;
  };
}

export const clientIp = (req: { headers: Record<string, string | string[] | undefined> }) =>
  String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0].trim();
