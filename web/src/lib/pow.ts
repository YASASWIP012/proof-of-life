import { sha256 } from "@noble/hashes/sha2.js";
import type { Hex } from "viem";

// Mirrors api/_lib.ts: the tap asks for a little work instead of an IP address.
const POW_BITS = 18;
const zeroBits = (d: Uint8Array) => {
  let n = 0;
  for (const b of d) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
};

/** Finds the tap's proof of work in slices, so the page stays responsive while it runs (about a second or two). */
export async function solveTapWork(address: Hex): Promise<number> {
  const prefix = `pol-tap|${address.toLowerCase()}|${Math.floor(Date.now() / 3_600_000)}|`;
  const enc = new TextEncoder();
  for (let nonce = 0; ; ) {
    for (const end = nonce + 20_000; nonce < end; nonce++) if (zeroBits(sha256(enc.encode(prefix + nonce))) >= POW_BITS) return nonce;
    await new Promise((r) => setTimeout(r, 0));
  }
}
