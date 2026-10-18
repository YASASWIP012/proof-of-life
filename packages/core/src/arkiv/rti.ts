// The RTI clock: statutory deadlines for an RTI application, and the one entity that timestamps it on Arkiv.
// Periods follow the Right to Information Act, 2005 as published on India Code (indiacode.gov.in). Mirrored in /arkiv/schema.md.
import { str } from "@arkiv-network/sdk/attr";
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concat, hexToBytes, utf8 } from "../crypto/bytes.js";
import type { AttributeInputs } from "@arkiv-network/sdk";
import type { Hex } from "../crypto/bytes.js";
import { BLOCK_SECONDS } from "./schema.js";

export type RtiKind = "normal" | "life";

export type RtiInput = {
  /** When the PIO or APIO received the application (ms since epoch, local clock). */
  receivedMs: number;
  /** "life": the information concerns the life or liberty of a person, s.7(1) proviso. */
  kind: RtiKind;
  /** Handed to an Assistant PIO: five days are added, s.5(2) proviso. */
  apio: boolean;
  /** Days between the PIO's further-fee letter and payment. They do not count, s.7(3)(a). */
  feeDays?: number;
  /** When the First Appeal is (or will be) filed. Defaults to the first day after the reply was due. */
  appealMs?: number;
};

export type RtiClock = {
  /** Last moment for the PIO's decision, s.7(1). Silence after it is a deemed refusal, s.7(2). */
  replyDueMs: number;
  /** Last day to file the First Appeal, 30 days from the expiry of the reply period, s.19(1). */
  firstAppealByMs: number;
  appealMs: number;
  /** The First Appellate Authority decides within 30 days of receiving the appeal, 45 at most, s.19(6). */
  faaDecisionDueMs: number;
  faaOuterMs: number;
  /** Second appeal to the Information Commission: 90 days from when the FAA decision should have been made, s.19(3). */
  secondAppealByMs: number;
};

const DAY = 86_400_000;

/**
 * How long a filing record outlives the reply deadline: the whole appeal path, so it is still there when the filer
 * needs it. 30 days to file the First Appeal (s.19(1)), 45 days at most for its decision (s.19(6)), then 90 days for
 * the second appeal (s.19(3)).
 */
export const RTI_APPEAL_DAYS = 30 + 45 + 90;
export const rtiExpiryBlock = (dueBlock: bigint): bigint => dueBlock + BigInt((RTI_APPEAL_DAYS * DAY) / 1000 / BLOCK_SECONDS);

/** End of the local calendar day `days` after `ms`. The day of receipt itself is not counted. */
function endOfDayAfter(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 0);
  return d.getTime();
}

const startOfNextDay = (ms: number) => endOfDayAfter(ms, 0) + 1000;

export function rtiClock(p: RtiInput): RtiClock {
  const extra = (p.apio ? 5 : 0) + Math.max(0, Math.floor(p.feeDays ?? 0));
  const replyDueMs = p.kind === "life" ? p.receivedMs + 48 * 3_600_000 + extra * DAY : endOfDayAfter(p.receivedMs, 30 + extra);
  const firstAppealByMs = endOfDayAfter(replyDueMs, 30);
  const appealMs = p.appealMs ?? startOfNextDay(replyDueMs);
  const faaDecisionDueMs = endOfDayAfter(appealMs, 30);
  return { replyDueMs, firstAppealByMs, appealMs, faaDecisionDueMs, faaOuterMs: endOfDayAfter(appealMs, 45), secondAppealByMs: endOfDayAfter(faaDecisionDueMs, 90) };
}

/**
 * What goes on chain instead of the application's hash: sha256("proof-of-life/rti/v1" ‖ salt ‖ sha256(file)), with a
 * random 32-byte salt made in the browser that never leaves the device. Without the salt the value is
 * indistinguishable from random, so nobody can test a guessed document or name against it. The filer keeps the salt
 * in a receipt; the receipt plus the application file prove the record is theirs.
 */
