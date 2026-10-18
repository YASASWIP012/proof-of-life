// The Proof of Life data contract on Arkiv. Every name, type and lifetime here is mirrored in /arkiv/schema.md.
import { bytes32, i32, str, u64, addr } from "@arkiv-network/sdk/attr";
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concat, hexToBytes, utf8 } from "../crypto/bytes.js";
import type { AttributeInputs } from "@arkiv-network/sdk";
import type { Hex } from "../crypto/bytes.js";

export const PROJECT = "proof-of-life";
export const SCHEMA_VERSION = 1;
/** Sealed entities are handed to this address. Nobody holds its key, so nobody can delete them. */
export const SEAL_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;
export const BLOCK_SECONDS = 2;

export const KINDS = ["vault", "chunk", "envelope", "heartbeat", "beat", "ack", "release"] as const;
export type Kind = (typeof KINDS)[number];

/** Lifetimes per entity type. Each one follows what the entity means, not a storage default. */
export const LIFETIME = {
  /** A custodian's "I still hold my key" lease. Renewed by the custodian's watcher. */
  ackDays: 14,
  /** Floor for sealed vault data: long enough to outlive a missed check-in and the release window. */
  minVaultDays: 30,
  defaultVaultDays: 365,
} as const;

/**
 * The `type` value an unlisted vault uses for one kind of entity: a hash of the vault id and the kind. Only someone
 * who already holds the vault id can compute it, so no query over `type` can enumerate unlisted vaults.
 */
export function kindTag(vaultId: Hex, kind: Kind): string {
  return `x${bytesToHex(sha256(concat(utf8("proof-of-life/kind/v1"), hexToBytes(vaultId), utf8(kind)))).slice(2, 26)}`;
}

/** Maps a stored `type` value back to its kind, for both listed (plain) and unlisted (hashed) vaults. */
export function kindOf(type: string, vaultId: Hex): Kind | null {
  if ((KINDS as readonly string[]).includes(type)) return type as Kind;
  return KINDS.find((k) => kindTag(vaultId, k) === type) ?? null;
}

/**
 * Listed vaults carry the project tag and plain, typed attributes, so the public directory can list them.
 * Unlisted vaults (the default for real use) carry only `vault_id` and a hashed `type`. Everything else lives in
 * the encrypted manifest or is derived from it, so there is nothing to range over and nothing to enumerate.
 */
export const base = (kind: Kind, vaultId: Hex, listed: boolean): AttributeInputs =>
  listed
    ? { project: str(PROJECT), v: i32(SCHEMA_VERSION), type: str(kind), vault_id: bytes32(vaultId) }
    : { type: str(kindTag(vaultId, kind)), vault_id: bytes32(vaultId) };

export const attrs = {
  vault: (p: { vaultId: Hex; k: number; n: number; mode: ReleaseMode; intervalS: number; graceS: number; chunks: number; sealedAtMs: number; listed: boolean }) => !p.listed ? base("vault", p.vaultId, false) : ({
    ...base("vault", p.vaultId, p.listed),
    k: i32(p.k),
    n: i32(p.n),
    mode: str(p.mode),
    interval_s: u64(BigInt(p.intervalS)),
    grace_s: u64(BigInt(p.graceS)),
    chunks: i32(p.chunks),
    sealed_at_ms: u64(BigInt(p.sealedAtMs)),
  }),
  // Unlisted chunks carry no index: readers order them by matching each payload's hash to the manifest's list.
  chunk: (vaultId: Hex, idx: number, listed: boolean) => (listed ? { ...base("chunk", vaultId, true), idx: i32(idx) } : base("chunk", vaultId, false)),
  // The custodian address stays, so a custodian can find its envelopes; the slot comes from the manifest.
  envelope: (vaultId: Hex, slot: number, custodian: Hex, listed: boolean) => (listed ? { ...base("envelope", vaultId, true), slot: i32(slot), custodian: addr(custodian) } : { ...base("envelope", vaultId, false), custodian: addr(custodian) }),
  heartbeat: (vaultId: Hex, intervalS: number, graceS: number, listed: boolean) => !listed ? base("heartbeat", vaultId, false) : ({
    ...base("heartbeat", vaultId, listed),
    interval_s: u64(BigInt(intervalS)),
    grace_s: u64(BigInt(graceS)),
  }),
  ack: (vaultId: Hex, slot: number, listed: boolean) => (listed ? { ...base("ack", vaultId, true), slot: i32(slot) } : base("ack", vaultId, false)),
  /** One per check-in. Its payload carries an encrypted ok/duress flag for each custodian. */
  beat: (vaultId: Hex, listed: boolean) => base("beat", vaultId, listed),
  /**
   * A release always carries the project tag and the vault's creator, even for an unlisted vault: a vault stays
   * hidden while it is alive, and becomes findable from the chain alone the moment its evidence is out.
   */
  release: (vaultId: Hex, slot: number, vaultCreator: Hex) => ({ ...base("release", vaultId, true), slot: i32(slot), vault_creator: addr(vaultCreator) }),
};

export const ReleaseMode = z.enum(["public", "newsroom"]);
export type ReleaseMode = z.infer<typeof ReleaseMode>;

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** The public half of a vault. Nothing in it identifies the activist or says what the documents are. */
export const Manifest = z.object({
  v: z.literal(1),
  vault_id: hex32,
  k: z.number().int().min(2),
  n: z.number().int().max(15),
  custodians: z.array(z.object({ slot: z.number().int().min(1), address: hex, pubkey: hex })).min(2),
  commitments: z.array(hex32),
  chunks: z.object({ count: z.number().int().min(1), hashes: z.array(hex32), bytes: z.number().int().positive() }),
  ciphertext_sha256: hex32,
  interval_s: z.number().int().positive(),
  grace_s: z.number().int().positive(),
  release: z.object({ mode: ReleaseMode, newsroom_pubkey: hex.optional() }),
  sealed_at_ms: z.number().int(),
  /** Whether the vault appears in the public directory. Absent on early demo vaults, which were all listed. */
  listed: z.boolean().optional(),
  /** Only on early demo vaults. New vaults write no free text in public. */
  tag: z.string().max(24).optional(),
}).refine((m) => m.n === m.custodians.length && m.k <= m.n && m.commitments.length === m.n && m.chunks.hashes.length === m.chunks.count, {
  message: "manifest counts do not agree",
});
export type Manifest = z.infer<typeof Manifest>;
export const isListed = (m: Pick<Manifest, "listed">) => m.listed !== false;

/** What a custodian publishes when it releases. In newsroom mode the share is encrypted to the newsroom. */
export const ReleasePayload = z.object({
  v: z.literal(1),
  slot: z.number().int().min(1),
  share: hex,
  sealed_to_newsroom: z.boolean(),
  /** The block at which the custodian saw the heartbeat gone. */
  observed_lapse_block: z.string().regex(/^\d+$/),
});
export type ReleasePayload = z.infer<typeof ReleasePayload>;

export const secondsToBlocks = (s: number): bigint => BigInt(Math.ceil(s / BLOCK_SECONDS));
/** Arkiv lifetimes must be whole 2-second blocks. */
export const evenSeconds = (s: number): number => Math.ceil(s / BLOCK_SECONDS) * BLOCK_SECONDS;
