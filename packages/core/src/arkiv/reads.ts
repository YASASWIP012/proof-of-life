// Reading a vault. Trust never comes from an attribute: every entity is checked against its on-chain $creator.
import { bytes32, str, addr as addrAttr } from "@arkiv-network/sdk/attr";
import { eq, not } from "@arkiv-network/sdk/query";
import type { Hex } from "viem";
import { getAddress } from "viem";
import { hexToBytes } from "../crypto/bytes.js";
import { checkShare, reassemble } from "../crypto/vault.js";
import type { PublicClient } from "./client.js";
import { Manifest, PROJECT, ReleasePayload, SEAL_ADDRESS } from "./schema.js";
import { vaultStatus, type Status } from "./status.js";

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
  envelopes: { key: Hex; slot: number; custodian: Hex; expiresAt: bigint; sealed: boolean; payload: Uint8Array }[];
  acks: { key: Hex; slot: number; custodian: Hex; expiresAt: bigint }[];
  releases: ReleaseView[];
  status: Status;
  /** Entities that claim to belong to this vault but fail a trust check. Shown, never used. */
  rejected: Rejected[];
  /** Keys of sealed entities, for keep-alive and check-in carry-forward. */
  sealedKeys: { key: Hex; expiresAt: bigint }[];
};

const isSealed = (r: Row) => r.creationFlags.readonly && same(r.owner, SEAL_ADDRESS);

/** One query loads everything but the ciphertext, which keeps a page view inside the keyless read budget. */
export async function loadVault(client: PublicClient, vaultId: Hex, creator: Hex): Promise<VaultView> {
  const rows: Row[] = [];
  let page = await client
    .select(FIELDS)
    .where(eq("project", str(PROJECT)), eq("vault_id", bytes32(vaultId)), not(eq("type", str("chunk"))))
    .limit(200)
    .fetch();
  rows.push(...(page.entities as unknown as Row[]));
  while (page.hasNextPage()) {
    page = await page.next();
    rows.push(...(page.entities as unknown as Row[]));
  }
  return assembleVault(rows, vaultId, creator, page.blockNumber);
}

export class VaultNotFound extends Error {
  constructor(vaultId: string, creator: string) {
    super(`no vault ${vaultId.slice(0, 10)}… created by ${creator}`);
  }
}

