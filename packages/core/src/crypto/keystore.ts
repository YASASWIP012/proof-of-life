// A secret key wrapped with a passphrase (scrypt + AES-256-GCM), safe to keep in the browser or a backup file.
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { open, seal } from "./aead.js";
import { fromBase64, fromUtf8, hexToBytes, randomBytes, toBase64, utf8 } from "./bytes.js";

export type WrappedKey = {
  v: 1;
  kdf: "scrypt";
  n: number;
  r: number;
  p: number;
  salt: string;
  data: string;
  /** Public label so a person with several keys can tell them apart. Never a name. */
  label: string;
  address: string;
};

const PARAMS = { N: 2 ** 15, r: 8, p: 1 };

async function kek(passphrase: string, salt: Uint8Array, N: number, r: number, p: number): Promise<Uint8Array> {
  return scryptAsync(utf8(passphrase.normalize("NFKC")), salt, { N, r, p, dkLen: 32 });
}

export async function wrapKey(secret: Uint8Array, passphrase: string, meta: { label: string; address: string }): Promise<WrappedKey> {
  if (passphrase.length < 8) throw new RangeError("passphrase must be at least 8 characters");
  const salt = randomBytes(16);
  const key = await kek(passphrase, salt, PARAMS.N, PARAMS.r, PARAMS.p);
  return {
    v: 1,
    kdf: "scrypt",
    n: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    salt: toBase64(salt),
    data: toBase64(seal(key, secret, utf8(meta.address))),
    ...meta,
  };
}

export async function unwrapKey(w: WrappedKey, passphrase: string): Promise<Uint8Array> {
  const key = await kek(passphrase, fromBase64(w.salt), w.n, w.r, w.p);
  return open(key, fromBase64(w.data), utf8(w.address));
}

/**
 * Version 2: everything about a key, including what it is for and which vaults it guards, sealed under the
 * passphrase. A stored blob shows nothing but random bytes, so a seized phone reveals no address, role or vault.
 */
export type SealedBlob = { v: 2; kdf: "scrypt"; n: number; r: number; p: number; salt: string; data: string };

const BLOB_AAD = utf8("proof-of-life/keystore/v2");

export async function sealBlob(payload: Uint8Array, passphrase: string): Promise<SealedBlob> {
  if (passphrase.length < 8) throw new RangeError("passphrase must be at least 8 characters");
  const salt = randomBytes(16);
  const key = await kek(passphrase, salt, PARAMS.N, PARAMS.r, PARAMS.p);
  return { v: 2, kdf: "scrypt", n: PARAMS.N, r: PARAMS.r, p: PARAMS.p, salt: toBase64(salt), data: toBase64(seal(key, payload, BLOB_AAD)) };
}

export async function openBlob(b: SealedBlob, passphrase: string): Promise<Uint8Array> {
  const key = await kek(passphrase, fromBase64(b.salt), b.n, b.r, b.p);
  return open(key, fromBase64(b.data), BLOB_AAD);
}

/** A key opened from a backup file: the secret, and the role the app gave it when one is recorded. */
/** `tok` is the check-in token the blob carries (activist keys): ok or duress, the blob itself never says which. */
export type BackupKey = { secret: Uint8Array; role?: string; tok?: Uint8Array };

/**
 * Opens a backup file with a passphrase, whatever app version wrote it: a v1 wrapped key, or a v2 file of sealed
 * blobs (the website's format). Returns every key the passphrase opens; decoy blobs simply fail to open.
 */
export async function openKeyBackup(json: string, passphrase: string): Promise<BackupKey[]> {
  const parsed = JSON.parse(json);
  if (parsed?.v === 1 && parsed.data && parsed.address) return [{ secret: await unwrapKey(parsed as WrappedKey, passphrase) }];
  const blobs: SealedBlob[] = parsed?.v === 2 && Array.isArray(parsed.blobs) ? parsed.blobs : Array.isArray(parsed) ? parsed : [];
  if (!blobs.length) throw new Error("not a Proof of Life key backup");
  const out: BackupKey[] = [];
  for (const b of blobs) {
    let plain: Uint8Array;
    try {
      plain = await openBlob(b, passphrase);
    } catch {
      continue;
    }
    const p = JSON.parse(fromUtf8(plain)) as { secret: string; role?: string; tok?: string };
    out.push({ secret: hexToBytes(p.secret), role: p.role, tok: p.tok ? hexToBytes(p.tok) : undefined });
  }
  if (!out.length) throw new Error("the passphrase opens no key in this backup");
  return out;
}
