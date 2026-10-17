// Read clients. Direct-to-Arkiv is the default, so the site works with no server of ours.
// When the keyless budget runs out, reads retry once through the relay, and the banner says so.
import { publicClient, socketClient, type PublicClient, type SocketClient } from "@dhadkan/core";
import { RELAY_RPC } from "./config";

export type ReadMode = "direct" | "relay";

const direct = publicClient();
const relay = publicClient({ rpc: RELAY_RPC });
let socket: SocketClient | null = null;

const listeners = new Set<(m: ReadMode, note?: string) => void>();
let mode: ReadMode = "direct";
let pinned: ReadMode | null = null;

try {
  const saved = localStorage.getItem("dhadkan.read");
  if (saved === "direct" || saved === "relay") pinned = mode = saved;
} catch {}

export function onReadMode(fn: (m: ReadMode, note?: string) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const readMode = () => mode;

export function pinReadMode(m: ReadMode | null) {
  pinned = m;
  mode = m ?? "direct";
  try {
    m ? localStorage.setItem("dhadkan.read", m) : localStorage.removeItem("dhadkan.read");
  } catch {}
  listeners.forEach((l) => l(mode));
}

const looksLikeBudget = (e: unknown) => /429|budget|ANON_COST|rate|limit|Unexpected token|not valid JSON|fetch failed|timed out|took too long/i.test(String((e as Error)?.message ?? e));

/** Runs a read against Arkiv, falling back to the relay once if the direct path is rate limited. */
export async function read<T>(fn: (c: PublicClient) => Promise<T>): Promise<T> {
  const first = mode === "relay" ? relay : direct;
  try {
    return await fn(first);
  } catch (e) {
    if (pinned || !looksLikeBudget(e)) throw e;
    const other: ReadMode = mode === "relay" ? "direct" : "relay";
    mode = other;
    listeners.forEach((l) => l(other, `Switched to ${other} reads: ${String((e as Error).message ?? e).slice(0, 80)}`));
    return fn(other === "relay" ? relay : direct);
  }
}

export const readClient = () => (mode === "relay" ? relay : direct);

export function sockets(): SocketClient {
  socket ??= socketClient();
  return socket;
}