/** Pure, so the trust rules can be tested without a network. */
export function assembleVault(rows: Row[], vaultId: Hex, creator: Hex, head: bigint): VaultView {
  const rejected: Rejected[] = [];
  const reject = (r: Row, reason: string) => rejected.push({ key: r.key, kind: text(r, "type"), reason });
  const byType = (t: string) => rows.filter((r) => text(r, "type") === t);

  const vaultRows = byType("vault").filter((r) => same(r.creator, creator));
  byType("vault").filter((r) => !same(r.creator, creator)).forEach((r) => reject(r, "vault entity from a different creator"));
  if (vaultRows.length === 0) throw new VaultNotFound(vaultId, creator);
  // A creator could in principle write two manifests for one id; the first one written is the vault.
  const v = vaultRows.sort((a, b) => Number(a.createdAt - b.createdAt))[0];
  vaultRows.slice(1).forEach((r) => reject(r, "second manifest for the same vault; the first one counts"));
  const manifest = Manifest.parse(JSON.parse(new TextDecoder().decode(v.payload)));
  if (!same(manifest.vault_id, vaultId)) throw new Error("manifest names a different vault id");

  const custodianOf = new Map(manifest.custodians.map((c) => [c.slot, getAddress(c.address)]));

  const heartbeats = byType("heartbeat").filter((r) => {
    if (!same(r.creator, creator)) return reject(r, "heartbeat not written by the vault's creator"), false;
    return true;
  });
  const hb = heartbeats.sort((a, b) => Number(b.expiresAt - a.expiresAt))[0] ?? null;

  const envelopes = byType("envelope").flatMap((r) => {
    if (!same(r.creator, creator)) return reject(r, "envelope not written by the vault's creator"), [];
    const slot = num(r, "slot");
    return [{ key: r.key, slot, custodian: getAddress(String(r.attributes.custodian?.value)), expiresAt: r.expiresAt, sealed: isSealed(r), payload: r.payload }];
  });

  const acks = byType("ack").flatMap((r) => {
    const slot = num(r, "slot");
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
    sealed: isSealed(v),
    heartbeat: hb ? { key: hb.key, expiresAt: hb.expiresAt, owner: hb.owner, createdAt: hb.createdAt } : null,
    envelopes,
    acks,
    releases,
    status,
    rejected,
    sealedKeys: [v, ...byType("envelope").filter((r) => same(r.creator, creator)), ...byType("release").filter((r) => releases.some((x) => x.key === r.key && x.valid))]
      .map((r) => ({ key: r.key, expiresAt: r.expiresAt })),
  };
}

/** The ciphertext, read only when someone opens a released vault. Chunks from any other creator are ignored. */
export async function loadCiphertext(client: PublicClient, view: VaultView): Promise<{ ciphertext: Uint8Array; keys: { key: Hex; expiresAt: bigint }[] }> {
  const rows: Row[] = [];
  let page = await client
    .select(FIELDS)
    .where(eq("project", str(PROJECT)), eq("vault_id", bytes32(view.vaultId)), eq("type", str("chunk")))
    .createdBy(view.creator)
    .limit(50)
    .fetch();
  rows.push(...(page.entities as unknown as Row[]));
  while (page.hasNextPage()) {
    page = await page.next();
    rows.push(...(page.entities as unknown as Row[]));
  }
  const byIdx = new Map<number, Row>();
  for (const r of rows.sort((a, b) => Number(a.createdAt - b.createdAt))) if (!byIdx.has(num(r, "idx"))) byIdx.set(num(r, "idx"), r);
  const ordered = Array.from({ length: view.manifest.chunks.count }, (_, i) => byIdx.get(i));
  const missing = ordered.flatMap((r, i) => (r ? [] : [i]));
  if (missing.length) throw new Error(`missing chunk(s) ${missing.join(", ")}: they may have expired`);
  const ciphertext = reassemble(ordered.map((r) => r!.payload), view.manifest.chunks.hashes as Hex[], view.manifest.ciphertext_sha256 as Hex);
  return { ciphertext, keys: ordered.map((r) => ({ key: r!.key, expiresAt: r!.expiresAt })) };
}

export type VaultSummary = { key: Hex; vaultId: Hex; creator: Hex; tag?: string; k: number; n: number; mode: string; createdAt: bigint; heartbeatExpiresAt: bigint | null; graceS: number; releases: number };

/** The public directory: two queries for every vault and every live heartbeat. */
export async function listVaults(client: PublicClient, opts: { creator?: Hex; limit?: number } = {}): Promise<{ head: bigint; vaults: VaultSummary[] }> {
  const q = (type: string) => {
    let b = client.select({ key: true, creator: true, createdAt: true, expiresAt: true, attributes: true }).where(eq("project", str(PROJECT)), eq("type", str(type)));
    if (opts.creator) b = b.createdBy(opts.creator);
    return b.limit(opts.limit ?? 200).fetch();
  };
  const [vaults, beats, releases] = await Promise.all([q("vault"), q("heartbeat"), q("release")]);
  const beatOf = new Map<string, bigint>();
  for (const h of beats.entities as unknown as Row[]) {
    const id = `${text(h, "vault_id")}:${h.creator.toLowerCase()}`;
    if ((beatOf.get(id) ?? 0n) < h.expiresAt) beatOf.set(id, h.expiresAt);
  }
  const releaseCount = new Map<string, number>();
  for (const r of releases.entities as unknown as Row[]) releaseCount.set(text(r, "vault_id"), (releaseCount.get(text(r, "vault_id")) ?? 0) + 1);
  return {
    head: vaults.blockNumber,
    vaults: (vaults.entities as unknown as Row[]).map((r) => ({
      key: r.key,
      vaultId: text(r, "vault_id") as Hex,
      creator: getAddress(r.creator),
      k: num(r, "k"),
      n: num(r, "n"),
      mode: text(r, "mode"),
      createdAt: r.createdAt,
      graceS: num(r, "grace_s"),
      heartbeatExpiresAt: beatOf.get(`${text(r, "vault_id")}:${r.creator.toLowerCase()}`) ?? null,
      releases: releaseCount.get(text(r, "vault_id")) ?? 0,
    })),
  };
}

/** Envelopes addressed to one custodian key, across every vault. */
export async function envelopesFor(client: PublicClient, custodian: Hex) {
  const page = await client
    .select({ key: true, creator: true, createdAt: true, attributes: true })
    .where(eq("project", str(PROJECT)), eq("type", str("envelope")), eq("custodian", addrAttr(custodian)))
    .limit(200)
    .fetch();
  return (page.entities as unknown as Row[]).map((r) => ({ key: r.key, vaultId: text(r, "vault_id") as Hex, creator: getAddress(r.creator), slot: num(r, "slot"), createdAt: r.createdAt }));
}

/** The exact query strings a reader can paste anywhere to check a vault without this app. */
export function verificationQueries(vaultId: Hex, creator: Hex) {
  const base = `project = str('${PROJECT}') AND vault_id = bytes32(${vaultId})`;
  return {
    everything: `${base} AND NOT (type = str('chunk'))`,
    heartbeat: `${base} AND type = str('heartbeat') AND $creator = addr(${creator})`,
    releases: `${base} AND type = str('release')`,
    chunks: `${base} AND type = str('chunk') AND $creator = addr(${creator})`,
  };
}
