// For the people an activist trusts: make a one-vault key, confirm custody, and release when the heartbeat stops.
import { ackCustody, envelopesFor, loadVault, releaseMyShare, walletClient, type VaultView } from "@proof-of-life/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { KeyGate, useKeys, type Unlocked } from "../components/KeyGate";
import { Button, Card, Copy, Notice, PhaseBadge, TxLink } from "../components/ui";
import { blocksToSeconds, duration, short, vaultPath } from "../lib/format";
import { inviteCode, type StoredKey } from "../lib/keys";
import { read, readClient } from "../lib/net";
import { ensureGas } from "../lib/tap";

export default function Custodian() {
  const keys = useKeys("custodian");
  const [acct, setAcct] = useState<{ a: Unlocked; k: StoredKey } | null>(null);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold">Custodians</h1>
        <p className="mt-2 max-w-2xl text-muted">
          You hold one piece of a key. Alone it reveals nothing. You promise two things: to try to reach the activist if their heartbeat is overdue, and to publish your piece if it stops. Use a new key for every vault, so nothing on Arkiv connects your vaults to each other or to you.
        </p>
      </div>
      {!acct ? (
        <div className="mx-auto max-w-xl">
          <KeyGate role="custodian" title={keys.length ? "Unlock a custodian key, or make one for a new vault" : "Make a custodian key for one vault"} onReady={(a, k) => setAcct({ a, k })} />
        </div>
      ) : (
        <Seat account={acct.a} stored={acct.k} />
      )}
    </div>
  );
}

function Seat({ account, stored }: { account: Unlocked; stored: StoredKey }) {
  const [vaults, setVaults] = useState<VaultView[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; tx?: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const code = inviteCode(stored);

  const load = async () => {
    const env = await read((c) => envelopesFor(c, account.address));
    const views = await Promise.all(env.map((e) => read((c) => loadVault(c, e.vaultId, e.creator)).catch(() => null)));
    setVaults(views.filter((v): v is VaultView => !!v));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const act = async (fn: () => Promise<{ txHash: string }>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await ensureGas(account.address);
      const r = await fn();
      setMsg({ text: ok, tx: r.txHash });
      await load();
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <h2 className="font-serif text-lg font-bold">Your invite code</h2>
        <p className="mt-1 text-sm text-muted">Send this to the activist through a channel you both trust. It holds only this key's public half.</p>
        <pre className="mono-wrap mt-3 whitespace-pre-wrap rounded-lg bg-paper p-3 text-xs">{code}</pre>
        <div className="mt-2"><Copy text={code} /></div>
      </Card>
      <div className="space-y-4">
        {msg && <Notice tone={msg.bad ? "danger" : "info"}>{msg.text} {msg.tx && <TxLink hash={msg.tx} />}</Notice>}
        {vaults === null && <p className="text-muted">Looking for vaults that name this key…</p>}
        {vaults?.length === 0 && <Card><p className="text-sm text-muted">No vault names this key yet. Once the activist seals one with your invite code, it shows up here.</p></Card>}
        {vaults?.map((v) => {
          const seat = v.manifest.custodians.find((c) => c.address.toLowerCase() === account.address.toLowerCase())!;
          const ack = v.acks.find((a) => a.slot === seat.slot);
          const mine = v.releases.find((r) => r.slot === seat.slot && r.valid);
          const canRelease = (v.status.phase === "lapsed" || v.status.phase === "releasing") && !mine;
          return (
            <Card key={v.vaultId}>
              <div className="flex items-center justify-between gap-2">
                <Link className="font-semibold underline" to={vaultPath(v.vaultId, v.creator)}>{v.manifest.tag || short(v.vaultId)}</Link>
                <PhaseBadge phase={v.status.phase} />
              </div>
              <p className="mt-2 text-sm text-muted">Slot {seat.slot} of {v.manifest.n} · {v.manifest.k} needed to release</p>
              {v.status.phase === "overdue" && <div className="mt-3"><Notice tone="warn">The activist is late. Try to reach them now, through the channel you agreed on.</Notice></div>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => act(() => ackCustody(walletClient(account), { vaultId: v.vaultId, slot: seat.slot, existingKey: ack?.key }), ack ? "Custody renewed for 14 days." : "Custody confirmed.")}>
                  {ack ? `Renew custody (${duration(blocksToSeconds(ack.expiresAt - v.head))} left)` : "Confirm I hold my key"}
                </Button>
                <Button variant="danger" disabled={busy || !canRelease} onClick={() => act(() => releaseMyShare(walletClient(account), readClient(), v, account.secret), "Your piece is public.")}>
                  {mine ? "Piece published" : "Publish my piece"}
                </Button>
              </div>
              {!canRelease && !mine && <p className="mt-2 text-xs text-muted">Publishing unlocks only after the heartbeat stops. The app and the CLI both refuse earlier, and a piece published early is flagged on the vault page.</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
