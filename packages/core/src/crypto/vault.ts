// Seals a set of documents into a Proof of Life vault: one data key, k-of-n shares, one envelope per custodian.
import { sha256 } from "@noble/hashes/sha2.js";
import { open, seal } from "./aead.js";
import { bytesToHex, concat, equalBytes, fromBase64, fromUtf8, hexToBytes, randomBytes, toBase64, utf8, type Hex } from "./bytes.js";
import { decryptWith, encryptTo } from "./ecies.js";
import { combine, split } from "./shamir.js";
import type { BeatTokens } from "./duress.js";

/** Largest ciphertext slice per Arkiv entity. The payload cap is 128 KiB; the rest is headroom. */
export const CHUNK_BYTES = 96 * 1024;
/** Upper bound on one vault, so a single upload cannot cost an activist a fortune in gas. */
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

export type VaultFile = { name: string; type: string; bytes: Uint8Array };

export type Bundle = {
  v: 1;
  title: string;
  note: string;
  sealedAtMs: number;
  files: { name: string; type: string; size: number; sha256: Hex; data: string }[];
};

export type SealedVault = {
  vaultId: Hex;
  dataKey: Uint8Array;
  chunks: Uint8Array[];
  chunkHashes: Hex[];
  ciphertextHash: Hex;
  shares: Uint8Array[];
  commitments: Hex[];
  envelopes: Uint8Array[];
};

const SHARE_DOMAIN = utf8("proof-of-life/share/v1");
const ENVELOPE_DOMAIN = utf8("proof-of-life/envelope/v1");

export const sha256Hex = (b: Uint8Array): Hex => bytesToHex(sha256(b));

export function shareCommitment(vaultId: Hex, share: Uint8Array): Hex {
  return sha256Hex(concat(SHARE_DOMAIN, hexToBytes(vaultId), share));
}

export function envelopeAad(vaultId: Hex, slot: number): Uint8Array {
  return concat(ENVELOPE_DOMAIN, hexToBytes(vaultId), new Uint8Array([slot]));
}

export function sealVault(input: {
  title: string;
  note: string;
  files: VaultFile[];
  k: number;
  custodianPubKeys: Uint8Array[];
  now?: number;
  /** The activist key's ok/duress tokens, delivered to each custodian inside its envelope. */
  beatTokens?: BeatTokens;
}): SealedVault {
  const vaultId = bytesToHex(randomBytes(32));
  const bundle: Bundle = {
    v: 1,
    title: input.title,
    note: input.note,
    sealedAtMs: input.now ?? Date.now(),
    files: input.files.map((f) => ({ name: f.name, type: f.type, size: f.bytes.length, sha256: sha256Hex(f.bytes), data: toBase64(f.bytes) })),
  };
  const plain = utf8(JSON.stringify(bundle));
  if (plain.length > MAX_BUNDLE_BYTES) throw new RangeError(`vault is ${plain.length} bytes; the limit is ${MAX_BUNDLE_BYTES}`);

  const dataKey = randomBytes(32);
  const ciphertext = seal(dataKey, plain, hexToBytes(vaultId));
  const chunks: Uint8Array[] = [];
  for (let o = 0; o < ciphertext.length; o += CHUNK_BYTES) chunks.push(ciphertext.slice(o, o + CHUNK_BYTES));

  const n = input.custodianPubKeys.length;
  const shares = split(dataKey, input.k, n);
  return {
    vaultId,
    dataKey,
    chunks,
    chunkHashes: chunks.map(sha256Hex),
    ciphertextHash: sha256Hex(ciphertext),
    shares,
    commitments: shares.map((s) => shareCommitment(vaultId, s)),
    // Envelope plaintext: the share, then the ok and duress tokens when the activist key has them.
    envelopes: shares.map((s, i) => encryptTo(input.custodianPubKeys[i], input.beatTokens ? concat(s, input.beatTokens.ok, input.beatTokens.duress) : s, envelopeAad(vaultId, s[0]))),
  };
}

/** A custodian opens its envelope and checks the share against the public commitment before trusting it. */
export function openEnvelope(vaultId: Hex, slot: number, envelope: Uint8Array, custodianSecret: Uint8Array, commitment: Hex): Uint8Array {
  return openEnvelopeFull(vaultId, slot, envelope, custodianSecret, commitment).share;
}

/** Opens an envelope and also returns the activist's ok/duress tokens, when the envelope carries them. */
export function openEnvelopeFull(vaultId: Hex, slot: number, envelope: Uint8Array, custodianSecret: Uint8Array, commitment: Hex): { share: Uint8Array; tokens: BeatTokens | null } {
  const plain = decryptWith(custodianSecret, envelope, envelopeAad(vaultId, slot));
  const share = plain.length === 33 + 32 ? plain.slice(0, 33) : plain;
  const tokens = plain.length === 33 + 32 ? { ok: plain.slice(33, 49), duress: plain.slice(49, 65) } : null;
  if (share[0] !== slot || !equalBytes(hexToBytes(shareCommitment(vaultId, share)), hexToBytes(commitment))) {
    throw new Error(`share in slot ${slot} does not match its public commitment`);
  }
  return { share, tokens };
}

export type ShareCheck = { share: Uint8Array; ok: boolean; reason?: string };

/** Accepts a published share only if it matches the commitment for its slot. */
export function checkShare(vaultId: Hex, share: Uint8Array, commitments: Hex[]): ShareCheck {
  const slot = share[0];
  const expected = commitments[slot - 1];
  if (!expected) return { share, ok: false, reason: `no commitment for slot ${slot}` };
  const ok = equalBytes(hexToBytes(shareCommitment(vaultId, share)), hexToBytes(expected));
  return ok ? { share, ok } : { share, ok, reason: "share does not match its commitment" };
}

export function reassemble(chunks: Uint8Array[], chunkHashes: Hex[], ciphertextHash: Hex): Uint8Array {
  if (chunks.length !== chunkHashes.length) throw new Error(`have ${chunks.length} of ${chunkHashes.length} chunks`);
  chunks.forEach((c, i) => {
    if (sha256Hex(c) !== chunkHashes[i]) throw new Error(`chunk ${i} does not match its hash`);
  });
  const ciphertext = concat(...chunks);
  if (sha256Hex(ciphertext) !== ciphertextHash) throw new Error("reassembled ciphertext does not match the manifest");
  return ciphertext;
}

export function unsealVault(vaultId: Hex, ciphertext: Uint8Array, shares: Uint8Array[]): { bundle: Bundle; files: VaultFile[]; verified: boolean } {
  const dataKey = combine(shares);
  const bundle = JSON.parse(fromUtf8(open(dataKey, ciphertext, hexToBytes(vaultId)))) as Bundle;
  dataKey.fill(0);
  const files = bundle.files.map((f) => ({ name: f.name, type: f.type, bytes: fromBase64(f.data) }));
  const verified = files.every((f, i) => sha256Hex(f.bytes) === bundle.files[i].sha256);
  return { bundle, files, verified };
}
