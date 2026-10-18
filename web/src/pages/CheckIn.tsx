// The one screen an activist opens every week. One passphrase unlocks every key in this browser; each key's
// vault is found on Arkiv by its creator, so the phone keeps no list of vaults.
// A key opened with its duress passphrase checks in exactly like a normal one, on screen and on chain. The only
// difference is inside the check-in note, encrypted to each custodian, which tells them to release now.
import { beatPayload, checkIn, extendableKeys, isListed, listVaults, loadVault, walletClient, type VaultView } from "@proof-of-life/core";
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
import { useI18n } from "../lib/i18n";

type Row = { key: OpenKey; view: VaultView };

export default function CheckIn() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [jitter, setJitter] = useState(false);

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
      // Someone watching the chain sees when check-ins land. A random delay keeps them from matching a routine.
      if (jitter) {
        const ms = (60 + Math.random() * 19 * 60) * 1000;
        setDone(t("ci_jitter_wait", { m: Math.round(ms / 60000) }));
        await new Promise((r) => setTimeout(r, ms));
      }
      for (const r of rows ?? []) {
        const hb = r.view.heartbeat;
        if (!hb) continue;
        await ensureGas(r.key.account.address);
        const m = r.view.manifest;
        // Keys made before tokens existed check in without a note.
        const beat = r.key.tok ? { vaultId: r.view.vaultId, payload: beatPayload(r.view.vaultId, m.custodians.map((c) => c.pubkey as Hex), r.key.tok), listed: isListed(m) } : undefined;
        await checkIn(walletClient(r.key.account), { heartbeatKey: hb.key, intervalS: m.interval_s, graceS: m.grace_s, sealed: await read((c) => extendableKeys(c, r.view, "activist")), head: r.view.head, beat });
      }
      // Same words either way, by design.
      setDone(t("ci_done", { time: new Date().toLocaleTimeString() }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!rows)
    return (
      <div className="mx-auto max-w-xl">
        <KeyGate role="activist" title={t("ci_gate_t")} intro={t("ci_gate_i")} onReady={(keys) => load(keys)} />
      </div>
    );

  const beating = rows.filter((r) => r.view.heartbeat);
  const shown = (r: Row) => r.view.status.phase;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="text-center">
        <div className="flex justify-center"><Pulse phase={beating.some((r) => shown(r) === "overdue") ? "overdue" : beating.length ? "alive" : "lapsed"} fraction={1} size={150} /></div>
        <Button className="mt-4 w-full py-4 text-base" onClick={beat} disabled={busy || beating.length === 0}>
          {busy ? t("ci_busy") : beating.length === 1 ? t("ci_btn_one") : t("ci_btn_many", { n: beating.length })}
        </Button>
        <label className="mt-3 flex items-center justify-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={jitter} onChange={(e) => setJitter(e.target.checked)} /> {t("ci_jitter")}
        </label>
        {done && <p className="mt-3 text-sm">{done}</p>}
        {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
        {beating.length === 0 && <div className="mt-3"><Notice tone="warn">{t("ci_none")}</Notice></div>}
      </Card>
      {rows.map((r) => (
        <Card key={r.view.vaultId}>
          <div className="flex items-center justify-between">
            <Link className="font-semibold underline" to={vaultPath(r.view.vaultId, r.view.creator)}>{r.view.manifest.tag || short(r.view.vaultId)}</Link>
            <PhaseBadge phase={shown(r)} />
          </div>
          <p className="mt-1 text-xs text-muted">{t("ci_key")}: {r.key.label}</p>
          {r.view.status.blocksToDue !== null && r.view.status.blocksToDue > 0n && <p className="mt-2 text-sm text-muted">{t("ci_due", { d: duration(blocksToSeconds(r.view.status.blocksToDue)) })}</p>}
          {r.view.status.phase === "overdue" && <p className="mt-2 text-sm text-overdue">{t("ci_grace")}</p>}
        </Card>
      ))}
    </div>
  );
}
