// What a custodian does when a heartbeat stops: open its own envelope, check the share, publish it.
import type { Hex } from "viem";
import { bytesToHex, hexToBytes } from "../crypto/bytes.js";
import { encryptTo } from "../crypto/ecies.js";
import { openEnvelope } from "../crypto/vault.js";
import type { PublicClient, WalletClient } from "./client.js";
import type { VaultView } from "./reads.js";
import { mayRelease } from "./status.js";
import { publishRelease } from "./writes.js";

export class NotYet extends Error {
  constructor(phase: string) {
    super(`the heartbeat is ${phase}; a custodian may only release after it stops`);
  }
}

export async function releaseMyShare(wallet: WalletClient, reader: PublicClient, view: VaultView, secret: Uint8Array) {
  if (!mayRelease(view.status)) throw new NotYet(view.status.phase);
  const me = wallet.account.address.toLowerCase();
  const seat = view.manifest.custodians.find((c) => c.address.toLowerCase() === me);
  if (!seat) throw new Error("this key is not a custodian of this vault");
  if (view.releases.some((r) => r.slot === seat.slot && r.valid)) throw new Error("this slot has already released");
  const env = view.envelopes.find((e) => e.slot === seat.slot);
  if (!env) throw new Error(`no envelope for slot ${seat.slot}`);
  const share = openEnvelope(view.vaultId, seat.slot, env.payload, secret, view.manifest.commitments[seat.slot - 1] as Hex);
  const toNewsroom = view.manifest.release.mode === "newsroom";
  const body = toNewsroom ? encryptTo(hexToBytes(view.manifest.release.newsroom_pubkey!), share) : share;
  return publishRelease(wallet, reader, {
    vaultId: view.vaultId,
    payload: { v: 1, slot: seat.slot, share: bytesToHex(body), sealed_to_newsroom: toNewsroom, observed_lapse_block: view.head.toString() },
  });
}
