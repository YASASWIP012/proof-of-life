import { secp256k1 } from "@noble/curves/secp256k1.js";
import { describe, expect, it } from "vitest";
import {
  attrs, beatPayload, sealOwner, SEAL_ADDRESS, bytesToHex, classifyToken, kindOf, kindTag, newBeatTokens, openKeyBackup, randomBytes, readBeatToken, sealBlob,
  utf8, wrapKey, BEAT_SLOT_BYTES,
} from "../src/index.js";

const vaultId = bytesToHex(randomBytes(32));
const custodian = () => {
  const secret = secp256k1.utils.randomSecretKey();
  return { secret, pub: bytesToHex(secp256k1.getPublicKey(secret, true)) };
};

describe("unlisted vaults leave nothing to enumerate", () => {
  const unlisted = [
    attrs.vault({ vaultId, k: 2, n: 3, mode: "public", intervalS: 86400, graceS: 3600, chunks: 1, sealedAtMs: 1, listed: false }),
    attrs.chunk(vaultId, 0, false),
    attrs.envelope(vaultId, 1, "0x0000000000000000000000000000000000000001", false),
    attrs.heartbeat(vaultId, 86400, 3600, false),
    attrs.ack(vaultId, 1, false),
    attrs.beat(vaultId, false),
  ];

  it("carries no project tag and no number to range over", () => {
    for (const a of unlisted) {
      expect(Object.keys(a)).not.toContain("project");
      for (const k of ["k", "n", "idx", "slot", "interval_s", "grace_s", "sealed_at_ms", "chunks", "mode", "v"]) expect(Object.keys(a)).not.toContain(k);
    }
  });

  it("seals to the vault's own unspendable address, so an owner query for 0x…dEaD misses it", () => {
    const other = bytesToHex(randomBytes(32));
    expect(sealOwner(vaultId, true)).toBe(SEAL_ADDRESS);
    expect(sealOwner(vaultId, false)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(sealOwner(vaultId, false)).not.toBe(SEAL_ADDRESS.toLowerCase());
    expect(sealOwner(vaultId, false)).toBe(sealOwner(vaultId, false));
    expect(sealOwner(vaultId, false)).not.toBe(sealOwner(other, false));
  });

  it("hashes the type with the vault id, so the same kind differs between vaults", () => {
    const other = bytesToHex(randomBytes(32));
    expect(kindTag(vaultId, "vault")).not.toBe(kindTag(other, "vault"));
    expect(kindTag(vaultId, "vault")).not.toContain("vault");
    expect(kindOf(kindTag(vaultId, "heartbeat"), vaultId)).toBe("heartbeat");
    expect(kindOf("heartbeat", vaultId)).toBe("heartbeat");
  });
});

describe("duress check-ins", () => {
  const cs = [custodian(), custodian(), custodian()];
  const tokens = newBeatTokens();

  it("look the same on chain whether ok or forced", () => {
    const ok = beatPayload(vaultId, cs.map((c) => c.pub), tokens.ok);
    const forced = beatPayload(vaultId, cs.map((c) => c.pub), tokens.duress);
    expect(ok.length).toBe(forced.length);
    expect(ok.length).toBe(cs.length * BEAT_SLOT_BYTES);
    expect(bytesToHex(ok)).not.toBe(bytesToHex(forced));
  });

  it("tell each custodian which one it was, and nobody else", () => {
    const forced = beatPayload(vaultId, cs.map((c) => c.pub), tokens.duress);
    for (const [i, c] of cs.entries()) expect(classifyToken(readBeatToken(vaultId, forced, i + 1, c.secret), tokens)).toBe("duress");
    const ok = beatPayload(vaultId, cs.map((c) => c.pub), tokens.ok);
    expect(classifyToken(readBeatToken(vaultId, ok, 1, cs[0].secret), tokens)).toBe("ok");
    expect(readBeatToken(vaultId, forced, 1, custodian().secret)).toBeNull();
  });
});

describe("openKeyBackup", () => {
  const secret = secp256k1.utils.randomSecretKey();
  const hex = bytesToHex(secret);

  it("opens the website's v2 backup and skips the decoy blob", async () => {
    const real = await sealBlob(utf8(JSON.stringify({ secret: hex, role: "custodian", label: "", createdMs: 0 })), "correct horse battery");
    const decoy = await sealBlob(utf8(JSON.stringify({ secret: bytesToHex(randomBytes(32)), role: "custodian" })), "nobody knows this one");
    const keys = await openKeyBackup(JSON.stringify({ v: 2, blobs: [decoy, real] }), "correct horse battery");
    expect(keys).toHaveLength(1);
    expect(keys[0].secret).toEqual(secret);
    expect(keys[0].role).toBe("custodian");
  });

  it("still opens a v1 wrapped key", async () => {
    const w = await wrapKey(secret, "correct horse battery", { label: "", address: "0x1" });
    expect((await openKeyBackup(JSON.stringify(w), "correct horse battery"))[0].secret).toEqual(secret);
  });

  it("refuses a wrong passphrase and a file that is not a backup", async () => {
    const real = await sealBlob(utf8(JSON.stringify({ secret: hex })), "correct horse battery");
    await expect(openKeyBackup(JSON.stringify({ v: 2, blobs: [real] }), "wrong passphrase")).rejects.toThrow(/opens no key/);
    await expect(openKeyBackup("{}", "x")).rejects.toThrow(/not a Proof of Life key backup/);
  });
});
