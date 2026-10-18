import { secp256k1 } from "@noble/curves/secp256k1.js";
import { describe, expect, it } from "vitest";
import {
  checkShare, combine, DecryptError, decryptWith, encryptTo, open, openEnvelope, randomBytes, reassemble, seal,
  sealVault, split, unsealVault, unwrapKey, utf8, wrapKey, CHUNK_BYTES,
} from "../src/crypto/index.js";

const custodian = () => {
  const secret = secp256k1.utils.randomSecretKey();
  return { secret, pub: secp256k1.getPublicKey(secret, true) };
};

describe("shamir", () => {
  it("rebuilds the secret from every k-subset and not from fewer", () => {
    const secret = randomBytes(32);
    const shares = split(secret, 3, 5);
    for (let a = 0; a < 5; a++)
      for (let b = a + 1; b < 5; b++)
        for (let c = b + 1; c < 5; c++) expect(combine([shares[a], shares[b], shares[c]])).toEqual(secret);
    expect(combine([shares[0], shares[1]])).not.toEqual(secret);
  });

  it("matches a known GF(256) result", () => {
    // f(x) = 0x53 + 0xca*x over the AES field: f(1) = 0x99, f(2) = 0x53 ^ (0xca*2 = 0x8f) = 0xdc
    const s1 = new Uint8Array([1, 0x99]);
    const s2 = new Uint8Array([2, 0xdc]);
    expect(combine([s1, s2])).toEqual(new Uint8Array([0x53]));
  });

  it("rejects bad parameters and duplicate shares", () => {
    expect(() => split(randomBytes(4), 1, 3)).toThrow();
    expect(() => split(randomBytes(4), 4, 3)).toThrow();
    const shares = split(randomBytes(4), 2, 3);
    expect(() => combine([shares[0], shares[0]])).toThrow();
  });
});

describe("aead and ecies", () => {
  it("round-trips and detects tampering", () => {
    const key = randomBytes(32);
    const sealed = seal(key, utf8("hello"), utf8("aad"));
    expect(open(key, sealed, utf8("aad"))).toEqual(utf8("hello"));
    sealed[20] ^= 1;
    expect(() => open(key, sealed, utf8("aad"))).toThrow(DecryptError);
    expect(() => open(randomBytes(32), seal(key, utf8("x")))).toThrow(DecryptError);
  });

  it("only the recipient opens an envelope", () => {
    const a = custodian();
    const b = custodian();
    const env = encryptTo(a.pub, utf8("share"), utf8("ctx"));
    expect(decryptWith(a.secret, env, utf8("ctx"))).toEqual(utf8("share"));
    expect(() => decryptWith(b.secret, env, utf8("ctx"))).toThrow(DecryptError);
    expect(() => decryptWith(a.secret, env, utf8("other"))).toThrow(DecryptError);
  });
});

describe("keystore", () => {
  it("wraps and unwraps with the right passphrase only", async () => {
    const secret = randomBytes(32);
    const w = await wrapKey(secret, "correct horse battery", { label: "phone", address: "0xabc" });
    expect(await unwrapKey(w, "correct horse battery")).toEqual(secret);
    await expect(unwrapKey(w, "wrong passphrase")).rejects.toThrow(DecryptError);
    await expect(unwrapKey({ ...w, address: "0xdef" }, "correct horse battery")).rejects.toThrow(DecryptError);
  }, 30_000);
});

