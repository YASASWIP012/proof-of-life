// Every write Proof of Life makes. Each one is a single atomic batch, so a reader never sees half a vault.
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk";
import type { Hex } from "viem";
import { bytesToHex } from "../crypto/bytes.js";
import type { SealedVault } from "../crypto/vault.js";
import type { PublicClient, WalletClient } from "./client.js";
import { attrs, BLOCK_SECONDS, evenSeconds, LIFETIME, Manifest, SEAL_ADDRESS, sealOwner, type ReleaseMode, type ReleasePayload } from "./schema.js";
import { rtiAttrs, rtiSealOwner, type RtiPayload } from "./rti.js";

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
  newOwner: Hex = SEAL_ADDRESS,
) {
  // Predict the keys so the same transaction can hand them to the seal address. The batch is atomic:
  // the entities exist sealed, or not at all.
  const predicted = await reader.predictEntityKeys({ owner: wallet.account.address, count: creates.length });
  const result = await wallet.executeBatch({
    creates: creates.map((c, i) => ({ ...c, salt: predicted[i].salt })),
    ownershipChanges: predicted.filter((_, i) => !keepOwnership.has(i)).map((p) => ({ entityKey: p.key, newOwner })),
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
  /** Show the vault in the public directory. Off by default for real vaults. */
  listed?: boolean;
  /** Let anyone extend the sealed data. On by default so evidence can outlive the activist; off leaves expiry to the activist alone. */
  keepAliveByAnyone?: boolean;
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
  const listed = input.listed ?? false;
  const seal = sealOwner(sealed.vaultId, listed);
  const anyoneKeeps = input.keepAliveByAnyone ?? true;
  const SEAL = { readonly: true, permissionlessExtension: anyoneKeeps } as const;
  // With anyone-may-extend off, the activist keeps ownership so it alone can extend, or let the data expire.
  // Handing it to 0x…dEaD as well would leave entities nobody can ever extend, and a check-in that tried would revert.
  const keepAll = (n: number) => (anyoneKeeps ? new Set<number>() : new Set(Array.from({ length: n }, (_, i) => i)));
  const txs: Hex[] = [];

  // 1. Ciphertext first. Chunks without a manifest are inert, so a failed upload exposes nothing.
  for (let i = 0; i < sealed.chunks.length; i += perTx) {
    const slice = sealed.chunks.slice(i, i + perTx);
    const r = await sealedBatch(
      wallet,
      reader,
      slice.map((bytes, j) => ({ payload: bytes, contentType: BIN, attributes: attrs.chunk(sealed.vaultId, i + j, listed), expires, flags: SEAL })),
      keepAll(slice.length),
      seal,
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
    listed,
  });
  const creates = [
    {
      payload: jsonToPayload(manifest),
      contentType: JSON_T,
      attributes: attrs.vault({ vaultId: sealed.vaultId, k: input.k, n: input.custodians.length, mode: input.mode, intervalS, graceS, chunks: sealed.chunks.length, sealedAtMs: manifest.sealed_at_ms, listed }),
      expires,
      flags: SEAL,
    },
    ...sealed.envelopes.map((env, i) => ({
      payload: env,
      contentType: BIN,
      attributes: attrs.envelope(sealed.vaultId, i + 1, input.custodians[i].address, listed),
      expires,
      flags: SEAL,
    })),
    // The heartbeat stays with the activist: only its owner can extend it, and nobody else may keep it beating.
    {
      payload: new Uint8Array(),
      contentType: BIN,
      attributes: attrs.heartbeat(sealed.vaultId, intervalS, graceS, listed),
      expires: ExpirationTime.fromSeconds(intervalS + graceS),
      flags: { readonly: true, permissionlessExtension: false },
    },
  ];
  const r = await sealedBatch(wallet, reader, creates, anyoneKeeps ? new Set([creates.length - 1]) : keepAll(creates.length), seal);
  txs.push(r.txHash);
  onProgress({ stage: "done", done: 1, total: 1, txHash: r.txHash });
  return { vaultKey: r.createdEntities[0], heartbeatKey: r.createdEntities[creates.length - 1], txs, manifest };
}

/**
 * One tap: the heartbeat gets a fresh interval + grace. Sealed entities that would expire within the next
 * month are carried forward in the same transaction, so a living activist's vault never ages out.
 * With `beat`, the same batch also writes the check-in's encrypted ok/duress note for the custodians
 * (see crypto/duress.ts). A normal and a forced check-in produce the same transaction shape.
 */
export async function checkIn(
  wallet: WalletClient,
  p: { heartbeatKey: Hex; intervalS: number; graceS: number; sealed?: { key: Hex; expiresAt: bigint }[]; head?: bigint; vaultDays?: number; beat?: { vaultId: Hex; payload: Uint8Array; listed?: boolean } },
) {
  const keepDays = p.vaultDays ?? LIFETIME.defaultVaultDays;
  const soon = (p.head ?? 0n) + BigInt(30 * 43_200);
  const target = (p.head ?? 0n) + BigInt(keepDays * 43_200);
  const carry = (p.sealed ?? []).filter((e) => p.head !== undefined && e.expiresAt < soon && e.expiresAt < target);
  const life = ExpirationTime.fromSeconds(evenSeconds(p.intervalS + p.graceS));
  return wallet.executeBatch({
    creates: p.beat
      ? [{ payload: p.beat.payload, contentType: BIN, attributes: attrs.beat(p.beat.vaultId, p.beat.listed ?? false), expires: life, flags: { readonly: true, permissionlessExtension: false } }]
      : undefined,
    extensions: [
      { entityKey: p.heartbeatKey, expires: life },
      ...carry.map((e) => ({ entityKey: e.key, expires: ExpirationTime.fromDays(keepDays) })),
    ],
  });
}

/** A custodian's lease on its role. Creating it says "I hold my key"; extending it says "still here". */
export async function ackCustody(wallet: WalletClient, p: { vaultId: Hex; slot: number; existingKey?: Hex; listed?: boolean }) {
  const expires = ExpirationTime.fromDays(LIFETIME.ackDays);
  if (p.existingKey) return wallet.extendEntity({ entityKey: p.existingKey, expires });
  return wallet.createEntity({
    payload: new Uint8Array(),
    contentType: BIN,
    attributes: attrs.ack(p.vaultId, p.slot, p.listed ?? false),
    expires,
    flags: { readonly: true, permissionlessExtension: false },
  });
}

export async function publishRelease(wallet: WalletClient, reader: PublicClient, p: { vaultId: Hex; vaultCreator: Hex; payload: ReleasePayload; vaultDays?: number }) {
  return sealedBatch(wallet, reader, [
    {
      payload: jsonToPayload(p.payload),
      contentType: JSON_T,
      attributes: attrs.release(p.vaultId, p.payload.slot, p.vaultCreator),
      expires: ExpirationTime.fromDays(p.vaultDays ?? LIFETIME.defaultVaultDays),
      flags: SEALED,
    },
  ]);
}

/**
 * Anyone may keep sealed vault data alive. This is how custodians and supporters carry a vault forward. Each key
 * is set to expire `days` from now, so pass only keys that expire sooner (the vault page and `extendableKeys`
 * callers filter on that); a key that already lives longer would make the batch revert.
 */
export async function keepAlive(wallet: WalletClient, keys: Hex[], days: number = LIFETIME.defaultVaultDays) {
  return wallet.executeBatch({ extensions: keys.map((entityKey) => ({ entityKey, expires: ExpirationTime.fromDays(days) })) });
}

/**
 * Timestamps an RTI application: one read-only entity whose payload is the application's sha256 and the block
 * its reply is due. It expires exactly at that block and is handed to the record's own seal address in the same
 * transaction, so nobody can change, extend or delete it. Its $creator and creation block are the proof.
 */
export async function recordRti(wallet: WalletClient, reader: PublicClient, p: { docHash: Hex; dueMs: number; nowMs?: number }) {
  const head = await reader.getBlockNumber();
  const dueBlock = head + BigInt(Math.ceil((p.dueMs - (p.nowMs ?? Date.now())) / 1000 / BLOCK_SECONDS));
  if (dueBlock <= head + 30n) throw new Error("the reply deadline has passed, so there is nothing left to time");
  const payload: RtiPayload = { v: 1, sha256: p.docHash.toLowerCase(), due_block: dueBlock.toString() };
  const r = await sealedBatch(
    wallet,
    reader,
    [{ payload: jsonToPayload(payload), contentType: JSON_T, attributes: rtiAttrs(p.docHash), expires: ExpirationTime.atBlock(dueBlock), flags: { readonly: true, permissionlessExtension: false } }],
    new Set(),
    rtiSealOwner(p.docHash),
  );
  return { key: r.createdEntities[0], txHash: r.txHash, dueBlock };
}

export const shareHex = (share: Uint8Array): Hex => bytesToHex(share);
