// The only server-side write helper: a small gas tap so people can act without buying anything.
// It sends test GLM and never sees a key, a document or a vault.
import type { Hex } from "viem";
import { TAP_URL } from "./config";
import { read } from "./net";

export async function balanceOf(address: Hex): Promise<bigint> {
  return read((c) => c.getBalance({ address }));
}

export async function ensureGas(address: Hex, min = 2_000_000_000_000_000n): Promise<bigint> {
  const have = await balanceOf(address);
  if (have >= min) return have;
  const res = await fetch(TAP_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `gas tap answered ${res.status}`);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const now = await balanceOf(address);
    if (now >= min) return now;
  }
  throw new Error("gas did not arrive in 30 s; try again");
}
