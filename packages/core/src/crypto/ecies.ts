// Encrypts to a secp256k1 public key: ephemeral ECDH, HKDF-SHA256, AES-256-GCM.
// Custodian keys are ordinary Ethereum keys, so one key both signs Arkiv writes and opens envelopes.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { open, seal } from "./aead.js";
import { concat, utf8 } from "./bytes.js";

const INFO = utf8("dhadkan/ecies/v1");
const PUB = 33;

function deriveKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  // shared is the compressed point; drop the parity byte and keep x
  return hkdf(sha256, shared.subarray(1), concat(ephPub, recipientPub), INFO, 32);
}

export function compressPublicKey(pub: Uint8Array): Uint8Array {
  return secp256k1.Point.fromBytes(pub).toBytes(true);
}

export function encryptTo(recipientPub: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  const recipient = compressPublicKey(recipientPub);
  const eph = secp256k1.utils.randomSecretKey();
  const ephPub = secp256k1.getPublicKey(eph, true);
  const key = deriveKey(secp256k1.getSharedSecret(eph, recipient, true), ephPub, recipient);
  eph.fill(0);
  return concat(ephPub, seal(key, plaintext, aad));
}

export function decryptWith(secretKey: Uint8Array, envelope: Uint8Array, aad?: Uint8Array): Uint8Array {
  const ephPub = envelope.subarray(0, PUB);
  const recipient = secp256k1.getPublicKey(secretKey, true);
  const key = deriveKey(secp256k1.getSharedSecret(secretKey, ephPub, true), ephPub, recipient);
  return open(key, envelope.subarray(PUB), aad);
}
