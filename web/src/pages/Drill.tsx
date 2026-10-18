// The five-minute drill: one activist and three custodians, all in this tab, all writing to Arkiv for real.
// The clock is shrunk (check in every minute, one minute of grace) so the whole life of a vault fits in a coffee break.
import {
  ackCustody, createVault, loadVault, releaseMyShare, sealVault, utf8, walletClient, type VaultView, type WalletClient,
} from "@proof-of-life/core";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Hex } from "viem";
import { parseEther } from "viem";
import { Pulse } from "../components/Pulse";
import { Button, Card, Notice, PhaseBadge, TxLink, inputCls } from "../components/ui";
import { useHead } from "../hooks/useVault";
import { blocksToSeconds, duration, short, vaultPath } from "../lib/format";
import { newSecret } from "../lib/keys";
import { read, readClient } from "../lib/net";
import { syntheticRtiReply } from "../lib/synthetic";
import { ensureGas } from "../lib/tap";
import { useI18n } from "../lib/i18n";
import { attrs, beatPayload, checkIn, hexToBytes, newBeatTokens, vaultStatus } from "@proof-of-life/core";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk";

type Actor = ReturnType<typeof newSecret> & { name: string; wallet: WalletClient };
type Log = { t: number; text: string; tx?: string; tone?: "ok" | "bad" };

const INTERVAL = 60;
const GRACE = 60;

