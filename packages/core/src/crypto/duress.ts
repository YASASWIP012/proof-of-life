// The covert duress signal. Every check-in carries one "beat" payload: for each custodian slot, a fixed-size
// envelope holding either OK or DURESS plus random padding, encrypted to that custodian's key. A normal check-in and
// a forced one produce payloads of identical length and shape, so nobody watching the chain can tell them apart.
import { concat, hexToBytes, randomBytes, utf8, type Hex } from "./bytes.js";
import { decryptWith, encryptTo } from "./ecies.js";

const OK = 0x00;
const DURESS = 0xd5;
const PLAIN = 16; // one flag byte + 15 random bytes
/** 33-byte ephemeral key + 12-byte nonce + 16 plaintext + 16-byte tag. */
export const BEAT_SLOT_BYTES = 33 + 12 + PLAIN + 16;

const aad = (vaultId: Hex, slot: number) => concat(utf8("proof-of-life/beat/v1"), hexToBytes(vaultId), new Uint8Array([slot]));

export function beatPayload(vaultId: Hex, custodianPubkeys: Hex[], duress: boolean): Uint8Array {
  return concat(
    ...custodianPubkeys.map((pub, i) => {
      const plain = randomBytes(PLAIN);
      plain[0] = duress ? DURESS : OK;
      return encryptTo(hexToBytes(pub), plain, aad(vaultId, i + 1));
    }),
  );
}

/** A custodian reads its own slot. Returns null if the payload is malformed or not for this key. */
export function readBeat(vaultId: Hex, payload: Uint8Array, slot: number, custodianSecret: Uint8Array): "ok" | "duress" | null {
  const start = (slot - 1) * BEAT_SLOT_BYTES;
  if (payload.length < start + BEAT_SLOT_BYTES) return null;
  try {
    const plain = decryptWith(custodianSecret, payload.subarray(start, start + BEAT_SLOT_BYTES), aad(vaultId, slot));
    return plain[0] === DURESS ? "duress" : plain[0] === OK ? "ok" : null;
  } catch {
    return null;
  }
}
