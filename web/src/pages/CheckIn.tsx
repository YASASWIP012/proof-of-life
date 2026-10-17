// The one screen an activist opens every week: "I'm safe". Each vault has its own key, so one passphrase
// unlocks every key in this browser and one tap checks in all of them.
import { checkIn, loadVault, walletClient, type VaultView } from "@proof-of-life/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useKeys } from "../components/KeyGate";
import { Pulse } from "../components/Pulse";
import { Button, Card, Field, Notice, PhaseBadge, TxLink, inputCls } from "../components/ui";
import { blocksToSeconds, duration, short, vaultPath } from "../lib/format";
import { getUnlocked, importBackup, unlock } from "../lib/keys";
import { read } from "../lib/net";
import { ensureGas } from "../lib/tap";

type Row = { address: string; view: VaultView | null };

export default function CheckIn() {
  const keys = useKeys("activist");
  const [pass, setPass] = useState("");
  const [unlockedCount, setUnlockedCount] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<{ text: string; tx?: string; bad?: boolean }[]>([]);

  const load = async () => {
    const out = await Promise.all(
      keys.flatMap((k) => k.vaults.map(async (v) => ({ address: k.address, view: await read((c) => loadVault(c, v.vaultId, v.creator)).catch(() => null) }))),
    );
    setRows(out);
  };
  useEffect(() => {
    load();
  }, [keys.length]);

  const unlockAll = async () => {
    setBusy(true);
    let n = 0;
    for (const k of keys) {
      if (getUnlocked(k.address)) n++;
      else await unlock(k, pass).then(() => n++).catch(() => {});
    }
    setUnlockedCount(n);
    setBusy(false);
    if (n === 0) setMsgs([{ text: "That passphrase opens none of the keys in this browser.", bad: true }]);
  };

  const beat = async () => {
    setBusy(true);
    setMsgs([]);
    for (const r of rows ?? []) {
      const acct = getUnlocked(r.address);
      const v = r.view;
      if (!acct || !v?.heartbeat) continue;
      try {
        await ensureGas(acct.address);
        const res = await checkIn(walletClient(acct), { heartbeatKey: v.heartbeat.key, intervalS: v.manifest.interval_s, graceS: v.manifest.grace_s, sealed: v.sealedKeys, head: v.head });
        setMsgs((m) => [...m, { text: `${v.manifest.tag || short(v.vaultId)}: checked in`, tx: res.txHash }]);
      } catch (e) {
        setMsgs((m) => [...m, { text: `${v.manifest.tag || short(v.vaultId)}: ${(e as Error).message}`, bad: true }]);
      }
    }
    await load();
    setBusy(false);
  };

  const beating = (rows ?? []).filter((r) => r.view?.heartbeat);
  const ready = beating.filter((r) => getUnlocked(r.address)).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="text-center">
        <div className="flex justify-center">
          <Pulse phase={beating.some((r) => r.view?.status.phase === "overdue") ? "overdue" : beating.length ? "alive" : "lapsed"} fraction={1} size={150} />
        </div>
        {keys.length === 0 ? (
          <Notice tone="warn">No vault keys in this browser. Restore your backup files below, or seal a vault first.</Notice>
        ) : unlockedCount === 0 ? (
          <div className="mx-auto mt-4 max-w-sm space-y-3 text-left">
            <Field label="Passphrase">
              <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlockAll()} autoComplete="current-password" />
            </Field>
            <Button className="w-full" onClick={unlockAll} disabled={busy || !pass}>Unlock my keys</Button>
          </div>
        ) : (
          <Button className="mt-4 w-full py-4 text-base" onClick={beat} disabled={busy || ready === 0}>
            {busy ? "Checking in…" : `I'm safe · check in ${ready} vault${ready === 1 ? "" : "s"}`}
          </Button>
        )}
        <ul className="mt-3 space-y-1 text-left text-sm">
          {msgs.map((m, i) => <li key={i} className={m.bad ? "text-lapsed" : ""}>{m.text} {m.tx && <TxLink hash={m.tx} />}</li>)}
        </ul>
      </Card>

      {rows?.map((r) => r.view && (
        <Card key={r.view.vaultId}>
          <div className="flex items-center justify-between">
            <Link className="font-semibold underline" to={vaultPath(r.view.vaultId, r.view.creator)}>{r.view.manifest.tag || short(r.view.vaultId)}</Link>
            <PhaseBadge phase={r.view.status.phase} />
          </div>
          {r.view.status.blocksToDue !== null && r.view.status.blocksToDue > 0n && <p className="mt-2 text-sm text-muted">Next check-in due in {duration(blocksToSeconds(r.view.status.blocksToDue))}</p>}
          {r.view.status.phase === "overdue" && <p className="mt-2 text-sm text-overdue">You are in the grace period. Check in now.</p>}
          {!getUnlocked(r.address) && unlockedCount > 0 && <p className="mt-2 text-xs text-muted">This vault's key uses a different passphrase.</p>}
        </Card>
      ))}

      <Card>
        <h2 className="font-semibold">On a new phone?</h2>
        <p className="mt-1 text-sm text-muted">Restore each vault's backup file here. Backups are useless without your passphrase.</p>
        <input type="file" accept="application/json" multiple className="mt-3 block text-sm" onChange={async (e) => {
          for (const f of Array.from(e.target.files ?? [])) {
            try {
              importBackup(await f.text());
            } catch (err) {
              setMsgs((m) => [...m, { text: `${f.name}: ${(err as Error).message}`, bad: true }]);
            }
          }
        }} />
      </Card>
    </div>
  );
}
