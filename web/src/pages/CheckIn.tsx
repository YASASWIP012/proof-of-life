// The one screen an activist opens every week: "I'm safe".
import { checkIn, loadVault, walletClient, type VaultView } from "@dhadkan/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { KeyGate, type Unlocked } from "../components/KeyGate";
import { Pulse } from "../components/Pulse";
import { Button, Card, Notice, PhaseBadge, TxLink } from "../components/ui";
import { blocksToSeconds, duration, vaultPath } from "../lib/format";
import type { StoredKey } from "../lib/keys";
import { read } from "../lib/net";
import { ensureGas } from "../lib/tap";

export default function CheckIn() {
  const [acct, setAcct] = useState<{ a: Unlocked; k: StoredKey } | null>(null);
  if (!acct) return <div className="mx-auto max-w-xl"><KeyGate role="activist" title="Unlock your key to check in" onReady={(a, k) => setAcct({ a, k })} /></div>;
  return <Vaults account={acct.a} stored={acct.k} />;
}

function Vaults({ account, stored }: { account: Unlocked; stored: StoredKey }) {
  const [views, setViews] = useState<VaultView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tx?: string; bad?: boolean } | null>(null);

  const load = async () => {
    const vs = await Promise.all(stored.vaults.map((v) => read((c) => loadVault(c, v.vaultId, v.creator)).catch(() => null)));
    setViews(vs.filter((v): v is VaultView => !!v));
  };
  useEffect(() => {
    load();
  }, []);

  const beatAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await ensureGas(account.address);
      const w = walletClient(account);
      for (const v of views ?? []) {
        if (!v.heartbeat) continue;
        const r = await checkIn(w, { heartbeatKey: v.heartbeat.key, intervalS: v.manifest.interval_s, graceS: v.manifest.grace_s, sealed: v.sealedKeys, head: v.head });
        setMsg({ text: "Checked in. Your documents stay sealed.", tx: r.txHash });
      }
      await load();
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  };

  if (!views) return <p className="text-muted">Reading your vaults from Arkiv…</p>;
  const beating = views.filter((v) => v.heartbeat);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="text-center">
        <div className="flex justify-center"><Pulse phase={beating.some((v) => v.status.phase === "overdue") ? "overdue" : beating.length ? "alive" : "lapsed"} fraction={1} size={160} /></div>
        <Button className="mt-4 w-full py-4 text-base" onClick={beatAll} disabled={busy || beating.length === 0}>{busy ? "Checking in…" : "I'm safe · check in"}</Button>
        {msg && <p className={`mt-3 text-sm ${msg.bad ? "text-lapsed" : ""}`}>{msg.text} {msg.tx && <TxLink hash={msg.tx} />}</p>}
        {beating.length === 0 && <div className="mt-3"><Notice tone="warn">No vault of this key still has a heartbeat.</Notice></div>}
      </Card>
      {views.map((v) => (
        <Card key={v.vaultId}>
          <div className="flex items-center justify-between">
            <Link className="font-semibold underline" to={vaultPath(v.vaultId, v.creator)}>{v.manifest.tag || v.vaultId.slice(0, 10)}</Link>
            <PhaseBadge phase={v.status.phase} />
          </div>
          {v.status.blocksToDue !== null && v.status.blocksToDue > 0n && <p className="mt-2 text-sm text-muted">Next check-in due in {duration(blocksToSeconds(v.status.blocksToDue))}</p>}
          {v.status.phase === "overdue" && <p className="mt-2 text-sm text-overdue">You are in the grace period. Check in now.</p>}
        </Card>
      ))}
    </div>
  );
}
