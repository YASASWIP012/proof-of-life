// The RTI clock: statutory deadlines for an RTI application, and the one entity that timestamps it on Arkiv.
// Periods follow the Right to Information Act, 2005 as published on India Code (indiacode.gov.in). Mirrored in /arkiv/schema.md.
import { str } from "@arkiv-network/sdk/attr";
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concat, hexToBytes, utf8 } from "../crypto/bytes.js";
import type { AttributeInputs } from "@arkiv-network/sdk";
import type { Hex } from "../crypto/bytes.js";

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
 * The `type` of a filing record: a hash of the application's sha256. Only someone holding the application can
 * compute it, so nobody can list RTI records by type, and the filer can find theirs again from the file alone.
 */
export function rtiTag(docHash: Hex): string {
  return `x${bytesToHex(sha256(concat(utf8("proof-of-life/rti/v1"), hexToBytes(docHash)))).slice(2, 26)}`;
}

/** The record is handed to this address in the same transaction. Nobody holds its key, so nobody can delete it. */
export function rtiSealOwner(docHash: Hex): Hex {
  return `0x${bytesToHex(sha256(concat(utf8("proof-of-life/rti-seal/v1"), hexToBytes(docHash)))).slice(-40)}` as Hex;
}

export const rtiAttrs = (docHash: Hex): AttributeInputs => ({ type: str(rtiTag(docHash)) });

export const RtiPayload = z.object({
  v: z.literal(1),
  sha256: z.string().regex(/^0x[0-9a-f]{64}$/),
  due_block: z.string().regex(/^\d+$/),
});
export type RtiPayload = z.infer<typeof RtiPayload>;

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
 * record's own address, names the same hash, and expires at the block it names. The earliest valid row wins:
 * it is the oldest proof that the application existed.
 */
export function assembleRti(rows: RtiRow[], docHash: Hex): { record: RtiRecord | null; rejected: { key: Hex; reason: string }[] } {
  const rejected: { key: Hex; reason: string }[] = [];
  const valid: RtiRecord[] = [];
  const seal = rtiSealOwner(docHash).toLowerCase();
  for (const r of rows) {
    let p: RtiPayload;
    try {
      p = RtiPayload.parse(JSON.parse(new TextDecoder().decode(r.payload)));
    } catch {
      rejected.push({ key: r.key, reason: "payload is not an RTI record" });
      continue;
    }
    if (p.sha256 !== docHash.toLowerCase()) rejected.push({ key: r.key, reason: "names a different hash" });
    else if (!r.creationFlags.readonly || r.owner.toLowerCase() !== seal) rejected.push({ key: r.key, reason: "not sealed: its owner could change or delete it" });
    else if (BigInt(p.due_block) !== r.expiresAt) rejected.push({ key: r.key, reason: "expires at a different block than it names" });
    else valid.push({ key: r.key, creator: r.creator, createdAt: r.createdAt, expiresAt: r.expiresAt, dueBlock: BigInt(p.due_block) });
  }
  valid.sort((a, b) => Number(a.createdAt - b.createdAt));
  return { record: valid[0] ?? null, rejected };
}