export function rtiCommitment(salt: Hex, fileHash: Hex): Hex {
  return bytesToHex(sha256(concat(utf8("proof-of-life/rti/v1"), hexToBytes(salt), hexToBytes(fileHash)))) as Hex;
}

/** The `type` of a filing record, derived from the commitment. It reveals nothing the payload does not. */
export function rtiTag(commitment: Hex): string {
  return `x${bytesToHex(sha256(concat(utf8("proof-of-life/rti-tag/v2"), hexToBytes(commitment)))).slice(2, 26)}`;
}

/** The record is handed to this address in the same transaction. Nobody holds its key, so nobody can delete it. */
export function rtiSealOwner(commitment: Hex): Hex {
  return `0x${bytesToHex(sha256(concat(utf8("proof-of-life/rti-seal/v2"), hexToBytes(commitment)))).slice(-40)}` as Hex;
}

export const rtiAttrs = (commitment: Hex): AttributeInputs => ({ type: str(rtiTag(commitment)) });

const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/);

export const RtiPayload = z.object({
  v: z.literal(2),
  commitment: hex32,
  due_block: z.string().regex(/^\d+$/),
});
export type RtiPayload = z.infer<typeof RtiPayload>;

/** What the filer downloads after recording. It stays with them: the salt is the only thing that links record and file. */
export const RtiReceipt = z.object({
  v: z.literal(2),
  kind: z.literal("proof-of-life/rti-receipt"),
  salt: hex32,
  sha256: hex32,
  commitment: hex32,
  key: hex32,
  block: z.string().regex(/^\d+$/),
  due_block: z.string().regex(/^\d+$/),
  tx: z.string().optional(),
});
export type RtiReceipt = z.infer<typeof RtiReceipt>;

/** Checks a receipt is self-consistent and, given the application's hash, that it belongs to that application. */
export function checkRtiReceipt(r: RtiReceipt, fileHash?: Hex): { consistent: boolean; matchesFile: boolean | null } {
  const consistent = rtiCommitment(r.salt as Hex, r.sha256 as Hex) === r.commitment;
  return { consistent, matchesFile: fileHash === undefined ? null : consistent && fileHash.toLowerCase() === r.sha256 };
}

export type RtiRow = {
  key: Hex;
  owner: Hex;
  creator: Hex;
  createdAt: bigint;
  expiresAt: bigint;
  creationFlags: { readonly: boolean; permissionlessExtension: boolean };
  payload: Uint8Array;
};

export type RtiRecord = { key: Hex; creator: Hex; createdAt: bigint; expiresAt: bigint; dueBlock: bigint };

/**
 * Pure, so the trust rules can be tested without a network. A row counts only if it is read-only, sealed to the
 * record's own address, names the same commitment, and expires when the appeal windows after its due block close.
 * The earliest valid row wins.
 */
export function assembleRti(rows: RtiRow[], commitment: Hex): { record: RtiRecord | null; rejected: { key: Hex; reason: string }[] } {
  const rejected: { key: Hex; reason: string }[] = [];
  const valid: RtiRecord[] = [];
  const seal = rtiSealOwner(commitment).toLowerCase();
  for (const r of rows) {
    let p: RtiPayload;
    try {
      p = RtiPayload.parse(JSON.parse(new TextDecoder().decode(r.payload)));
    } catch {
      rejected.push({ key: r.key, reason: "payload is not an RTI record" });
      continue;
    }
    if (p.commitment !== commitment.toLowerCase()) rejected.push({ key: r.key, reason: "names a different commitment" });
    else if (!r.creationFlags.readonly || r.owner.toLowerCase() !== seal) rejected.push({ key: r.key, reason: "not sealed: its owner could change or delete it" });
    else if (rtiExpiryBlock(BigInt(p.due_block)) !== r.expiresAt) rejected.push({ key: r.key, reason: "does not live through the appeal windows after the block it names" });
    else valid.push({ key: r.key, creator: r.creator, createdAt: r.createdAt, expiresAt: r.expiresAt, dueBlock: BigInt(p.due_block) });
  }
  valid.sort((a, b) => Number(a.createdAt - b.createdAt));
  return { record: valid[0] ?? null, rejected };
}
