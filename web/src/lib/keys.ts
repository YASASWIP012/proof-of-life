// Keys live in this browser only, each one sealed under its passphrase. What is stored is a list of opaque
// blobs: no address, no role, no label and no vault list until the right passphrase opens one. A phone that is
// taken shows only that some encrypted blobs exist.
//
// Vaults are never stored here. One key seals one vault, so the app finds a key's vaults on Arkiv itself
// (vaults created by the key, or envelopes addressed to it).
import { bytesToHex, compressPublicKey, fromUtf8, hexToBytes, newBeatTokens, openBlob, randomBytes, sealBlob, toBase64, utf8, type BeatTokens, type SealedBlob } from "@proof-of-life/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { Hex } from "viem";
import { privateKeyToAccount, publicKeyToAddress, type PrivateKeyAccount } from "viem/accounts";

export type Role = "activist" | "custodian";

/**
 * What a blob holds once opened. There is no duress flag: `tok` is the token this blob checks in with, random
 * bytes either way. Only the blob opened by the real passphrase also holds `tokens`, which go to the custodians
 * at sealing so they can tell an ok check-in from a forced one. `pad` keeps every blob the same size.
 */
type Payload = { secret: Hex; role: Role; label: string; createdMs: number; tok?: Hex; tokens?: { ok: Hex; duress: Hex }; pad?: string };

export type OpenKey = {
  account: PrivateKeyAccount & { secret: Uint8Array };
  role: Role;
  label: string;
  createdMs: number;
  pubkey: Hex;
  /** The token this session checks in with. The app never knows whether it means ok or duress. */
  tok: Uint8Array | null;
  /** Present only when opened with the real passphrase: the pair handed to custodians at sealing. */
  tokens: BeatTokens | null;
};

const STORE = "pol.blobs.v2";

export function loadBlobs(): SealedBlob[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]");
  } catch {
    return [];
  }
}

function saveBlobs(blobs: SealedBlob[]) {
  localStorage.setItem(STORE, JSON.stringify(blobs));
  window.dispatchEvent(new Event("pol-keys"));
}

const opened = new Map<string, OpenKey>();

function toOpenKey(p: Payload): OpenKey {
  const secret = hexToBytes(p.secret);
  const account = Object.assign(privateKeyToAccount(p.secret), { secret });
  return {
    account, role: p.role, label: p.label, createdMs: p.createdMs,
    pubkey: bytesToHex(compressPublicKey(secp256k1.getPublicKey(secret, true))),
    tok: p.tok ? hexToBytes(p.tok) : null,
    tokens: p.tokens ? { ok: hexToBytes(p.tokens.ok), duress: hexToBytes(p.tokens.duress) } : null,
  };
}

export function newSecret() {
  const secret = secp256k1.utils.randomSecretKey();
  const account = privateKeyToAccount(bytesToHex(secret));
  return { secret, account, pubkey: bytesToHex(compressPublicKey(secp256k1.getPublicKey(secret, true))) };
}

const PAD_TO = 480;
const padded = (p: Payload) => {
  const json = JSON.stringify(p);
  return utf8(JSON.stringify({ ...p, pad: toBase64(randomBytes(Math.max(0, Math.ceil((PAD_TO - json.length) * 0.75)))) }));
};

/**
 * Makes a key and seals it as two blobs of the same size. With a duress passphrase the second blob holds the same
 * key and the duress token; without one, the second blob is a decoy sealed under a random passphrase nobody knows.
 * Either way a phone shows two indistinguishable blobs per key, so it never reveals whether a duress passphrase exists.
 */
export async function createKey(role: Role, passphrase: string, label: string, duressPassphrase?: string): Promise<{ key: OpenKey; blobs: SealedBlob[] }> {
  if (duressPassphrase && duressPassphrase === passphrase) throw new Error("the duress passphrase must differ from your passphrase");
  const { secret } = newSecret();
  const t = newBeatTokens();
  const tokens = { ok: bytesToHex(t.ok), duress: bytesToHex(t.duress) };
  const base: Payload = { secret: bytesToHex(secret), role, label, createdMs: Date.now() };
  const real: Payload = role === "activist" ? { ...base, tok: tokens.ok, tokens } : base;
  const blobs = [await sealBlob(padded(real), passphrase)];
  if (role === "activist") {
    const second: Payload = duressPassphrase ? { ...base, tok: tokens.duress } : { ...base, secret: bytesToHex(randomBytes(32)), tok: bytesToHex(randomBytes(16)) };
    blobs.push(await sealBlob(padded(second), duressPassphrase ?? bytesToHex(randomBytes(24))));
    if (Math.random() < 0.5) blobs.reverse();
  }
  saveBlobs([...loadBlobs(), ...blobs]);
  const key = toOpenKey(real);
  opened.set(key.account.address.toLowerCase(), key);
  return { key, blobs };
}

/** Tries the passphrase on every blob in this browser and returns the keys it opens. */
export async function unlockAll(passphrase: string): Promise<OpenKey[]> {
  const out: OpenKey[] = [];
  for (const b of loadBlobs()) {
    try {
      const p = JSON.parse(fromUtf8(await openBlob(b, passphrase))) as Payload;
      const k = toOpenKey(p);
      opened.set(k.account.address.toLowerCase(), k);
      out.push(k);
    } catch {}
  }
  return out;
}

export const openedKeys = (role?: Role) => [...opened.values()].filter((k) => !role || k.role === role);
export const getOpened = (address: string) => opened.get(address.toLowerCase()) ?? null;

export function lockAll() {
  for (const k of opened.values()) k.account.secret.fill(0);
  opened.clear();
}

/** A backup is the sealed blobs themselves: useless without the passphrase, and silent about what they hold. */
export function backupFile(blobs: SealedBlob[]): Blob {
  return new Blob([JSON.stringify({ v: 2, blobs }, null, 2)], { type: "application/json" });
}

export function importBackup(json: string): number {
  const parsed = JSON.parse(json);
  const blobs: SealedBlob[] = parsed?.v === 2 && Array.isArray(parsed.blobs) ? parsed.blobs : [];
  if (!blobs.length || blobs.some((b) => b.v !== 2 || !b.data || !b.salt)) throw new Error("not a Proof of Life key backup");
  const have = new Set(loadBlobs().map((b) => b.data));
  const fresh = blobs.filter((b) => !have.has(b.data));
  saveBlobs([...loadBlobs(), ...fresh]);
  return fresh.length;
}

/** A custodian invite: the per-vault public key and address, nothing else. */
export const inviteCode = (k: Pick<OpenKey, "pubkey"> & { account: { address: string } }) => `pol-custodian:${k.account.address}:${k.pubkey}`;

export function parseInvite(code: string): { address: Hex; pubkey: Hex } {
  const m = code.trim().match(/^pol-custodian:(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]{66})$/);
  if (!m) throw new Error("that is not a Proof of Life custodian invite");
  const uncompressed = secp256k1.Point.fromBytes(hexToBytes(m[2])).toBytes(false);
  if (publicKeyToAddress(bytesToHex(uncompressed)).toLowerCase() !== m[1].toLowerCase()) throw new Error("invite address does not match its public key");
  return { address: m[1] as Hex, pubkey: m[2] as Hex };
}
