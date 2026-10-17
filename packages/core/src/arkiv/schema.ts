// The Dhadkan data contract on Arkiv. Every name, type and lifetime here is mirrored in /arkiv/schema.md.
import { bytes32, i32, str, u64, addr } from "@arkiv-network/sdk/attr";
import { z } from "zod";
import type { Hex } from "../crypto/bytes.js";

export const PROJECT = "dhadkan";
export const SCHEMA_VERSION = 1;
/** Sealed entities are handed to this address. Nobody holds its key, so nobody can delete them. */
export const SEAL_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;
export const BLOCK_SECONDS = 2;

export const KINDS = ["vault", "chunk", "envelope", "heartbeat", "ack", "release"] as const;
export type Kind = (typeof KINDS)[number];

/** Lifetimes per entity type. Each one follows what the entity means, not a storage default. */
export const LIFETIME = {
  /** A custodian's "I still hold my key" lease. Renewed by the custodian's watcher. */
  ackDays: 14,
  /** Floor for sealed vault data: long enough to outlive a missed check-in and the release window. */
  minVaultDays: 30,
  defaultVaultDays: 365,
} as const;

export const base = (kind: Kind, vaultId: Hex) => ({
  project: str(PROJECT),
  v: i32(SCHEMA_VERSION),
  type: str(kind),
  vault_id: bytes32(vaultId),
});

export const attrs = {
  vault: (p: { vaultId: Hex; k: number; n: number; mode: ReleaseMode; intervalS: number; graceS: number; chunks: number; sealedAtMs: number }) => ({
    ...base("vault", p.vaultId),
    k: i32(p.k),
    n: i32(p.n),
    mode: str(p.mode),
    interval_s: u64(BigInt(p.intervalS)),
    grace_s: u64(BigInt(p.graceS)),
    chunks: i32(p.chunks),
    sealed_at_ms: u64(BigInt(p.sealedAtMs)),
  }),
  chunk: (vaultId: Hex, idx: number) => ({ ...base("chunk", vaultId), idx: i32(idx) }),
  envelope: (vaultId: Hex, slot: number, custodian: Hex) => ({ ...base("envelope", vaultId), slot: i32(slot), custodian: addr(custodian) }),
  heartbeat: (vaultId: Hex, intervalS: number, graceS: number) => ({
    ...base("heartbeat", vaultId),
    interval_s: u64(BigInt(intervalS)),
    grace_s: u64(BigInt(graceS)),
  }),
  ack: (vaultId: Hex, slot: number) => ({ ...base("ack", vaultId), slot: i32(slot) }),
  release: (vaultId: Hex, slot: number) => ({ ...base("release", vaultId), slot: i32(slot) }),
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
  /** A short public tag the activist picks so custodians can tell vaults apart. Never a name. */
  tag: z.string().max(24),
}).refine((m) => m.n === m.custodians.length && m.k <= m.n && m.commitments.length === m.n && m.chunks.hashes.length === m.chunks.count, {
  message: "manifest counts do not agree",
});
export type Manifest = z.infer<typeof Manifest>;

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
