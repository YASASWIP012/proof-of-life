// Live updates over a WebSocket. Arkiv fires no event when an entity expires, so a lapse is caught by a timer
// set from the heartbeat's own expiry block, then confirmed with a query.
import type { Hex } from "viem";
import type { SocketClient } from "./client.js";
import { BLOCK_SECONDS } from "./schema.js";

export type VaultSignal =
  | { kind: "checkin"; blockNumber: bigint; expiresAt: bigint; txHash: Hex }
  | { kind: "activity"; blockNumber: bigint; txHash: Hex; from: Hex }
  | { kind: "deadline" };

/**
 * Watches one vault. `heartbeatKey` extensions arrive as check-ins; creations by any custodian wallet arrive
 * as activity (an acknowledgement or a release), which the caller answers with one re-query.
 */
export function watchVault(
  ws: SocketClient,
  p: { heartbeatKey: Hex | null; custodians: Hex[]; creator: Hex; lapseInBlocks: bigint | null },
  onSignal: (s: VaultSignal) => void,
  onError: (e: Error) => void = () => {},
): () => void {
  const watched = new Set([...p.custodians, p.creator].map((a) => a.toLowerCase()));
  const unwatch = ws.watchEntityEvents({
    onExpiryExtended: (e) => {
      if (p.heartbeatKey && e.entityKey.toLowerCase() === p.heartbeatKey.toLowerCase()) {
        onSignal({ kind: "checkin", blockNumber: e.blockNumber, expiresAt: e.expiresAt, txHash: e.transactionHash });
      }
    },
    onEntityCreated: (e) => {
      if (watched.has(e.owner.toLowerCase())) onSignal({ kind: "activity", blockNumber: e.blockNumber, txHash: e.transactionHash, from: e.owner });
    },
    onEntityDeleted: (e) => {
      if (p.heartbeatKey && e.entityKey.toLowerCase() === p.heartbeatKey.toLowerCase()) onSignal({ kind: "deadline" });
    },
    onError,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (p.lapseInBlocks !== null) {
    const ms = Number(p.lapseInBlocks) * BLOCK_SECONDS * 1000 + 1500;
    // setTimeout overflows past ~24.8 days; a page open that long re-arms on its next reload
    if (ms < 2 ** 31 - 1) timer = setTimeout(() => onSignal({ kind: "deadline" }), ms);
  }
  return () => {
    unwatch();
    if (timer) clearTimeout(timer);
  };
}
