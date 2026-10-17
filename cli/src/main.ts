// dhadkan: read, watch, release and open vaults from a terminal, with no website involved.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  ackCustody, listVaults, loadCiphertext, loadVault, releaseMyShare, socketClient, publicClient, unsealVault, unwrapKey,
  vaultStatus, walletClient, watchVault, BLOCK_SECONDS, type VaultView, type WrappedKey,
} from "@dhadkan/core";
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

async function loadKey(): Promise<{ account: ReturnType<typeof privateKeyToAccount>; secret: Uint8Array }> {
  const file = flag("key-file");
  if (!file) throw new Error("--key-file <backup.json> is required");
  const wrapped = JSON.parse(readFileSync(file, "utf8")) as WrappedKey;
  let pass = process.env.DHADKAN_PASSPHRASE;
  if (!pass) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    pass = await rl.question("passphrase: ");
    rl.close();
  }
  const secret = await unwrapKey(wrapped, pass);
  return { account: privateKeyToAccount(bytesToHex(secret)), secret };
}

async function main() {
  const [cmd, vaultId, creator] = args as [string, Hex, Hex];
  switch (cmd) {
    case "vaults": {
      const { head, vaults } = await listVaults(reader);
      for (const v of vaults) {
        const s = vaultStatus({ head, heartbeatExpiresAt: v.heartbeatExpiresAt, graceS: v.graceS, k: v.k, validReleases: v.releases });
        log(`${s.phase.padEnd(9)} ${v.vaultId} ${v.creator} ${v.k}/${v.n}`);
      }
      return 0;
    }
    case "status": {
      const v = await loadVault(reader, vaultId, creator);
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
      const { account, secret } = await loadKey();
      const v = await loadVault(reader, vaultId, creator);
      const r = await releaseMyShare(walletClient(account, { rpc }), reader, v, secret);
      log(`piece published: ${r.txHash}`);
      return 0;
    }
    case "ack": {
      const { account } = await loadKey();
      const v = await loadVault(reader, vaultId, creator);
      const seat = v.manifest.custodians.find((c) => c.address.toLowerCase() === account.address.toLowerCase());
      if (!seat) throw new Error("this key is not a custodian of this vault");
      const r = await ackCustody(walletClient(account, { rpc }), { vaultId, slot: seat.slot, existingKey: v.acks.find((a) => a.slot === seat.slot)?.key });
      log(`custody confirmed: ${r.txHash}`);
      return 0;
    }
    case "watch": {
      // A custodian's watcher: follows check-ins over a WebSocket, renews custody, and releases on lapse.
      const auto = has("auto-release");
      const key = flag("key-file") ? await loadKey() : null;
      const sock = socketClient({ ws });
      let v = await loadVault(reader, vaultId, creator);
      printVault(v);
      let stop = () => {};
      const arm = () => {
        stop();
        stop = watchVault(sock, { heartbeatKey: v.heartbeat?.key ?? null, custodians: v.manifest.custodians.map((c) => c.address as Hex), creator, lapseInBlocks: v.status.blocksToLapse }, async (s) => {
          if (s.kind === "checkin") log(`${new Date().toISOString()} check-in at block ${s.blockNumber}`);
          if (s.kind === "activity") log(`${new Date().toISOString()} custodian activity at block ${s.blockNumber}`);
          v = await loadVault(reader, vaultId, creator);
          log(`${new Date().toISOString()} phase ${v.status.phase}`);
          if (v.status.phase === "overdue") log("OVERDUE: try to reach the activist now.");
          if (key && auto && (v.status.phase === "lapsed" || v.status.phase === "releasing")) {
            try {
              const r = await releaseMyShare(walletClient(key.account, { rpc }), reader, v, key.secret);
              log(`released my piece: ${r.txHash}`);
            } catch (e) {
              log(`release: ${(e as Error).message}`);
            }
          }
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
      log(`dhadkan: dead-hand vaults on Arkiv

  dhadkan vaults                                   list every vault and its phase
  dhadkan status  <vault_id> <creator>             phase, deadlines, custodians (exit 0 alive, 1 overdue, 2 lapsed, 3 releasing, 4 released)
  dhadkan watch   <vault_id> <creator> [--key-file f --auto-release]
  dhadkan ack     <vault_id> <creator> --key-file f   confirm or renew custody
  dhadkan release <vault_id> <creator> --key-file f   publish your piece (only after the heartbeat stops)
  dhadkan open    <vault_id> <creator> [--out dir]    rebuild the key and decrypt a released vault

  --rpc <url> / --ws <url>   any Arkiv endpoint (default: Tiramisu public RPC)
  DHADKAN_PASSPHRASE         passphrase for --key-file, instead of a prompt`);
      return 0;
  }
}

main().then((code) => code !== undefined && process.exit(code), (e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(10);
});