export default function Drill() {
  const { t } = useI18n();
  const [stage, setStage] = useState<"intro" | "setup" | "live" | "done">("intro");
  const [log, setLog] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState(() => t("dr_note_default"));
  const [view, setView] = useState<VaultView | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [unreachable, setUnreachable] = useState(true);
  const [forge, setForge] = useState(true);
  const actors = useRef<{ activist: Actor; custodians: Actor[]; forger: Actor } | null>(null);
  const vaultRef = useRef<{ vaultId: Hex; creator: Hex; heartbeatKey: Hex } | null>(null);
  const released = useRef(false);
  const tokens = useRef(newBeatTokens());

  const add = (l: Omit<Log, "t">) => setLog((xs) => [...xs, { ...l, t: Date.now() }]);

  const refresh = async () => {
    const v = vaultRef.current;
    if (!v) return null;
    const next = await read((c) => loadVault(c, v.vaultId, v.creator));
    setView(next);
    setFetchedAt(Date.now());
    return next;
  };

  async function start() {
    setBusy(true);
    setErr(null);
    setStage("setup");
    try {
      const mk = (name: string): Actor => {
        const s = newSecret();
        return { ...s, name, wallet: walletClient(s.account) };
      };
      const activist = mk(t("dr_activist"));
      const custodians = [mk(t("dr_c1")), mk(t("dr_c2")), mk(t("dr_c3"))];
      const forger = mk(t("dr_forger"));
      actors.current = { activist, custodians, forger };
      add({ text: t("dr_l_keys", { a: short(activist.account.address) }) });

      await ensureGas(activist.account.address, parseEther("0.05"));
      add({ text: t("dr_l_tap") });
      for (const c of [...custodians, forger]) {
        const tx = await activist.wallet.sendTransaction({ to: c.account.address, value: parseEther("0.005"), account: activist.account, chain: activist.wallet.chain });
        add({ text: t("dr_l_gas", { name: c.name }), tx });
      }
      await new Promise((r) => setTimeout(r, 4000));

      tokens.current = newBeatTokens();
      const doc = syntheticRtiReply();
      const sealed = sealVault({
        title: "Village A-17 road works (synthetic)",
        note,
        files: [
          { name: doc.name, type: doc.type, bytes: utf8(doc.text) },
          { name: "activist-note.txt", type: "text/plain", bytes: utf8(note) },
        ],
        k: 2,
        custodianPubKeys: custodians.map((c) => hexToBytes(c.pubkey)),
        beatTokens: tokens.current,
      });
      add({ text: t("dr_l_enc", { v: short(sealed.vaultId) }) });

      const res = await createVault(activist.wallet, readClient(), {
        sealed, k: 2,
        custodians: custodians.map((c) => ({ address: c.account.address, pubkey: c.pubkey })),
        intervalS: INTERVAL, graceS: GRACE, mode: "public", vaultDays: 30, listed: true,
      }, (p) => p.txHash && add({ text: p.stage === "chunks" ? t("dr_l_chunk", { d: p.done, t: p.total }) : t("dr_l_batch"), tx: p.txHash }));
      vaultRef.current = { vaultId: sealed.vaultId, creator: activist.account.address, heartbeatKey: res.heartbeatKey };

      const acks = await Promise.all(custodians.map((c) => ackCustody(c.wallet, { vaultId: sealed.vaultId, slot: custodians.indexOf(c) + 1, listed: true })));
      acks.forEach((a, i) => add({ text: t("dr_l_ack", { name: custodians[i].name }), tx: a.txHash }));
      await refresh();
      setStage("live");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function beat() {
    const a = actors.current!;
    const v = vaultRef.current!;
    setBusy(true);
    try {
      const beat = { vaultId: v.vaultId, payload: beatPayload(v.vaultId, a.custodians.map((c) => c.pubkey), tokens.current.ok), listed: true };
      const r = await checkIn(a.activist.wallet, { heartbeatKey: v.heartbeatKey, intervalS: INTERVAL, graceS: GRACE, beat });
      add({ text: t("dr_l_beat"), tx: r.txHash, tone: "ok" });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function coerce() {
    const a = actors.current!;
    const v = vaultRef.current!;
    setBusy(true);
    try {
      const r = await a.activist.wallet.deleteEntity({ entityKey: v.heartbeatKey });
      add({ text: t("dr_l_coerce"), tx: r.txHash, tone: "bad" });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The custodians in this tab watch the vault and act the moment the heartbeat is gone.
  useEffect(() => {
    if (stage !== "live" || !view) return;
    const phase = view.status.phase;
    if ((phase === "lapsed" || phase === "releasing") && !released.current) {
      released.current = true;
      (async () => {
        const a = actors.current!;
        const v = vaultRef.current!;
        add({ text: t("dr_l_gone"), tone: "bad" });
        if (forge) {
          try {
            // A stranger publishes a "release" for slot 2. It will be shown, and ignored.
            const fake = await a.forger.wallet.createEntity({
              payload: jsonToPayload({ v: 1, slot: 2, share: "0x02" + "ab".repeat(32), sealed_to_newsroom: false, observed_lapse_block: "0" }),
              contentType: "application/json",
              attributes: attrs.release(v.vaultId, 2, v.creator),
              expires: ExpirationTime.fromDays(1),
            });
            add({ text: t("dr_l_fake"), tx: fake.txHash, tone: "bad" });
          } catch {}
        }
        const who = unreachable ? [0, 2] : [0, 1, 2];
        if (unreachable) add({ text: t("dr_l_unreach") });
        for (const i of who) {
          try {
            const fresh = await refresh();
            const r = await releaseMyShare(a.custodians[i].wallet, readClient(), fresh!, a.custodians[i].secret);
            add({ text: t("dr_l_piece", { name: a.custodians[i].name }), tx: r.txHash, tone: "ok" });
          } catch (e) {
            add({ text: `${a.custodians[i].name}: ${(e as Error).message}`, tone: "bad" });
          }
        }
        await refresh();
        setStage("done");
      })();
    }
  }, [view, stage]);

  // No event fires when a heartbeat expires, so the drill re-reads at the deadline it already knows.
  useEffect(() => {
    if (stage !== "live" || !view?.status.blocksToLapse) return;
    const ms = blocksToSeconds(view.status.blocksToLapse) * 1000 + 2500;
    const t = setTimeout(refresh, ms);
    return () => clearTimeout(t);
  }, [view, stage]);

  const { head } = useHead(view?.head, fetchedAt);
  const live = head ?? 0n;
  const hb = view?.heartbeat;
  const dueAt = hb ? hb.expiresAt - BigInt(GRACE / 2) : null;
  const fraction = dueAt ? Number(dueAt - live) / (INTERVAL / 2) : 0;
  const livePhase = view ? vaultStatus({ head: live, heartbeatExpiresAt: hb?.expiresAt ?? null, graceS: GRACE, k: view.manifest.k, validReleases: view.releases.filter((r) => r.valid).length }).phase : "alive";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card>
          <p className="text-xs uppercase tracking-wider text-muted">{t("dr_kicker")}</p>
          <h1 className="mt-1 font-serif text-3xl font-bold">{t("dr_title")}</h1>
          <p className="mt-3 text-sm text-muted">{t("dr_body")}</p>
          {stage === "intro" && (
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-semibold">{t("dr_note_label")}
                <input className={`${inputCls} mt-1.5`} value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unreachable} onChange={(e) => setUnreachable(e.target.checked)} /> {t("dr_unreachable")}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={forge} onChange={(e) => setForge(e.target.checked)} /> {t("dr_forge")}</label>
              <Button onClick={start} disabled={busy}>{t("dr_start")}</Button>
            </div>
          )}
          {err && <div className="mt-4"><Notice tone="danger">{err}</Notice></div>}
        </Card>

        {view && (
          <Card>
            <div className="flex items-center justify-between">
              <PhaseBadge phase={livePhase} />
              <Link className="text-sm underline" to={vaultPath(view.vaultId, view.creator)}>{t("dr_public")}</Link>
            </div>
            <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
              <Pulse phase={livePhase} fraction={fraction} size={180} />
              <div className="space-y-3 text-sm">
                {dueAt !== null && hb && hb.expiresAt > live && (
                  <>
                    <p>{t("dr_due")} <b className="font-mono">{dueAt > live ? duration(blocksToSeconds(dueAt - live)) : t("dr_now")}</b></p>
                    <p>{t("dr_stops")} <b className="font-mono">{duration(blocksToSeconds(hb.expiresAt - live))}</b></p>
                  </>
                )}
                <p className="text-muted">{t("dr_pieces", { have: view.releases.filter((r) => r.valid).length, k: view.manifest.k })}</p>
                {stage === "live" && hb && (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={beat} disabled={busy}>{t("dr_checkin")}</Button>
                    <Button variant="danger" onClick={coerce} disabled={busy}>{t("dr_force")}</Button>
                  </div>
                )}
                {stage === "live" && hb && <p className="text-xs text-muted">{t("dr_or")}</p>}
              </div>
            </div>
          </Card>
        )}

        {stage === "done" && view && (
          <Card>
            <h2 className="font-serif text-xl font-bold">{t("dr_out_t")}</h2>
            <p className="mt-2 text-sm text-muted">{t("dr_out")}</p>
            <Link to={vaultPath(view.vaultId, view.creator)}><Button className="mt-4">{t("dr_open")}</Button></Link>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <h2 className="font-serif text-lg font-bold">{t("dr_log_t")}</h2>
        <ol className="mt-3 space-y-2 text-sm">
          {log.length === 0 && <li className="text-muted">{t("dr_log_none")}</li>}
          {log.map((l, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span style={{ color: l.tone === "bad" ? "var(--color-lapsed)" : l.tone === "ok" ? "var(--color-alive)" : undefined }}>{l.text}</span>
              {l.tx && <TxLink hash={l.tx} />}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

