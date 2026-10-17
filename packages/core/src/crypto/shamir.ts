// Shamir secret sharing over GF(2^8), the AES field (x^8 + x^4 + x^3 + x + 1).
// A share is [x, y_0 .. y_{n-1}]: one evaluation point and one byte per secret byte.
import { randomBytes } from "./bytes.js";

const EXP = new Uint8Array(510);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // multiply by the generator 3: x*2 xor x, reduced by the field polynomial
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
  }
  for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];
}

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a: number, b: number): number => {
  if (b === 0) throw new RangeError("division by zero in GF(256)");
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]];
};

export class ShamirError extends Error {}

/** Splits `secret` into `n` shares, any `k` of which rebuild it. */
export function split(secret: Uint8Array, k: number, n: number): Uint8Array[] {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 2 || n < k || n > 255) {
    throw new ShamirError(`need 2 <= k <= n <= 255, got k=${k} n=${n}`);
  }
  if (secret.length === 0) throw new ShamirError("empty secret");
  const shares = Array.from({ length: n }, (_, i) => {
    const s = new Uint8Array(secret.length + 1);
    s[0] = i + 1;
    return s;
  });
  const coeffs = new Uint8Array(k);
  for (let byte = 0; byte < secret.length; byte++) {
    coeffs[0] = secret[byte];
    coeffs.set(randomBytes(k - 1), 1);
    for (const share of shares) {
      // Horner's rule at x = share[0]
      let y = 0;
      for (let c = k - 1; c >= 0; c--) y = mul(y, share[0]) ^ coeffs[c];
      share[byte + 1] = y;
    }
  }
  coeffs.fill(0);
  return shares;
}

/** Rebuilds the secret from at least k distinct shares (Lagrange interpolation at x = 0). */
export function combine(shares: Uint8Array[]): Uint8Array {
  if (shares.length < 2) throw new ShamirError("need at least two shares");
  const len = shares[0].length;
  const xs = new Set<number>();
  for (const s of shares) {
    if (s.length !== len || len < 2) throw new ShamirError("shares have different lengths");
    if (s[0] === 0 || xs.has(s[0])) throw new ShamirError("duplicate or invalid share index");
    xs.add(s[0]);
  }
  const secret = new Uint8Array(len - 1);
  for (let byte = 0; byte < len - 1; byte++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      let basis = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        // l_i(0) = prod x_j / (x_j - x_i); subtraction is xor in GF(2^8)
        basis = mul(basis, div(shares[j][0], shares[j][0] ^ shares[i][0]));
      }
      acc ^= mul(shares[i][byte + 1], basis);
    }
    secret[byte] = acc;
  }
  return secret;
}
