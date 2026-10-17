// Keys live in this browser only, each one sealed under its passphrase. What is stored is a list of opaque
// blobs: no address, no role, no label and no vault list until the right passphrase opens one. A phone that is
// taken shows only that some encrypted blobs exist.
//
// Vaults are never stored here. One key seals one vault, so the app finds a key's vaults on Arkiv itself
// (vaults created by the key, or envelopes addressed to it).
import { bytesToHex, compressPublicKey, fromUtf8, hexToBytes, openBlob, sealBlob, utf8, type SealedBlob } from "@proof-of-life/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { Hex } from "viem";
import { privateKeyToAccount, publicKeyToAddress, type PrivateKeyAccount } from "viem/accounts";

export type Role = "activist" | "custodian";

type Payload = { secret: Hex; role: Role; label: string; createdMs: number; duress: boolean };

export type OpenKey = {
  account: PrivateKeyAccount & { secret: Uint8Array };
  role: Role;
  label: string;
  createdMs: number;
  pubkey: Hex;
  /** Opened with the duress passphrase: a "check-in" stops the heartbeat instead of extending it. */
  duress: boolean;
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
  return { account, role: p.role, label: p.label, createdMs: p.createdMs, duress: p.duress, pubkey: bytesToHex(compressPublicKey(secp256k1.getPublicKey(secret, true))) };
}

export function newSecret() {
  const secret = secp256k1.utils.randomSecretKey();
  const account = privateKeyToAccount(bytesToHex(secret));
  return { secret, account, pubkey: bytesToHex(compressPublicKey(secp256k1.getPublicKey(secret, true))) };
}

/**
 * Makes a key and seals it. With a duress passphrase, a second blob holds the same key marked as duress, so the
 * two are indistinguishable at rest. Returns the new blobs for an immediate backup download.
 */
export async function createKey(role: Role, passphrase: string, label: string, duressPassphrase?: string): Promise<{ key: OpenKey; blobs: SealedBlob[] }> {
  if (duressPassphrase && duressPassphrase === passphrase) throw new Error("the duress passphrase must differ from your passphrase");
  const { secret } = newSecret();
  const base: Payload = { secret: bytesToHex(secret), role, label, createdMs: Date.now(), duress: false };
  const blobs = [await sealBlob(utf8(JSON.stringify(base)), passphrase)];
  if (duressPassphrase) blobs.push(await sealBlob(utf8(JSON.stringify({ ...base, duress: true })), duressPassphrase));
  // Shuffle so the order does not tell which blob is the duress twin.
  if (blobs.length === 2 && Math.random() < 0.5) blobs.reverse();
  saveBlobs([...loadBlobs(), ...blobs]);
  const key = toOpenKey(base);
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
