// Shared by the two serverless functions. Neither ever sees a document, a key of a user, or a vault secret.
import { sha256 } from "@noble/hashes/sha2.js";

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

/**
 * The tap's spam guard is work, not identity: the browser finds a nonce whose hash with the address and the
 * current hour starts with POW_BITS zero bits (a second or two on a phone). The tap never reads the caller's IP.
 */
export const POW_BITS = 18;
export const powChallenge = (address: string, hour: number) => `pol-tap|${address.toLowerCase()}|${hour}`;
export function powValid(address: string, nonce: unknown, now = Date.now()): boolean {
  if (typeof nonce !== "number" || !Number.isSafeInteger(nonce) || nonce < 0) return false;
  const hour = Math.floor(now / 3_600_000);
  return [hour, hour - 1].some((h) => leadingZeroBits(sha256(new TextEncoder().encode(`${powChallenge(address, h)}|${nonce}`))) >= POW_BITS);
}
export function leadingZeroBits(d: Uint8Array): number {
  let n = 0;
  for (const b of d) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

/** Used by the read relay only, which carries public queries and no keys. */
export const clientIp = (req: { headers: Record<string, string | string[] | undefined> }) =>
  String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0].trim();
