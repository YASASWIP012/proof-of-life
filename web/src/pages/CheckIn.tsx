// The one screen an activist opens every week. One passphrase unlocks every key in this browser; each key's
// vault is found on Arkiv by its creator, so the phone keeps no list of vaults.
// A key opened with its duress passphrase checks in exactly like a normal one, on screen and on chain. The only
// difference is inside the check-in note, encrypted to each custodian, which tells them to release now.
import { beatPayload, checkIn, isListed, listVaults, loadVault, walletClient, type VaultView } from "@proof-of-life/core";
import type { Hex } from "viem";
import { useState } from "react";
import { Link } from "react-router-dom";
import { KeyGate } from "../components/KeyGate";
import { Pulse } from "../components/Pulse";
import { Button, Card, Notice, PhaseBadge } from "../components/ui";
import { blocksToSeconds, duration, short, vaultPath } from "../lib/format";
import type { OpenKey } from "../lib/keys";
import { read } from "../lib/net";
import { ensureGas } from "../lib/tap";

type Row = { key: OpenKey; view: VaultView };

export default function CheckIn() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async (keys: OpenKey[]) => {
    const found: Row[] = [];
    for (const key of keys) {
      const { vaults } = await read((c) => listVaults(c, { creator: key.account.address }));
      for (const v of vaults) {
        const view = await read((c) => loadVault(c, v.vaultId, v.creator)).catch(() => null);
        if (view) found.push({ key, view });
      }
    }
    setRows(found);
  };

  const beat = async () => {
    setBusy(true);
    setErr(null);
    try {
      for (const r of rows ?? []) {
        const hb = r.view.heartbeat;
        if (!hb) continue;
        await ensureGas(r.key.account.address);
        const m = r.view.manifest;
        const beat = { vaultId: r.view.vaultId, payload: beatPayload(r.view.vaultId, m.custodians.map((c) => c.pubkey as Hex), r.key.duress), listed: isListed(m) };
        await checkIn(walletClient(r.key.account), { heartbeatKey: hb.key, intervalS: m.interval_s, graceS: m.grace_s, sealed: r.view.sealedKeys, head: r.view.head, beat });
      }
      // Same words either way, by design.
      setDone(`Checked in at ${new Date().toLocaleTimeString()}. Your documents stay sealed.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!rows)
    return (
      <div className="mx-auto max-w-xl">
        <KeyGate role="activist" title="Unlock to check in" intro="One passphrase opens every vault key in this browser." onReady={(keys) => load(keys)} />
      </div>
    );

  const beating = rows.filter((r) => r.view.heartbeat);
  const shown = (r: Row) => r.view.status.phase;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="text-center">
        <div className="flex justify-center"><Pulse phase={beating.some((r) => shown(r) === "overdue") ? "overdue" : beating.length ? "alive" : "lapsed"} fraction={1} size={150} /></div>
        <Button className="mt-4 w-full py-4 text-base" onClick={beat} disabled={busy || beating.length === 0}>
          {busy ? "Checking in…" : `I'm safe · check in ${beating.length} vault${beating.length === 1 ? "" : "s"}`}
        </Button>
        {done && <p className="mt-3 text-sm">{done}</p>}
        {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
        {beating.length === 0 && <div className="mt-3"><Notice tone="warn">No vault of these keys still has a heartbeat.</Notice></div>}
      </Card>
      {rows.map((r) => (
        <Card key={r.view.vaultId}>
          <div className="flex items-center justify-between">
            <Link className="font-semibold underline" to={vaultPath(r.view.vaultId, r.view.creator)}>{r.view.manifest.tag || short(r.view.vaultId)}</Link>
            <PhaseBadge phase={shown(r)} />
          </div>
          <p className="mt-1 text-xs text-muted">Key: {r.key.label}</p>
          {r.view.status.blocksToDue !== null && r.view.status.blocksToDue > 0n && <p className="mt-2 text-sm text-muted">Next check-in due in {duration(blocksToSeconds(r.view.status.blocksToDue))}</p>}
          {r.view.status.phase === "overdue" && <p className="mt-2 text-sm text-overdue">You are in the grace period. Check in now.</p>}
        </Card>
      ))}
    </div>
  );
}
