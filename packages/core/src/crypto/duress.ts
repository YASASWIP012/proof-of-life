// The covert duress signal. Each activist key has two random 16-byte tokens, one meaning "ok" and one meaning
// "duress". Both go to every custodian inside their sealed envelope. Each check-in writes one token, encrypted to
// each custodian, into a fixed-size note. A normal and a forced check-in look identical on chain, and the token on
// the activist's phone is just random bytes: only a custodian, comparing it with its envelope, can tell which it is.
import { concat, equalBytes, hexToBytes, randomBytes, utf8, type Hex } from "./bytes.js";
import { decryptWith, encryptTo } from "./ecies.js";

export const TOKEN_BYTES = 16;
/** 33-byte ephemeral key + 12-byte nonce + 16-byte token + 16-byte tag. */
export const BEAT_SLOT_BYTES = 33 + 12 + TOKEN_BYTES + 16;

export type BeatTokens = { ok: Uint8Array; duress: Uint8Array };
export const newBeatTokens = (): BeatTokens => ({ ok: randomBytes(TOKEN_BYTES), duress: randomBytes(TOKEN_BYTES) });

const aad = (vaultId: Hex, slot: number) => concat(utf8("proof-of-life/beat/v1"), hexToBytes(vaultId), new Uint8Array([slot]));

/** The note written with a check-in: `token` encrypted to each custodian in slot order. */
export function beatPayload(vaultId: Hex, custodianPubkeys: Hex[], token: Uint8Array): Uint8Array {
  if (token.length !== TOKEN_BYTES) throw new RangeError("beat token must be 16 bytes");
  return concat(...custodianPubkeys.map((pub, i) => encryptTo(hexToBytes(pub), token, aad(vaultId, i + 1))));
}

/** A custodian decrypts its own slot of a note. Returns null if malformed or not for this key. */
export function readBeatToken(vaultId: Hex, payload: Uint8Array, slot: number, custodianSecret: Uint8Array): Uint8Array | null {
  const start = (slot - 1) * BEAT_SLOT_BYTES;
  if (payload.length < start + BEAT_SLOT_BYTES) return null;
  try {
    return decryptWith(custodianSecret, payload.subarray(start, start + BEAT_SLOT_BYTES), aad(vaultId, slot));
  } catch {
    return null;
  }
}

/** Classifies a token against the pair the custodian received in its envelope. */
export function classifyToken(token: Uint8Array | null, tokens: BeatTokens | null): "ok" | "duress" | null {
  if (!token || !tokens) return null;
  if (equalBytes(token, tokens.duress)) return "duress";
  if (equalBytes(token, tokens.ok)) return "ok";
  return null;
}
