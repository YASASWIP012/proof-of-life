// Keys live in this browser only, wrapped with a passphrase. Nothing here is ever sent anywhere.
import { bytesToHex, compressPublicKey, hexToBytes, unwrapKey, wrapKey, type WrappedKey } from "@proof-of-life/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export type Role = "activist" | "custodian";

export type StoredKey = WrappedKey & {
  role: Role;
  createdMs: number;
  /** Uncompressed public key is never needed; custodians share the compressed one in their invite. */
  pubkey: Hex;
  vaults: { vaultId: Hex; creator: Hex; slot?: number }[];
};

const STORE = "pol.keys.v1";

export function loadKeys(): StoredKey[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]");
  } catch {
    return [];
  }
}

function saveKeys(keys: StoredKey[]) {
  localStorage.setItem(STORE, JSON.stringify(keys));
  window.dispatchEvent(new Event("pol-keys"));
}

export const unlocked = new Map<string, PrivateKeyAccount & { secret: Uint8Array }>();

export function newSecret() {
  const secret = secp256k1.utils.randomSecretKey();
  const account = privateKeyToAccount(bytesToHex(secret));
  return { secret, account, pubkey: bytesToHex(compressPublicKey(secp256k1.getPublicKey(secret, true))) };
}

export async function createKey(role: Role, passphrase: string, label: string): Promise<StoredKey> {
  const { secret, account, pubkey } = newSecret();
  const wrapped = await wrapKey(secret, passphrase, { label, address: account.address });
  const stored: StoredKey = { ...wrapped, role, createdMs: Date.now(), pubkey, vaults: [] };
  saveKeys([...loadKeys(), stored]);
  unlocked.set(account.address.toLowerCase(), Object.assign(account, { secret }));
  return stored;
}

export async function unlock(k: StoredKey, passphrase: string) {
  const secret = await unwrapKey(k, passphrase);
  const account = privateKeyToAccount(bytesToHex(secret));
  if (account.address.toLowerCase() !== k.address.toLowerCase()) throw new Error("this backup does not match its address");
  const a = Object.assign(account, { secret });
  unlocked.set(k.address.toLowerCase(), a);
  return a;
}

export const getUnlocked = (address: string) => unlocked.get(address.toLowerCase()) ?? null;

export function lockAll() {
  for (const a of unlocked.values()) a.secret.fill(0);
  unlocked.clear();
}

export function attachVault(address: string, ref: { vaultId: Hex; creator: Hex; slot?: number }) {
  const keys = loadKeys();
  const k = keys.find((x) => x.address.toLowerCase() === address.toLowerCase());
  if (!k) return;
  if (!k.vaults.some((v) => v.vaultId === ref.vaultId)) k.vaults.push(ref);
  saveKeys(keys);
}

export function forgetKey(address: string) {
  saveKeys(loadKeys().filter((k) => k.address.toLowerCase() !== address.toLowerCase()));
  unlocked.delete(address.toLowerCase());
}

/** The backup file is the wrapped key itself: useless without the passphrase. */
export function backupBlob(k: StoredKey): Blob {
  return new Blob([JSON.stringify(k, null, 2)], { type: "application/json" });
}

export function importBackup(json: string): StoredKey {
  const k = JSON.parse(json) as StoredKey;
  if (k.v !== 1 || k.kdf !== "scrypt" || !k.address || !k.data) throw new Error("not a Proof of Life key backup");
  const keys = loadKeys().filter((x) => x.address.toLowerCase() !== k.address.toLowerCase());
  saveKeys([...keys, { ...k, vaults: k.vaults ?? [] }]);
  return k;
}

/** A custodian invite: the per-vault public key and address, nothing else. */
export const inviteCode = (k: Pick<StoredKey, "address" | "pubkey">) => `pol-custodian:${k.address}:${k.pubkey}`;

export function parseInvite(code: string): { address: Hex; pubkey: Hex } {
  const m = code.trim().match(/^pol-custodian:(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]{66})$/);
  if (!m) throw new Error("that is not a Proof of Life custodian invite");
  const pub = hexToBytes(m[2]);
  const address = privateKeyAddressFromPub(pub);
  if (address.toLowerCase() !== m[1].toLowerCase()) throw new Error("invite address does not match its public key");
  return { address: m[1] as Hex, pubkey: m[2] as Hex };
}

import { publicKeyToAddress } from "viem/accounts";
function privateKeyAddressFromPub(compressed: Uint8Array): string {
  const uncompressed = secp256k1.Point.fromBytes(compressed).toBytes(false);
  return publicKeyToAddress(bytesToHex(uncompressed));
}
