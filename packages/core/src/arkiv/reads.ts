// Reading a vault. Trust never comes from an attribute: every entity is checked against its on-chain $creator.
import { bytes32, str, u64, addr as addrAttr } from "@arkiv-network/sdk/attr";
import { eq, gte, lte, not } from "@arkiv-network/sdk/query";
import type { Hex } from "viem";
import { getAddress } from "viem";
import { hexToBytes } from "../crypto/bytes.js";
import { checkShare, reassemble } from "../crypto/vault.js";
import type { PublicClient } from "./client.js";
import { kindOf, kindTag, Manifest, PROJECT, ReleasePayload, SEAL_ADDRESS, sealOwner } from "./schema.js";
import { sha256Hex } from "../crypto/vault.js";
import { or } from "@arkiv-network/sdk/query";
import { BLOCK_SECONDS } from "./schema.js";
import { vaultStatus, type Status } from "./status.js";
import { assembleRti, rtiTag, type RtiRecord, type RtiRow } from "./rti.js";

const FIELDS = { key: true, owner: true, creator: true, createdAt: true, expiresAt: true, creationFlags: true, attributes: true, payload: true } as const;

type Row = {
  key: Hex;
  owner: Hex;
  creator: Hex;
  createdAt: bigint;
  expiresAt: bigint;
  creationFlags: { readonly: boolean; permissionlessExtension: boolean };
  attributes: Record<string, { type: string; value: unknown }>;
  payload: Uint8Array;
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const num = (r: Row, name: string) => Number(r.attributes[name]?.value ?? NaN);
const text = (r: Row, name: string) => String(r.attributes[name]?.value ?? "");

export type Rejected = { key: Hex; kind: string; reason: string };

export type ReleaseView = { key: Hex; slot: number; custodian: Hex; createdAt: bigint; sealedToNewsroom: boolean; valid: boolean; reason?: string; share?: Uint8Array };

export type VaultView = {
  key: Hex;
  vaultId: Hex;
  creator: Hex;
  manifest: Manifest;
  head: bigint;
  createdAt: bigint;
  expiresAt: bigint;
  /** Readonly, and owned by an address nobody holds: neither the activist nor anyone else can delete it. */
  sealed: boolean;
  heartbeat: { key: Hex; expiresAt: bigint; owner: Hex; createdAt: bigint } | null;
  /** The latest check-in note from the vault's creator: an encrypted ok/duress flag per custodian. */
  lastBeat: { key: Hex; createdAt: bigint; payload: Uint8Array } | null;
  envelopes: { key: Hex; slot: number; custodian: Hex; expiresAt: bigint; sealed: boolean; payload: Uint8Array }[];
  acks: { key: Hex; slot: number; custodian: Hex; expiresAt: bigint }[];
  releases: ReleaseView[];
  status: Status;
  /** Entities that claim to belong to this vault but fail a trust check. Shown, never used. */
  rejected: Rejected[];
  /** Every long-lived entity of the vault except chunks, with who may extend it. See extendableKeys(). */
  sealedKeys: { key: Hex; expiresAt: bigint; owner: Hex; permissionless: boolean }[];
};

/** Read-only and owned by an address nobody holds: 0x…dEaD, or the unlisted vault's own seal address. */
const isSealed = (r: Row, vaultId: Hex) => r.creationFlags.readonly && (same(r.owner, SEAL_ADDRESS) || same(r.owner, sealOwner(vaultId, false)));

type Pageable = { atBlock(block: bigint): Pageable; fetch(): Promise<{ entities: unknown[]; blockNumber: bigint; hasNextPage(): boolean; next(): Promise<any> }> };

/**
 * Every page of one query, read at one block. A single page (the usual case) costs one query. When there are more,
 * the walk restarts pinned with `atBlock` to the first page's block, so no row can shift between pages and a new
 * block cannot invalidate the cursor halfway.
 */
async function fetchAll<T = Row>(b: Pageable, opts: { atBlock?: bigint; max?: number } = {}): Promise<{ rows: T[]; blockNumber: bigint }> {
  const max = opts.max ?? Infinity;
  let page = await (opts.atBlock !== undefined ? b.atBlock(opts.atBlock) : b).fetch();
  if (page.hasNextPage() && opts.atBlock === undefined) page = await b.atBlock(page.blockNumber).fetch();
  const rows = [...page.entities] as T[];
  while (page.hasNextPage() && rows.length < max) {
    page = await page.next();
    rows.push(...(page.entities as T[]));
  }
  return { rows, blockNumber: page.blockNumber };
}

/**
 * One query loads everything but the ciphertext. With `atBlock`, the same query reads the vault as it stood at a
 * past block, so anyone can show the heartbeat was alive (or already gone) at a given moment.
 */
export async function loadVault(client: PublicClient, vaultId: Hex, creator: Hex, opts: { atBlock?: bigint } = {}): Promise<VaultView> {
  const q = client.select(FIELDS).where(eq("vault_id", bytes32(vaultId)), not(eq("type", str("chunk"))), not(eq("type", str(kindTag(vaultId, "chunk"))))).limit(200);
  const { rows, blockNumber } = await fetchAll(q as unknown as Pageable, { atBlock: opts.atBlock });
  return assembleVault(rows, vaultId, creator, blockNumber);
}

export class VaultNotFound extends Error {
  constructor(vaultId: string, creator: string) {
    super(`no vault ${vaultId.slice(0, 10)}… created by ${creator}`);
  }
}

/** Pure, so the trust rules can be tested without a network. */
export function assembleVault(rows: Row[], vaultId: Hex, creator: Hex, head: bigint): VaultView {
  const rejected: Rejected[] = [];
  const kind = (r: Row) => kindOf(text(r, "type"), vaultId) ?? text(r, "type");
  const reject = (r: Row, reason: string) => rejected.push({ key: r.key, kind: kind(r), reason });
  const byType = (t: string) => rows.filter((r) => kind(r) === t);

  const vaultRows = byType("vault").filter((r) => same(r.creator, creator));
  byType("vault").filter((r) => !same(r.creator, creator)).forEach((r) => reject(r, "vault entity from a different creator"));
  if (vaultRows.length === 0) throw new VaultNotFound(vaultId, creator);
  // A creator could in principle write two manifests for one id; the first one written is the vault.
  const v = vaultRows.sort((a, b) => Number(a.createdAt - b.createdAt))[0];
  vaultRows.slice(1).forEach((r) => reject(r, "second manifest for the same vault; the first one counts"));
  const manifest = Manifest.parse(JSON.parse(new TextDecoder().decode(v.payload)));
  if (!same(manifest.vault_id, vaultId)) throw new Error("manifest names a different vault id");

  const custodianOf = new Map(manifest.custodians.map((c) => [c.slot, getAddress(c.address)]));
  // Unlisted vaults store no slot numbers; the slot is the custodian's position in the manifest.
  const slotOfAddress = (a: string) => manifest.custodians.find((c) => same(c.address, a))?.slot ?? NaN;
  const slotOf = (r: Row, fallback: string) => (Number.isFinite(num(r, "slot")) ? num(r, "slot") : slotOfAddress(fallback));

  const heartbeats = byType("heartbeat").filter((r) => {
    if (!same(r.creator, creator)) return reject(r, "heartbeat not written by the vault's creator"), false;
    return true;
  });
  const hb = heartbeats.sort((a, b) => Number(b.expiresAt - a.expiresAt))[0] ?? null;

  const beats = byType("beat").filter((r) => {
    if (!same(r.creator, creator)) return reject(r, "check-in note not written by the vault's creator"), false;
    return true;
  });
  const lastBeat = beats.sort((a, b) => Number(b.createdAt - a.createdAt))[0] ?? null;

  const envelopes = byType("envelope").flatMap((r) => {
    if (!same(r.creator, creator)) return reject(r, "envelope not written by the vault's creator"), [];
    const custodian = getAddress(String(r.attributes.custodian?.value));
    const slot = slotOf(r, custodian);
    return [{ key: r.key, slot, custodian, expiresAt: r.expiresAt, sealed: isSealed(r, vaultId), payload: r.payload }];
  });

  const acks = byType("ack").flatMap((r) => {
    const slot = slotOf(r, r.creator);
    if (!custodianOf.has(slot) || !same(custodianOf.get(slot)!, r.creator)) return reject(r, "acknowledgement from a wallet that is not this slot's custodian"), [];
    return [{ key: r.key, slot, custodian: getAddress(r.creator), expiresAt: r.expiresAt }];
  });

  const seenSlots = new Set<number>();
  const releases: ReleaseView[] = byType("release")
    .sort((a, b) => Number(a.createdAt - b.createdAt))
    .flatMap((r): ReleaseView[] => {
      const slot = num(r, "slot");
      const base = { key: r.key, slot, custodian: getAddress(r.creator), createdAt: r.createdAt };
      if (!custodianOf.has(slot) || !same(custodianOf.get(slot)!, r.creator)) {
        reject(r, "release from a wallet that is not this slot's custodian");
        return [];
      }
      let body: ReleasePayload;
      try {
        body = ReleasePayload.parse(JSON.parse(new TextDecoder().decode(r.payload)));
      } catch {
        return [{ ...base, sealedToNewsroom: false, valid: false, reason: "unreadable release payload" }];
      }
      if (body.slot !== slot) return [{ ...base, sealedToNewsroom: body.sealed_to_newsroom, valid: false, reason: "payload slot differs from attribute" }];
      if (seenSlots.has(slot)) return [{ ...base, sealedToNewsroom: body.sealed_to_newsroom, valid: false, reason: "duplicate release for this slot" }];
      if (body.sealed_to_newsroom) {
        seenSlots.add(slot);
        // Only the newsroom can check a share sealed to it; the public sees that it was published, and by whom.
        return [{ ...base, sealedToNewsroom: true, valid: true }];
      }
      const share = hexToBytes(body.share);
      const check = share[0] === slot ? checkShare(manifest.vault_id as Hex, share, manifest.commitments as Hex[]) : { ok: false, reason: "share index differs from slot" };
      if (check.ok) seenSlots.add(slot);
      return [{ ...base, sealedToNewsroom: false, valid: check.ok, reason: check.reason, share: check.ok ? share : undefined }];
    });

  const status = vaultStatus({
    head,
    heartbeatExpiresAt: hb ? hb.expiresAt : null,
    graceS: manifest.grace_s,
    k: manifest.k,
    validReleases: releases.filter((r) => r.valid).length,
  });

  return {
    key: v.key,
    vaultId,
    creator: getAddress(creator),
    manifest,
    head,
    createdAt: v.createdAt,
    expiresAt: v.expiresAt,
    sealed: isSealed(v, vaultId),
    heartbeat: hb ? { key: hb.key, expiresAt: hb.expiresAt, owner: hb.owner, createdAt: hb.createdAt } : null,
    lastBeat: lastBeat ? { key: lastBeat.key, createdAt: lastBeat.createdAt, payload: lastBeat.payload } : null,
    envelopes,
    acks,
    releases,
    status,
    rejected,
    sealedKeys: [v, ...byType("envelope").filter((r) => same(r.creator, creator)), ...byType("release").filter((r) => releases.some((x) => x.key === r.key && x.valid))]
      .map((r) => ({ key: r.key, expiresAt: r.expiresAt, owner: r.owner, permissionless: r.creationFlags.permissionlessExtension })),
  };
}

/** The ciphertext, read only when someone opens a released vault. Chunks from any other creator are ignored. */
export async function loadCiphertext(client: PublicClient, view: VaultView): Promise<{ ciphertext: Uint8Array; keys: { key: Hex; expiresAt: bigint }[] }> {
  const { rows } = await fetchAll(
    client
      .select(FIELDS)
      .where(eq("vault_id", bytes32(view.vaultId)), or(eq("type", str("chunk")), eq("type", str(kindTag(view.vaultId, "chunk")))))
      .createdBy(view.creator)
      .limit(50) as unknown as Pageable,
  );
  // Listed chunks carry an index; unlisted ones are placed by matching their hash to the manifest's list.
  const hashes = view.manifest.chunks.hashes;
  const byIdx = new Map<number, Row>();
  for (const r of rows.sort((a, b) => Number(a.createdAt - b.createdAt))) {
    const idx = Number.isFinite(num(r, "idx")) ? num(r, "idx") : hashes.indexOf(sha256Hex(r.payload));
    if (idx >= 0 && !byIdx.has(idx)) byIdx.set(idx, r);
  }
  const ordered = Array.from({ length: view.manifest.chunks.count }, (_, i) => byIdx.get(i));
  const missing = ordered.flatMap((r, i) => (r ? [] : [i]));
  if (missing.length) throw new Error(`missing chunk(s) ${missing.join(", ")}: they may have expired`);
  const ciphertext = reassemble(ordered.map((r) => r!.payload), view.manifest.chunks.hashes as Hex[], view.manifest.ciphertext_sha256 as Hex);
  return { ciphertext, keys: ordered.map((r) => ({ key: r!.key, expiresAt: r!.expiresAt })) };
}

/**
 * How many release rows count as real pieces, by the same rules the vault page applies: the row's $creator is the
 * custodian named for its slot in the manifest, the payload names the same slot, one piece per slot, and the share
 * matches the commitment sealed with the vault (a newsroom-sealed piece counts once, as on the vault page).
 */
export function countValidReleases(manifest: Partial<Manifest> | null, rows: Row[]): number {
  if (!manifest?.custodians || !manifest.commitments || !manifest.vault_id) return 0;
  const custodianOf = new Map(manifest.custodians.map((c) => [c.slot, c.address.toLowerCase()]));
  const seen = new Set<number>();
  for (const r of [...rows].sort((a, b) => Number(a.createdAt - b.createdAt))) {
    const slot = num(r, "slot");
    if (seen.has(slot) || custodianOf.get(slot) !== r.creator.toLowerCase()) continue;
    try {
      const body = ReleasePayload.parse(JSON.parse(new TextDecoder().decode(r.payload)));
      if (body.slot !== slot) continue;
      if (body.sealed_to_newsroom) {
        seen.add(slot);
        continue;
      }
      const share = hexToBytes(body.share);
      if (share[0] === slot && checkShare(manifest.vault_id as Hex, share, manifest.commitments as Hex[]).ok) seen.add(slot);
    } catch {}
  }
  return seen.size;
}

export type VaultSummary = { key: Hex; vaultId: Hex; creator: Hex; tag?: string; k: number; n: number; mode: string; createdAt: bigint; heartbeatExpiresAt: bigint | null; graceS: number; releases: number; chunks: number; sealedAtMs: number };

/**
 * The public directory: one query per kind (vault, heartbeat, release). Two filters run on the node, over typed
 * numbers: `stopsWithinS` keeps vaults whose heartbeat expires within that many seconds (`$expiresAt <= head + n`,
 * a range on the heartbeat), and `rhythmAtLeastS` keeps vaults whose check-in interval is at least that long
 * (`interval_s >= …`, a range on the vault). Listed vaults only; unlisted ones carry no numbers to range over.
 */
export async function listVaults(client: PublicClient, opts: { creator?: Hex; limit?: number; stopsWithinS?: number; rhythmAtLeastS?: number } = {}): Promise<{ head: bigint; vaults: VaultSummary[] }> {
  const walk = async (b: unknown) => {
    const { rows, blockNumber } = await fetchAll(b as Pageable, { max: 2000 });
    return { entities: rows, blockNumber };
  };
  const fields = { key: true, creator: true, createdAt: true, expiresAt: true, attributes: true, payload: true } as const;
  let all: { entities: Row[]; blockNumber: bigint };
  if (opts.creator) {
    // One key seals one vault, so everything this key wrote is small. Hashed (unlisted) kinds are recognised here.
    all = await walk(client.select(fields).where(eq("$creator", addrAttr(opts.creator))).limit(opts.limit ?? 200));
  } else {
    const head = opts.stopsWithinS !== undefined ? await client.getBlockNumber() : 0n;
    const extra = (t: string) =>
      t === "heartbeat" && opts.stopsWithinS !== undefined
        ? [lte("$expiresAt", u64(head + BigInt(Math.ceil(opts.stopsWithinS / BLOCK_SECONDS))))]
        : t === "vault" && opts.rhythmAtLeastS !== undefined
          ? [gte("interval_s", u64(BigInt(opts.rhythmAtLeastS)))]
          : [];
    const parts = await Promise.all(["vault", "heartbeat", "release"].map((t) => walk(client.select(fields).where(eq("project", str(PROJECT)), eq("type", str(t)), ...extra(t)).limit(opts.limit ?? 200))));
    all = { entities: parts.flatMap((p) => p.entities), blockNumber: parts[0].blockNumber };
    if (opts.stopsWithinS !== undefined) {
      // Only vaults with a heartbeat inside the window remain.
      const live = new Set(parts[1].entities.map((h) => `${text(h, "vault_id")}:${h.creator.toLowerCase()}`));
      all.entities = all.entities.filter((r) => kindOf(text(r, "type"), text(r, "vault_id") as Hex) !== "vault" || live.has(`${text(r, "vault_id")}:${r.creator.toLowerCase()}`));
    }
  }
  const kindRow = (r: Row) => kindOf(text(r, "type"), text(r, "vault_id") as Hex);
  const beatOf = new Map<string, bigint>();
  for (const h of all.entities.filter((r) => kindRow(r) === "heartbeat")) {
    const id = `${text(h, "vault_id")}:${h.creator.toLowerCase()}`;
    if ((beatOf.get(id) ?? 0n) < h.expiresAt) beatOf.set(id, h.expiresAt);
  }
  // Release rows per vault; only the ones that pass the vault page's checks count toward its phase.
  const releaseRows = new Map<string, Row[]>();
  for (const r of all.entities.filter((r) => kindRow(r) === "release")) releaseRows.set(text(r, "vault_id"), [...(releaseRows.get(text(r, "vault_id")) ?? []), r]);
  return {
    head: all.blockNumber,
    vaults: all.entities.filter((r) => kindRow(r) === "vault").map((r) => {
      // Unlisted vaults keep these numbers only in the manifest.
      let m: Partial<Manifest> = {};
      try {
        m = JSON.parse(new TextDecoder().decode(r.payload));
      } catch {}
      return {
        key: r.key,
        vaultId: text(r, "vault_id") as Hex,
        creator: getAddress(r.creator),
        k: Number.isFinite(num(r, "k")) ? num(r, "k") : Number(m.k ?? 0),
        n: Number.isFinite(num(r, "n")) ? num(r, "n") : Number(m.n ?? 0),
        mode: text(r, "mode") || String(m.release?.mode ?? ""),
        createdAt: r.createdAt,
        graceS: Number.isFinite(num(r, "grace_s")) ? num(r, "grace_s") : Number(m.grace_s ?? 0),
        heartbeatExpiresAt: beatOf.get(`${text(r, "vault_id")}:${r.creator.toLowerCase()}`) ?? null,
        releases: countValidReleases(m, releaseRows.get(text(r, "vault_id")) ?? []),
        // Size and seal time straight from typed attributes on listed vaults; unlisted ones keep them in the manifest.
        chunks: Number.isFinite(num(r, "chunks")) ? num(r, "chunks") : Number(m.chunks?.count ?? 0),
        sealedAtMs: Number.isFinite(num(r, "sealed_at_ms")) ? num(r, "sealed_at_ms") : Number(m.sealed_at_ms ?? 0),
      };
    }),
  };
}

/** Envelopes addressed to one custodian key, across every vault. */
export async function envelopesFor(client: PublicClient, custodian: Hex) {
  const { rows } = await fetchAll(client.select({ key: true, creator: true, createdAt: true, attributes: true }).where(eq("custodian", addrAttr(custodian))).limit(200) as unknown as Pageable, { max: 2000 });
  return rows.filter((r) => kindOf(text(r, "type"), text(r, "vault_id") as Hex) === "envelope").map((r) => ({ key: r.key, vaultId: text(r, "vault_id") as Hex, creator: getAddress(r.creator), slot: num(r, "slot"), createdAt: r.createdAt }));
}

/** The exact query strings a reader can paste anywhere to check a vault without this app. */
export function verificationQueries(vaultId: Hex, creator: Hex) {
  const base = `vault_id = bytes32(${vaultId})`;
  return {
    everything: `${base} AND NOT (type = str('chunk'))`,
    heartbeat: `${base} AND type = str('heartbeat') AND $creator = addr(${creator})`,
    releases: `${base} AND type = str('release')`,
    chunks: `${base} AND type = str('chunk') AND $creator = addr(${creator})`,
  };
}

export type ReleasedVault = { vaultId: Hex; creator: Hex; pieces: number; ignored: number; firstBlock: bigint };

/**
 * Released evidence, found from the chain alone: every release carries the project tag and its vault's creator,
 * even when the vault was unlisted while alive. Each vault's manifest is read too, so `pieces` counts only releases
 * that pass the vault page's checks and `ignored` counts the rest (forgeries, duplicates, bad shares).
 */
export async function listReleased(client: PublicClient): Promise<ReleasedVault[]> {
  const { rows } = await fetchAll(client.select({ creator: true, createdAt: true, attributes: true, payload: true }).where(eq("project", str(PROJECT)), eq("type", str("release"))).limit(200) as unknown as Pageable, { max: 2000 });
  const by = new Map<string, { vaultId: Hex; creator: Hex; rows: Row[]; firstBlock: bigint }>();
  for (const r of rows) {
    const creator = r.attributes.vault_creator?.value as Hex | undefined;
    if (!creator) continue;
    const id = `${text(r, "vault_id")}:${creator.toLowerCase()}`;
    const cur = by.get(id) ?? { vaultId: text(r, "vault_id") as Hex, creator: getAddress(creator), rows: [], firstBlock: r.createdAt };
    cur.rows.push(r);
    if (r.createdAt < cur.firstBlock) cur.firstBlock = r.createdAt;
    by.set(id, cur);
  }
  const out = await Promise.all(
    [...by.values()].map(async (v) => {
      // One small query per vault: its manifest, written by the vault's creator (listed or unlisted type tag).
      let manifest: Partial<Manifest> | null = null;
      try {
        const page = await client
          .select({ payload: true, creator: true })
          .where(eq("vault_id", bytes32(v.vaultId)), or(eq("type", str("vault")), eq("type", str(kindTag(v.vaultId, "vault")))))
          .createdBy(v.creator)
          .limit(1)
          .fetch();
        const row = page.entities[0];
        if (row) manifest = JSON.parse(new TextDecoder().decode(row.payload));
      } catch {}
      const pieces = countValidReleases(manifest, v.rows);
      return { vaultId: v.vaultId, creator: v.creator, pieces, ignored: v.rows.length - pieces, firstBlock: v.firstBlock };
    }),
  );
  return out.sort((a, b) => Number(b.firstBlock - a.firstBlock));
}

/**
 * Entities a given wallet may extend: the activist can extend what it still owns plus anything permissionless;
 * anyone else only the permissionless ones. Chunks are read here with a light query (no payload), so a check-in
 * carries the ciphertext forward too and never includes a key whose extension would revert the whole batch.
 */
export async function extendableKeys(client: PublicClient, view: VaultView, who: "activist" | "anyone"): Promise<{ key: Hex; expiresAt: bigint }[]> {
  const { rows } = await fetchAll(
    client
      .select({ key: true, owner: true, expiresAt: true, creationFlags: true })
      .where(eq("vault_id", bytes32(view.vaultId)), or(eq("type", str("chunk")), eq("type", str(kindTag(view.vaultId, "chunk")))))
      .createdBy(view.creator)
      .limit(200) as unknown as Pageable,
  );
  const chunks = rows.map((r) => ({ key: r.key, expiresAt: r.expiresAt, owner: r.owner, permissionless: r.creationFlags.permissionlessExtension }));
  return [...view.sealedKeys, ...chunks]
    .filter((e) => e.permissionless || (who === "activist" && same(e.owner, view.creator)))
    .map((e) => ({ key: e.key, expiresAt: e.expiresAt }));
}

/** `duePassed`: the reply deadline (the payload's due block) is behind the head. `expired`: the appeal windows have closed too. */
export type RtiView = { record: RtiRecord | null; rejected: { key: Hex; reason: string }[]; head: bigint; duePassed: boolean; expired: boolean; createdMs: number | null; dueMs: number | null };

/**
 * Finds the timestamp record for a commitment (from the filer's receipt or link). While it lives, one query finds
 * it. Once it has expired, pass `atBlock` (any block in its life, such as its creation block) to read it as it stood.
 */
export async function loadRti(client: PublicClient, commitment: Hex, opts: { atBlock?: bigint } = {}): Promise<RtiView> {
  const head = await client.getBlockNumber();
  const q = client.select({ key: true, owner: true, creator: true, createdAt: true, expiresAt: true, creationFlags: true, payload: true }).where(eq("type", str(rtiTag(commitment)))).limit(50);
  const { rows } = await fetchAll<RtiRow>(q as unknown as Pageable, { atBlock: opts.atBlock !== undefined && opts.atBlock < head ? opts.atBlock : undefined });
  const { record, rejected } = assembleRti(rows, commitment);
  if (!record) return { record, rejected, head, duePassed: false, expired: false, createdMs: null, dueMs: null };
  const block = await client.getBlock({ blockNumber: record.createdAt });
  const createdMs = Number(block.timestamp) * 1000;
  return { record, rejected, head, duePassed: record.dueBlock <= head, expired: record.expiresAt <= head, createdMs, dueMs: createdMs + Number(record.dueBlock - record.createdAt) * BLOCK_SECONDS * 1000 };
}
