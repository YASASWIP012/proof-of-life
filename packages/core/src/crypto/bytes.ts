import { bytesToHex as toHex, hexToBytes as fromHex, randomBytes as rnd } from "@noble/hashes/utils.js";

export type Hex = `0x${string}`;

/** Web Crypto fills at most 64 KiB per call, so larger buffers are filled in slices. */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let o = 0; o < n; o += 65536) out.set(rnd(Math.min(65536, n - o)), o);
  return out;
}

export function bytesToHex(b: Uint8Array): Hex {
  return `0x${toHex(b)}`;
}

export function hexToBytes(h: string): Uint8Array {
  return fromHex(h.startsWith("0x") ? h.slice(2) : h);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Constant-time comparison, so commitment checks do not leak where two values first differ. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
