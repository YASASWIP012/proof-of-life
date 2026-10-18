// proof-of-life: read, watch, release and open vaults from a terminal, with no website involved.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  ackCustody, duressSignal, isListed, listReleased, listVaults, loadCiphertext, loadVault, openKeyBackup, releaseMyShare, socketClient, publicClient,
  unsealVault, vaultStatus, walletClient, watchVault, BLOCK_SECONDS, type VaultView,
} from "@proof-of-life/core";
import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex, type Hex } from "viem";

const EXIT = { alive: 0, overdue: 1, lapsed: 2, releasing: 3, released: 4 } as const;
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const rpc = flag("rpc") ?? process.env.ARKIV_RPC;
const ws = flag("ws") ?? process.env.ARKIV_WS;
const reader = publicClient({ rpc });

const fmt = (s: number) => {
  s = Math.max(0, Math.round(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};
const blocks = (b: bigint) => fmt(Number(b) * BLOCK_SECONDS);
const log = (...x: unknown[]) => console.log(...x);

function printVault(v: VaultView) {
  const m = v.manifest;
  log(`vault      ${v.vaultId}`);
  log(`creator    ${v.creator}`);
  log(`phase      ${v.status.phase.toUpperCase()}${v.status.earlyRelease ? "  (WARNING: a piece was published early)" : ""}`);
  if (v.status.blocksToDue !== null) log(`due in     ${blocks(v.status.blocksToDue)}   stops in ${blocks(v.status.blocksToLapse!)}`);
  log(`rhythm     every ${fmt(m.interval_s)}, grace ${fmt(m.grace_s)}`);
  log(`release    ${m.k} of ${m.n} custodians, ${m.release.mode}`);
  log(`sealed     ${v.sealed ? "yes: read-only, owned by 0x…dEaD" : "NO"}`);
  for (const c of m.custodians) {
    const ack = v.acks.find((a) => a.slot === c.slot);
    const rel = v.releases.find((r) => r.slot === c.slot && r.valid);
    log(`  slot ${c.slot}  ${c.address}  ${rel ? "PIECE PUBLISHED" : ack ? `holding key (${blocks(ack.expiresAt - v.head)} left)` : "not confirmed"}`);
  }
  for (const r of v.rejected) log(`  ignored ${r.kind} ${r.key.slice(0, 12)}…  ${r.reason}`);
}

type Seat = { account: ReturnType<typeof privateKeyToAccount>; secret: Uint8Array; slot: number };

/** Opens the backup (any version) and returns the key that holds a seat in this vault. */
async function loadSeat(v: VaultView): Promise<Seat> {
  const file = flag("key-file");
  if (!file) throw new Error("--key-file <backup.json> is required");
  let pass = process.env.POL_PASSPHRASE;
  if (!pass) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    pass = await rl.question("passphrase: ");
    rl.close();
  }
  for (const k of await openKeyBackup(readFileSync(file, "utf8"), pass)) {
    const account = privateKeyToAccount(bytesToHex(k.secret));
    const seat = v.manifest.custodians.find((c) => c.address.toLowerCase() === account.address.toLowerCase());
    if (seat) return { account, secret: k.secret, slot: seat.slot };
  }
  throw new Error("no key in this backup is a custodian of this vault");
}

/** Renews this custodian's 14-day lease when it is missing or has under four days left. */
async function renewIfDue(v: VaultView, me: Seat) {
  const ack = v.acks.find((a) => a.slot === me.slot);
  if (ack && Number(ack.expiresAt - v.head) * BLOCK_SECONDS > 4 * 86400) return;
  const r = await ackCustody(walletClient(me.account, { rpc }), { vaultId: v.vaultId, slot: me.slot, existingKey: ack?.key, listed: isListed(v.manifest) });
  log(`custody ${ack ? "renewed" : "confirmed"}: ${r.txHash}`);
}

/** One pass of a custodian's duty: report, renew custody, and publish this piece on a lapse or a duress check-in. */
async function duty(v: VaultView, me: Seat | null, auto: boolean): Promise<boolean> {
  if (v.status.phase === "overdue") log("OVERDUE: try to reach the activist now.");
  const duress = !!me && duressSignal(v, me.slot, me.secret) === "duress";
  if (duress) log("DURESS: the activist's last check-in used the duress passphrase.");
  if (!me) return duress;
  const released = v.releases.some((r) => r.slot === me.slot && r.valid);
  if (auto && !released && (v.status.phase === "lapsed" || v.status.phase === "releasing" || duress)) {
    try {
      const r = await releaseMyShare(walletClient(me.account, { rpc }), reader, v, me.secret);
      log(`released my piece: ${r.txHash}`);
    } catch (e) {
      log(`release: ${(e as Error).message}`);
    }
  } else if (v.status.phase === "alive" || v.status.phase === "overdue") {
    await renewIfDue(v, me).catch((e) => log(`renew: ${(e as Error).message}`));
  }
  return duress;
}

async function main() {
  const [cmd, vaultId, creator] = args as [string, Hex, Hex];
  switch (cmd) {
    case "vaults": {
      const days = (f: string) => (flag(f) ? Number(String(flag(f)).replace(/d$/, "")) * 86_400 : undefined);
      const { head, vaults } = await listVaults(reader, { stopsWithinS: days("stops-within"), rhythmAtLeastS: days("rhythm-at-least") });
      for (const v of vaults) {
        const s = vaultStatus({ head, heartbeatExpiresAt: v.heartbeatExpiresAt, graceS: v.graceS, k: v.k, validReleases: v.releases });
        log(`${s.phase.padEnd(9)} ${v.vaultId} ${v.creator} ${v.k}/${v.n}`);
      }
      return 0;
    }
    case "released": {
      // Released evidence, found from the chain alone, including vaults that were unlisted while alive.
      for (const r of await listReleased(reader)) log(`${r.vaultId} ${r.creator} pieces ${r.pieces} first at block ${r.firstBlock}`);
      return 0;
    }
    case "status": {
      const at = flag("at");
      const v = await loadVault(reader, vaultId, creator, at ? { atBlock: BigInt(at) } : {});
      if (at) log(`as of block ${at}`);
      printVault(v);
      return EXIT[v.status.phase];
    }
    case "open": {
      const v = await loadVault(reader, vaultId, creator);
      const shares = v.releases.filter((r) => r.valid && r.share).map((r) => r.share!);
      if (shares.length < v.manifest.k) throw new Error(`only ${shares.length} of ${v.manifest.k} pieces are public`);
      const { ciphertext } = await loadCiphertext(reader, v);
      const out = unsealVault(v.vaultId, ciphertext, shares);
      const dir = flag("out") ?? `vault-${vaultId.slice(2, 10)}`;
      mkdirSync(dir, { recursive: true });
      for (const f of out.files) writeFileSync(join(dir, f.name.replace(/[/\\]/g, "_")), f.bytes);
      log(`${out.files.length} file(s) written to ${dir}. Hashes ${out.verified ? "match" : "DO NOT match"} the sealed manifest.`);
      log(`title: ${out.bundle.title}`);
      return out.verified ? 0 : 5;
    }
    case "release": {
      const v = await loadVault(reader, vaultId, creator);
      const me = await loadSeat(v);
      const r = await releaseMyShare(walletClient(me.account, { rpc }), reader, v, me.secret);
      log(`piece published: ${r.txHash}`);
      return 0;
    }
    case "ack": {
      const v = await loadVault(reader, vaultId, creator);
      const me = await loadSeat(v);
      const r = await ackCustody(walletClient(me.account, { rpc }), { vaultId, slot: me.slot, existingKey: v.acks.find((a) => a.slot === me.slot)?.key, listed: isListed(v.manifest) });
      log(`custody confirmed: ${r.txHash}`);
      return 0;
    }
    case "watch": {
      // A custodian's watcher: follows check-ins over a WebSocket, renews custody, and releases on lapse or duress.
      // With --once it does a single pass and exits, for a scheduled job on the custodian's own account.
      const auto = has("auto-release");
      let v = await loadVault(reader, vaultId, creator);
      const me = flag("key-file") ? await loadSeat(v) : null;
      printVault(v);
      if (has("once")) {
        const duress = await duty(v, me, auto);
        // A non-zero exit fails a scheduled job, and the scheduler tells the custodian.
        return duress ? 6 : EXIT[v.status.phase];
      }
      await duty(v, me, auto);
      const sock = socketClient({ ws });
      let stop = () => {};
      const arm = () => {
        stop();
        stop = watchVault(sock, { heartbeatKey: v.heartbeat?.key ?? null, custodians: v.manifest.custodians.map((c) => c.address as Hex), creator, lapseInBlocks: v.status.blocksToLapse }, async (s) => {
          if (s.kind === "checkin") log(`${new Date().toISOString()} check-in at block ${s.blockNumber}`);
          if (s.kind === "activity") log(`${new Date().toISOString()} custodian activity at block ${s.blockNumber}`);
          v = await loadVault(reader, vaultId, creator);
          log(`${new Date().toISOString()} phase ${v.status.phase}`);
          await duty(v, me, auto);
          if (v.status.phase === "released") {
            log("released. done.");
            process.exit(EXIT.released);
          }
          arm();
        }, (e) => log(`socket: ${e.message}`));
      };
      arm();
      return new Promise<number>(() => {});
    }
    default:
      log(`proof-of-life: dead-hand vaults on Arkiv

  proof-of-life vaults [--stops-within 3d] [--rhythm-at-least 7d]
                                                         list listed vaults and their phase; the filters are range queries run on the node
  proof-of-life released                                 list released evidence, including vaults unlisted while alive
  proof-of-life status  <vault_id> <creator> [--at N]    phase, deadlines, custodians (exit 0 alive, 1 overdue, 2 lapsed, 3 releasing, 4 released); --at reads it as of block N
  proof-of-life watch   <vault_id> <creator> [--key-file f --auto-release --once]
                                                         follow the vault; renew custody; publish your piece on a lapse or duress.
                                                         --once: one pass, then exit (6 on duress), for a scheduled job
  proof-of-life ack     <vault_id> <creator> --key-file f   confirm or renew custody
  proof-of-life release <vault_id> <creator> --key-file f   publish your piece (only after the heartbeat stops)
  proof-of-life open    <vault_id> <creator> [--out dir]    rebuild the key and decrypt a released vault

  --rpc <url> / --ws <url>   any Arkiv endpoint (default: Tiramisu public RPC)
  POL_PASSPHRASE         passphrase for --key-file, instead of a prompt`);
      return 0;
  }
}

main().then((code) => code !== undefined && process.exit(code), (e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(10);
});
