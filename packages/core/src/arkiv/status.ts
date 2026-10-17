// Pure state machine for a vault, so the web app, the CLI and the tests all agree on what a vault is doing.
import { secondsToBlocks } from "./schema.js";

export type Phase = "alive" | "overdue" | "lapsed" | "releasing" | "released";

export type StatusInput = {
  head: bigint;
  /** The heartbeat's expiry block, or null when no live heartbeat exists. */
  heartbeatExpiresAt: bigint | null;
  graceS: number;
  k: number;
  /** Number of distinct custodian slots that published a share passing its commitment. */
  validReleases: number;
};

export type Status = {
  phase: Phase;
  /** Block by which the activist should check in. Null once the heartbeat is gone. */
  dueAt: bigint | null;
  blocksToDue: bigint | null;
  blocksToLapse: bigint | null;
  releasesNeeded: number;
  /** Shares published while the heartbeat still beats: custodians broke the rules, and readers should see it. */
  earlyRelease: boolean;
};

export function vaultStatus(i: StatusInput): Status {
  const releasesNeeded = Math.max(0, i.k - i.validReleases);
  if (i.heartbeatExpiresAt === null || i.heartbeatExpiresAt <= i.head) {
    const phase: Phase = releasesNeeded === 0 ? "released" : i.validReleases > 0 ? "releasing" : "lapsed";
    return { phase, dueAt: null, blocksToDue: null, blocksToLapse: null, releasesNeeded, earlyRelease: false };
  }
  const dueAt = i.heartbeatExpiresAt - secondsToBlocks(i.graceS);
  return {
    phase: i.head < dueAt ? "alive" : "overdue",
    dueAt,
    blocksToDue: dueAt - i.head,
    blocksToLapse: i.heartbeatExpiresAt - i.head,
    releasesNeeded,
    earlyRelease: i.validReleases > 0,
  };
}

/** A custodian may publish its share only after the heartbeat is gone. */
export const mayRelease = (s: Status): boolean => s.phase === "lapsed" || s.phase === "releasing";
