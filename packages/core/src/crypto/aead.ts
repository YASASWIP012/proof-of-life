// AES-256-GCM with a random 96-bit nonce stored in front of the ciphertext.
import { gcm } from "@noble/ciphers/aes.js";
import { concat, randomBytes } from "./bytes.js";

const NONCE = 12;

export class DecryptError extends Error {}

export function seal(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new RangeError("AES-256 needs a 32-byte key");
  const nonce = randomBytes(NONCE);
  return concat(nonce, gcm(key, nonce, aad).encrypt(plaintext));
}

export function open(key: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (sealed.length < NONCE + 16) throw new DecryptError("ciphertext too short");
  try {
    return gcm(key, sealed.subarray(0, NONCE), aad).decrypt(sealed.subarray(NONCE));
  } catch {
    throw new DecryptError("wrong key or tampered ciphertext");
  }
}
