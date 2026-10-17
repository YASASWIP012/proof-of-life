// Every write Dhadkan makes. Each one is a single atomic batch, so a reader never sees half a vault.
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk";
import type { Hex } from "viem";
import { bytesToHex } from "../crypto/bytes.js";
import type { SealedVault } from "../crypto/vault.js";
import type { PublicClient, WalletClient } from "./client.js";
import { attrs, evenSeconds, LIFETIME, Manifest, SEAL_ADDRESS, type ReleaseMode, type ReleasePayload } from "./schema.js";

const SEALED = { readonly: true, permissionlessExtension: true } as const;
const BIN = "application/octet-stream";
const JSON_T = "application/json";

export type Progress = (step: { stage: "chunks" | "vault" | "done"; done: number; total: number; txHash?: Hex }) => void;

export class PredictionMismatch extends Error {
  constructor() {
    super("another write from this wallet landed first; the batch was not sealed as planned");
  }
}

async function sealedBatch(
  wallet: WalletClient,
  reader: PublicClient,
  creates: Parameters<WalletClient["executeBatch"]>[0]["creates"] & {},
  keepOwnership: Set<number> = new Set(),
) {
  // Predict the keys so the same transaction can hand them to the seal address. The batch is atomic:
  // the entities exist sealed, or not at all.
  const predicted = await reader.predictEntityKeys({ owner: wallet.account.address, count: creates.length });
  const result = await wallet.executeBatch({
    creates: creates.map((c, i) => ({ ...c, salt: predicted[i].salt })),
    ownershipChanges: predicted.filter((_, i) => !keepOwnership.has(i)).map((p) => ({ entityKey: p.key, newOwner: SEAL_ADDRESS })),
  });
  if (result.createdEntities.some((k, i) => k.toLowerCase() !== predicted[i].key.toLowerCase())) throw new PredictionMismatch();
  return result;
}

export type CreateVaultInput = {
  sealed: SealedVault;
  k: number;
  custodians: { address: Hex; pubkey: Hex }[];
  intervalS: number;
  graceS: number;
  mode: ReleaseMode;
  newsroomPubkey?: Hex;
  vaultDays?: number;
  tag: string;
  /** Chunks per transaction. Large payload batches can exceed the node's transaction size limit. */
  chunksPerTx?: number;
};

export async function createVault(wallet: WalletClient, reader: PublicClient, input: CreateVaultInput, onProgress: Progress = () => {}) {
  const { sealed } = input;
  const intervalS = evenSeconds(input.intervalS);
  const graceS = evenSeconds(input.graceS);
  const vaultDays = Math.max(input.vaultDays ?? LIFETIME.defaultVaultDays, LIFETIME.minVaultDays);
  const expires = ExpirationTime.fromDays(vaultDays);
  const perTx = Math.max(1, input.chunksPerTx ?? 1);
  const txs: Hex[] = [];

  // 1. Ciphertext first. Chunks without a manifest are inert, so a failed upload exposes nothing.
  for (let i = 0; i < sealed.chunks.length; i += perTx) {
    const slice = sealed.chunks.slice(i, i + perTx);
    const r = await sealedBatch(
      wallet,
      reader,
      slice.map((bytes, j) => ({ payload: bytes, contentType: BIN, attributes: attrs.chunk(sealed.vaultId, i + j), expires, flags: SEALED })),
    );
    txs.push(r.txHash);
    onProgress({ stage: "chunks", done: Math.min(i + perTx, sealed.chunks.length), total: sealed.chunks.length, txHash: r.txHash });
  }

  // 2. Manifest, envelopes and heartbeat together: the vault appears whole, and its clock starts, in one block.
  const manifest: Manifest = Manifest.parse({
    v: 1,
    vault_id: sealed.vaultId,
    k: input.k,
    n: input.custodians.length,
    custodians: input.custodians.map((c, i) => ({ slot: i + 1, address: c.address, pubkey: c.pubkey })),
    commitments: sealed.commitments,
    chunks: { count: sealed.chunks.length, hashes: sealed.chunkHashes, bytes: sealed.chunks.reduce((n, c) => n + c.length, 0) },
    ciphertext_sha256: sealed.ciphertextHash,
    interval_s: intervalS,
    grace_s: graceS,
    release: { mode: input.mode, newsroom_pubkey: input.newsroomPubkey },
    sealed_at_ms: Date.now(),
    tag: input.tag,
  });
  const creates = [
    {
      payload: jsonToPayload(manifest),
      contentType: JSON_T,
      attributes: attrs.vault({ vaultId: sealed.vaultId, k: input.k, n: input.custodians.length, mode: input.mode, intervalS, graceS, chunks: sealed.chunks.length, sealedAtMs: manifest.sealed_at_ms }),
      expires,
      flags: SEALED,
    },
    ...sealed.envelopes.map((env, i) => ({
      payload: env,
      contentType: BIN,
      attributes: attrs.envelope(sealed.vaultId, i + 1, input.custodians[i].address),
      expires,
      flags: SEALED,
    })),
    // The heartbeat stays with the activist: only its owner can extend it, and nobody else may keep it beating.
    {
      payload: new Uint8Array(),
      contentType: BIN,
      attributes: attrs.heartbeat(sealed.vaultId, intervalS, graceS),
      expires: ExpirationTime.fromSeconds(intervalS + graceS),
      flags: { readonly: true, permissionlessExtension: false },
    },
  ];
  const r = await sealedBatch(wallet, reader, creates, new Set([creates.length - 1]));
  txs.push(r.txHash);
  onProgress({ stage: "done", done: 1, total: 1, txHash: r.txHash });
  return { vaultKey: r.createdEntities[0], heartbeatKey: r.createdEntities[creates.length - 1], txs, manifest };
}

