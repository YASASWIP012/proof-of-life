import { describe, expect, it } from "vitest";
import { assembleRti, bytesToHex, checkRtiReceipt, RTI_APPEAL_DAYS, rtiExpiryBlock, randomBytes, rtiClock, rtiCommitment, rtiSealOwner, rtiTag, sha256Hex, utf8, type RtiReceipt, type RtiRow } from "../src/index.js";

const jsonPayload = (v: unknown) => utf8(JSON.stringify(v));

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0, 0).getTime();
const day = (ms: number) => {
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
};

describe("rtiClock", () => {
  it("gives the PIO thirty days after the day of receipt, s.7(1)", () => {
    const c = rtiClock({ receivedMs: at(2026, 1, 1), kind: "normal", apio: false });
    expect(day(c.replyDueMs)).toEqual([2026, 1, 31]);
    expect(new Date(c.replyDueMs).getHours()).toBe(23);
    // First Appeal: thirty days from the expiry of that period, s.19(1).
    expect(day(c.firstAppealByMs)).toEqual([2026, 3, 2]);
  });
  it("adds five days for an Assistant PIO, s.5(2), and the days spent waiting on further fees, s.7(3)(a)", () => {
    expect(day(rtiClock({ receivedMs: at(2026, 1, 1), kind: "normal", apio: true }).replyDueMs)).toEqual([2026, 2, 5]);
    expect(day(rtiClock({ receivedMs: at(2026, 1, 1), kind: "normal", apio: false, feeDays: 4 }).replyDueMs)).toEqual([2026, 2, 4]);
  });
  it("counts life or liberty requests in hours from receipt, s.7(1) proviso", () => {
    const r = at(2026, 10, 19, 9);
    expect(rtiClock({ receivedMs: r, kind: "life", apio: false }).replyDueMs - r).toBe(48 * 3_600_000);
    expect(rtiClock({ receivedMs: r, kind: "life", apio: true }).replyDueMs - r).toBe((48 + 5 * 24) * 3_600_000);
  });
  it("runs the second appeal ninety days from when the First Appeal decision was due, s.19(3) and s.19(6)", () => {
    const c = rtiClock({ receivedMs: at(2026, 1, 1), kind: "normal", apio: false, appealMs: at(2026, 2, 10) });
    expect(day(c.faaDecisionDueMs)).toEqual([2026, 3, 12]);
    expect(day(c.faaOuterMs)).toEqual([2026, 3, 27]);
    expect(day(c.secondAppealByMs)).toEqual([2026, 6, 10]);
    // Without an appeal date, the earliest one: the day after the reply was due.
    expect(day(rtiClock({ receivedMs: at(2026, 1, 1), kind: "normal", apio: false }).appealMs)).toEqual([2026, 2, 1]);
  });
});

describe("RTI record", () => {
  const fileHash = sha256Hex(utf8("synthetic RTI application, not a real filing"));
  const salt = bytesToHex(randomBytes(32));
  const commitment = rtiCommitment(salt, fileHash);
  const other = rtiCommitment(bytesToHex(randomBytes(32)), fileHash);
  const row = (o: Partial<RtiRow> & { body?: unknown } = {}): RtiRow => ({
    key: `0x${"0".repeat(63)}${Math.floor(Math.random() * 9) + 1}` as `0x${string}`,
    owner: rtiSealOwner(commitment),
    creator: "0x1111111111111111111111111111111111111111",
    createdAt: 100n,
    expiresAt: rtiExpiryBlock(1_396_900n),
    creationFlags: { readonly: true, permissionlessExtension: false },
    payload: jsonPayload(o.body ?? { v: 2, commitment, due_block: "1396900" }),
    ...o,
  });

  it("stores a salted commitment that a guessed document cannot be matched against", () => {
    expect(commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(commitment).not.toBe(fileHash);
    // Same document, different salt: unrelated values, so knowing the document does not find or confirm the record.
    expect(other).not.toBe(commitment);
    expect(rtiCommitment(salt, fileHash)).toBe(commitment);
    const onChain = new TextDecoder().decode(row().payload);
    expect(onChain).not.toContain(fileHash.slice(2));
    expect(onChain).not.toContain(salt.slice(2));
  });
  it("derives a tag and a seal address from the commitment alone", () => {
    expect(rtiTag(commitment)).toMatch(/^x[0-9a-f]{24}$/);
    expect(rtiTag(commitment)).not.toBe(rtiTag(other));
    expect(rtiSealOwner(commitment)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(rtiSealOwner(commitment)).not.toBe(rtiSealOwner(other));
  });
  it("checks a receipt against itself and against the application", () => {
    const receipt: RtiReceipt = { v: 2, kind: "proof-of-life/rti-receipt", salt, sha256: fileHash, commitment, key: `0x${"ab".repeat(32)}`, block: "100", due_block: "1396900" };
    expect(checkRtiReceipt(receipt)).toEqual({ consistent: true, matchesFile: null });
    expect(checkRtiReceipt(receipt, fileHash)).toEqual({ consistent: true, matchesFile: true });
    expect(checkRtiReceipt(receipt, sha256Hex(utf8("a different application"))).matchesFile).toBe(false);
    expect(checkRtiReceipt({ ...receipt, salt: bytesToHex(randomBytes(32)) }, fileHash)).toEqual({ consistent: false, matchesFile: false });
  });
  it("lives through the appeal windows: 30 + 45 + 90 days after the reply is due, s.19(1), s.19(6), s.19(3)", () => {
    expect(RTI_APPEAL_DAYS).toBe(165);
    expect(rtiExpiryBlock(1_000n)).toBe(1_000n + 165n * 43_200n);
  });
  it("accepts a sealed record and keeps the earliest", () => {
    const late = row({ createdAt: 500n });
    const early = row({ createdAt: 120n });
    expect(assembleRti([late, early], commitment).record?.createdAt).toBe(120n);
  });
  it("rejects records that are not sealed, name another commitment, expire elsewhere (even at the due block itself), or use the old format", () => {
    const rows = [
      row({ owner: "0x2222222222222222222222222222222222222222" }),
      row({ creationFlags: { readonly: false, permissionlessExtension: false } }),
      row({ body: { v: 2, commitment: other, due_block: "1396900" } }),
      row({ expiresAt: 999n }),
      row({ expiresAt: 1_396_900n }),
      row({ body: { v: 1, sha256: fileHash, due_block: "1396900" } }),
    ];
    const { record, rejected } = assembleRti(rows, commitment);
    expect(record).toBeNull();
    expect(rejected).toHaveLength(6);
  });
});