describe("vault", () => {
  const files = [
    { name: "rti-reply.pdf", type: "application/pdf", bytes: randomBytes(250_000) },
    { name: "notes.txt", type: "text/plain", bytes: utf8("synthetic test note") },
  ];
  const cs = [custodian(), custodian(), custodian()];
  const v = sealVault({ title: "Road contract", note: "test", files, k: 2, custodianPubKeys: cs.map((c) => c.pub) });

  it("chunks under the payload cap", () => {
    expect(v.chunks.length).toBeGreaterThan(1);
    for (const c of v.chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_BYTES);
  });

  it("each custodian opens only its own share, and the share matches its commitment", () => {
    const shares = cs.map((c, i) => openEnvelope(v.vaultId, i + 1, v.envelopes[i], c.secret, v.commitments[i]));
    expect(shares).toEqual(v.shares);
    expect(() => openEnvelope(v.vaultId, 2, v.envelopes[0], cs[1].secret, v.commitments[1])).toThrow();
  });

  it("k shares unseal the documents with their hashes intact", () => {
    const ct = reassemble(v.chunks, v.chunkHashes, v.ciphertextHash);
    const out = unsealVault(v.vaultId, ct, [v.shares[2], v.shares[0]]);
    expect(out.verified).toBe(true);
    expect(out.bundle.title).toBe("Road contract");
    expect(out.files[0].bytes).toEqual(files[0].bytes);
  });

  it("fewer than k shares, a forged share, or a swapped chunk all fail", () => {
    const ct = reassemble(v.chunks, v.chunkHashes, v.ciphertextHash);
    expect(() => unsealVault(v.vaultId, ct, [v.shares[0]])).toThrow();
    const forged = v.shares[1].slice();
    forged[5] ^= 0xff;
    expect(checkShare(v.vaultId, forged, v.commitments).ok).toBe(false);
    expect(checkShare(v.vaultId, v.shares[1], v.commitments).ok).toBe(true);
    const swapped = [...v.chunks].reverse();
    expect(() => reassemble(swapped, v.chunkHashes, v.ciphertextHash)).toThrow();
  });
});

describe("keystore v2 blobs", () => {
  it("hide everything until the right passphrase", async () => {
    const { sealBlob, openBlob } = await import("../src/crypto/keystore.js");
    const b = await sealBlob(utf8('{"role":"activist"}'), "a long passphrase");
    expect(JSON.stringify(b)).not.toContain("activist");
    expect(new TextDecoder().decode(await openBlob(b, "a long passphrase"))).toBe('{"role":"activist"}');
    await expect(openBlob(b, "another passphrase")).rejects.toThrow(DecryptError);
  }, 30_000);
});

describe("covert duress signal", () => {
  it("normal and forced notes look the same; only a custodian holding the envelope tokens can tell them apart", async () => {
    const { beatPayload, readBeatToken, classifyToken, newBeatTokens, BEAT_SLOT_BYTES, bytesToHex, sealVault, openEnvelopeFull } = await import("../src/crypto/index.js");
    const cs = [custodian(), custodian(), custodian()];
    const pubs = cs.map((c) => bytesToHex(c.pub));
    const tokens = newBeatTokens();
    const v = sealVault({ title: "t", note: "", k: 2, files: [{ name: "a", type: "text/plain", bytes: utf8("x") }], custodianPubKeys: cs.map((c) => c.pub), beatTokens: tokens });
    const ok = beatPayload(v.vaultId, pubs, tokens.ok);
    const forced = beatPayload(v.vaultId, pubs, tokens.duress);
    expect(ok.length).toBe(forced.length);
    expect(ok.length).toBe(3 * BEAT_SLOT_BYTES);
    const env = openEnvelopeFull(v.vaultId, 2, v.envelopes[1], cs[1].secret, v.commitments[1]);
    expect(env.share).toEqual(v.shares[1]);
    expect(classifyToken(readBeatToken(v.vaultId, ok, 2, cs[1].secret), env.tokens)).toBe("ok");
    expect(classifyToken(readBeatToken(v.vaultId, forced, 2, cs[1].secret), env.tokens)).toBe("duress");
    expect(readBeatToken(v.vaultId, forced, 2, cs[0].secret)).toBeNull();
    // A note with a token the custodian never received means nothing.
    expect(classifyToken(readBeatToken(v.vaultId, beatPayload(v.vaultId, pubs, randomBytes(16)), 2, cs[1].secret), env.tokens)).toBeNull();
  });
});