/**
 * One tap: the heartbeat gets a fresh interval + grace. Sealed entities that would expire within the next
 * month are carried forward in the same transaction, so a living activist's vault never ages out.
 */
export async function checkIn(
  wallet: WalletClient,
  p: { heartbeatKey: Hex; intervalS: number; graceS: number; sealed?: { key: Hex; expiresAt: bigint }[]; head?: bigint; vaultDays?: number },
) {
  const keepDays = p.vaultDays ?? LIFETIME.defaultVaultDays;
  const soon = (p.head ?? 0n) + BigInt(30 * 43_200);
  const target = (p.head ?? 0n) + BigInt(keepDays * 43_200);
  const carry = (p.sealed ?? []).filter((e) => p.head !== undefined && e.expiresAt < soon && e.expiresAt < target);
  return wallet.executeBatch({
    extensions: [
      { entityKey: p.heartbeatKey, expires: ExpirationTime.fromSeconds(evenSeconds(p.intervalS + p.graceS)) },
      ...carry.map((e) => ({ entityKey: e.key, expires: ExpirationTime.fromDays(keepDays) })),
    ],
  });
}

/** A custodian's lease on its role. Creating it says "I hold my key"; extending it says "still here". */
export async function ackCustody(wallet: WalletClient, p: { vaultId: Hex; slot: number; existingKey?: Hex }) {
  const expires = ExpirationTime.fromDays(LIFETIME.ackDays);
  if (p.existingKey) return wallet.extendEntity({ entityKey: p.existingKey, expires });
  return wallet.createEntity({
    payload: new Uint8Array(),
    contentType: BIN,
    attributes: attrs.ack(p.vaultId, p.slot),
    expires,
    flags: { readonly: true, permissionlessExtension: false },
  });
}

export async function publishRelease(wallet: WalletClient, reader: PublicClient, p: { vaultId: Hex; payload: ReleasePayload; vaultDays?: number }) {
  return sealedBatch(wallet, reader, [
    {
      payload: jsonToPayload(p.payload),
      contentType: JSON_T,
      attributes: attrs.release(p.vaultId, p.payload.slot),
      expires: ExpirationTime.fromDays(p.vaultDays ?? LIFETIME.defaultVaultDays),
      flags: SEALED,
    },
  ]);
}

/** Anyone may keep sealed vault data alive. This is how custodians and supporters carry a vault forward. */
export async function keepAlive(wallet: WalletClient, keys: Hex[], days: number = LIFETIME.defaultVaultDays) {
  return wallet.executeBatch({ extensions: keys.map((entityKey) => ({ entityKey, expires: ExpirationTime.fromDays(days) })) });
}

export const shareHex = (share: Uint8Array): Hex => bytesToHex(share);
