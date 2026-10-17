import { secp256k1 } from "@noble/curves/secp256k1.js";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { assembleVault, bytesToHex, Manifest, mayRelease, SEAL_ADDRESS, sealVault, utf8, vaultStatus, VaultNotFound } from "../src/index.js";

const wallet = () => {
  const secret = secp256k1.utils.randomSecretKey();
  return { secret, pub: bytesToHex(secp256k1.getPublicKey(secret, true)), address: privateKeyToAccount(bytesToHex(secret)).address };
};

describe("vaultStatus", () => {
  const base = { graceS: 60, k: 2, validReleases: 0 };
  it("is alive before the due block and overdue inside the grace window", () => {
    expect(vaultStatus({ ...base, head: 100n, heartbeatExpiresAt: 200n }).phase).toBe("alive");
    // grace 60 s = 30 blocks, so due at 170
    expect(vaultStatus({ ...base, head: 169n, heartbeatExpiresAt: 200n }).phase).toBe("alive");
    expect(vaultStatus({ ...base, head: 170n, heartbeatExpiresAt: 200n }).phase).toBe("overdue");
  });
  it("lapses at the expiry block and walks through releasing to released", () => {
    expect(vaultStatus({ ...base, head: 200n, heartbeatExpiresAt: 200n }).phase).toBe("lapsed");
    expect(vaultStatus({ ...base, head: 5n, heartbeatExpiresAt: null }).phase).toBe("lapsed");
    expect(vaultStatus({ ...base, head: 5n, heartbeatExpiresAt: null, validReleases: 1 }).phase).toBe("releasing");
    expect(vaultStatus({ ...base, head: 5n, heartbeatExpiresAt: null, validReleases: 2 }).phase).toBe("released");
  });
  it("flags shares published while the heartbeat still beats, and forbids releasing", () => {
    const s = vaultStatus({ ...base, head: 100n, heartbeatExpiresAt: 200n, validReleases: 1 });
    expect(s.earlyRelease).toBe(true);
    expect(mayRelease(s)).toBe(false);
    expect(mayRelease(vaultStatus({ ...base, head: 300n, heartbeatExpiresAt: 200n }))).toBe(true);
  });
});

describe("assembleVault trust rules", () => {
  const activist = wallet();
  const cs = [wallet(), wallet(), wallet()];
  const stranger = wallet();
  const sealed = sealVault({ title: "t", note: "", files: [{ name: "a.txt", type: "text/plain", bytes: utf8("synthetic") }], k: 2, custodianPubKeys: cs.map((c) => secp256k1.Point.fromHex(c.pub.slice(2)).toBytes(true)) });
  const manifest: Manifest = {
    v: 1, vault_id: sealed.vaultId, k: 2, n: 3,
    custodians: cs.map((c, i) => ({ slot: i + 1, address: c.address, pubkey: c.pub })),
    commitments: sealed.commitments,
    chunks: { count: sealed.chunks.length, hashes: sealed.chunkHashes, bytes: 10 },
    ciphertext_sha256: sealed.ciphertextHash, interval_s: 600, grace_s: 120,
    release: { mode: "public" }, sealed_at_ms: 0, tag: "test",
  };
  let n = 0;
  const row = (type: string, creator: string, extra: Record<string, unknown> = {}, payload: unknown = null, owner: string = SEAL_ADDRESS, expiresAt = 1000n) => ({
    key: `0x${(++n).toString(16).padStart(64, "0")}` as `0x${string}`,
    owner: owner as `0x${string}`,
    creator: creator as `0x${string}`,
    createdAt: BigInt(n),
    expiresAt,
    creationFlags: { readonly: true, permissionlessExtension: true },
    attributes: Object.fromEntries(Object.entries({ type, vault_id: sealed.vaultId, ...extra }).map(([k, v]) => [k, { type: "x", value: v }])),
    payload: payload === null ? new Uint8Array() : utf8(JSON.stringify(payload)),
  });
  const release = (slot: number, by: string, share: Uint8Array) =>
    row("release", by, { slot }, { v: 1, slot, share: bytesToHex(share), sealed_to_newsroom: false, observed_lapse_block: "1" });

  it("ignores a forged heartbeat, a stranger's release and a forged share", () => {
    const forgedShare = sealed.shares[1].slice();
    forgedShare[3] ^= 1;
    const rows = [
      row("vault", activist.address, {}, manifest),
      row("heartbeat", stranger.address, {}, null, stranger.address, 999_999n),
      release(1, stranger.address, sealed.shares[0]),
      release(2, cs[1].address, forgedShare),
      release(3, cs[2].address, sealed.shares[2]),
    ];
    const v = assembleVault(rows, sealed.vaultId, activist.address, 50n);
    expect(v.heartbeat).toBeNull();
    expect(v.status.phase).toBe("releasing");
    expect(v.releases.filter((r) => r.valid).map((r) => r.slot)).toEqual([3]);
    expect(v.rejected.map((r) => r.reason)).toEqual(expect.arrayContaining(["heartbeat not written by the vault's creator", "release from a wallet that is not this slot's custodian"]));
    expect(v.sealed).toBe(true);
  });

  it("counts the first valid release per slot once and reaches released at k", () => {
    const rows = [
      row("vault", activist.address, {}, manifest),
      release(1, cs[0].address, sealed.shares[0]),
      release(1, cs[0].address, sealed.shares[0]),
      release(2, cs[1].address, sealed.shares[1]),
    ];
    const v = assembleVault(rows, sealed.vaultId, activist.address, 50n);
    expect(v.releases.filter((r) => r.valid)).toHaveLength(2);
    expect(v.releases.find((r) => !r.valid)?.reason).toBe("duplicate release for this slot");
    expect(v.status.phase).toBe("released");
  });

  it("a live heartbeat from the creator keeps the vault alive; a manifest from someone else is not the vault", () => {
    const rows = [row("vault", stranger.address, {}, manifest), row("vault", activist.address, {}, manifest), row("heartbeat", activist.address, {}, null, activist.address, 500n)];
    const v = assembleVault(rows, sealed.vaultId, activist.address, 100n);
    expect(v.status.phase).toBe("alive");
    expect(v.rejected[0].reason).toBe("vault entity from a different creator");
    expect(() => assembleVault([rows[0]], sealed.vaultId, activist.address, 1n)).toThrow(VaultNotFound);
  });

  it("an unsealed manifest is reported as not sealed", () => {
    const v = assembleVault([row("vault", activist.address, {}, manifest, activist.address)], sealed.vaultId, activist.address, 1n);
    expect(v.sealed).toBe(false);
  });
});
