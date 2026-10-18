// The demo keeper. Runs every 30 minutes in GitHub Actions, far from the website:
// it checks in for the "always-alive" activist, renews custody leases, and releases any demo vault whose heartbeat stopped.
import { readFileSync } from "node:fs";
import { ackCustody, checkIn, extendableKeys, isListed, loadVault, publicClient, releaseMyShare, walletClient, type VaultView } from "@proof-of-life/core";
import { account, rpc } from "./env.js";

const reader = publicClient({ rpc });
const registry = JSON.parse(readFileSync(new URL("./demo-vaults.json", import.meta.url), "utf8")) as Record<string, { vaultId: `0x${string}`; creator: `0x${string}`; activist: number; custodians: (number | null)[]; checkIn: boolean }>;
const DAY_BLOCKS = 43_200n;

for (const [name, r] of Object.entries(registry)) {
  let v: VaultView;
  try {
    v = await loadVault(reader, r.vaultId, r.creator);
  } catch (e) {
    console.log(`${name}: ${(e as Error).message}`);
    continue;
  }
  console.log(`${name}: ${v.status.phase}`);
  if (r.checkIn && v.heartbeat && v.status.blocksToDue !== null && v.status.blocksToDue < BigInt(Math.ceil((v.manifest.interval_s * 0.6) / 2))) {
    const tx = await checkIn(walletClient(account(r.activist), { rpc }), { heartbeatKey: v.heartbeat.key, intervalS: v.manifest.interval_s, graceS: v.manifest.grace_s, sealed: await extendableKeys(reader, v, "activist"), head: v.head });
    console.log(`  checked in ${tx.txHash}`);
  }
  for (const [i, idx] of r.custodians.entries()) {
    // null marks a slot held by an outside person: the keeper never holds that key.
    if (idx === null) continue;
    const c = account(idx);
    const ack = v.acks.find((a) => a.slot === i + 1);
    const released = v.releases.some((x) => x.slot === i + 1 && x.valid);
    if ((v.status.phase === "lapsed" || v.status.phase === "releasing") && !released && i !== 1) {
      // Custodian 2 plays the one who never answers, so every demo release is 2-of-3.
      const tx = await releaseMyShare(walletClient(c, { rpc }), reader, v, c.secret);
      console.log(`  custodian ${i + 1} released ${tx.txHash}`);
      v = await loadVault(reader, r.vaultId, r.creator);
    } else if (!released && v.heartbeat && (!ack || ack.expiresAt - v.head < 5n * DAY_BLOCKS)) {
      const tx = await ackCustody(walletClient(c, { rpc }), { vaultId: r.vaultId, slot: i + 1, existingKey: ack?.key, listed: isListed(v.manifest) });
      console.log(`  custodian ${i + 1} renewed custody ${tx.txHash}`);
    }
  }
}
