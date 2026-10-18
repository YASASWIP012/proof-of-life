import { secp256k1 } from "@noble/curves/secp256k1.js";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { bytesToHex, countValidReleases, sealVault, utf8 } from "../src/index.js";

const wallet = () => {
  const secret = secp256k1.utils.randomSecretKey();
  return { pub: secp256k1.getPublicKey(secret, true), address: privateKeyToAccount(bytesToHex(secret)).address };
};

describe("countValidReleases (directory and released list)", () => {
  const cs = [wallet(), wallet(), wallet()];
  const v = sealVault({ title: "t", note: "", k: 2, files: [{ name: "a.txt", type: "text/plain", bytes: utf8("x") }], custodianPubKeys: cs.map((c) => c.pub) });
  const manifest = { vault_id: v.vaultId, commitments: v.commitments, custodians: cs.map((c, i) => ({ slot: i + 1, address: c.address, pubkey: bytesToHex(c.pub) })) };
  let at = 1n;
  const row = (slot: number, creator: string, share: Uint8Array) => ({
    key: `0x${"0".repeat(63)}${slot}` as `0x${string}`,
    owner: creator as `0x${string}`,
    creator: creator as `0x${string}`,
    createdAt: at++,
    expiresAt: 10_000n,
    creationFlags: { readonly: true, permissionlessExtension: false },
    attributes: { slot: { type: "i32", value: slot } },
    payload: utf8(JSON.stringify({ v: 1, slot, share: bytesToHex(share), sealed_to_newsroom: false, observed_lapse_block: "0" })),
  });

  it("counts a custodian's real piece once per slot", () => {
    const rows = [row(1, cs[0].address, v.shares[0]), row(3, cs[2].address, v.shares[2]), row(1, cs[0].address, v.shares[0])];
    expect(countValidReleases(manifest, rows)).toBe(2);
  });

  it("ignores a piece from a wallet that is not the slot's custodian", () => {
    const forger = wallet();
    expect(countValidReleases(manifest, [row(2, forger.address, v.shares[1])])).toBe(0);
  });

  it("ignores a share that does not match the sealed commitment", () => {
    const bad = new Uint8Array(v.shares[1]);
    bad[5] ^= 0xff;
    expect(countValidReleases(manifest, [row(2, cs[1].address, bad)])).toBe(0);
  });

  it("counts nothing without a manifest", () => {
    expect(countValidReleases(null, [row(1, cs[0].address, v.shares[0])])).toBe(0);
  });
});
