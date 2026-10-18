import { extendableKeys, keepAlive, loadCiphertext, loadVault, unsealVault, vaultStatus, verificationQueries, type VaultView, type VaultFile } from "@proof-of-life/core";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { Hex } from "viem";
import { Pulse } from "../components/Pulse";
import { Button, Card, Copy, Notice, PhaseBadge, TxLink, inputCls } from "../components/ui";
import { useHead, useVault } from "../hooks/useVault";
import { blocksToSeconds, duration, fmtBytes, short } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { read } from "../lib/net";
import { sessionWallet } from "../lib/session";
import { TIRAMISU } from "@proof-of-life/core";
import type { Strings } from "../lib/strings.en";

// The reasons core gives for ignoring an entity, mapped to translated text.
const REJECT_KEY: Record<string, keyof Strings> = {"vault entity from a different creator": "rj_vault", "second manifest for the same vault; the first one counts": "rj_manifest", "heartbeat not written by the vault's creator": "rj_heartbeat", "check-in note not written by the vault's creator": "rj_beat", "envelope not written by the vault's creator": "rj_envelope", "acknowledgement from a wallet that is not this slot's custodian": "rj_ack", "release from a wallet that is not this slot's custodian": "rj_release"};

const DARK_PHASE = { alive: "#4ADE80", overdue: "#FBBF24", lapsed: "#F87171", releasing: "#F87171", released: "#A5B4FC" } as const;

export default function VaultPage() {
  const { vaultId, creator } = useParams() as { vaultId: Hex; creator: Hex };
  const { view, error, refresh, fetchedAt, events } = useVault(vaultId, creator);
  const { t } = useI18n();
  if (error && !view)
    return (
      <Card>
        <p className="font-semibold">{t("common_error")}</p>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <Button className="mt-4" variant="ghost" onClick={refresh}>{t("common_retry")}</Button>
      </Card>
    );
  if (!view) return <p className="text-muted">{t("common_loading")}</p>;
  return <VaultBody view={view} fetchedAt={fetchedAt} events={events} refresh={refresh} />;
}

function VaultBody({ view, fetchedAt, events, refresh }: { view: VaultView; fetchedAt: number; events: ReturnType<typeof useVault>["events"]; refresh: () => void }) {
  const { t } = useI18n();
  const { head } = useHead(view.head, fetchedAt);
  const m = view.manifest;
  const live = head ?? view.head;
  const hb = view.heartbeat;
  const graceBlocks = BigInt(Math.ceil(m.grace_s / 2));
  const dueAt = hb ? hb.expiresAt - graceBlocks : null;
  const fraction = dueAt ? Number(dueAt - live) / (m.interval_s / 2) : 0;
  const valid = view.releases.filter((r) => r.valid);
  // Between reads the phase follows the estimated head, so "overdue" and "stopped" show the moment they happen.
  const status = vaultStatus({ head: live, heartbeatExpiresAt: hb?.expiresAt ?? null, graceS: m.grace_s, k: m.k, validReleases: valid.length });
  const phase = status.phase;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <div className="stage !p-4 sm:!p-8">
          <div className="window window--dark">
            <div className="window__bar"><span className="lights"><i /><i /><i /></span><span className="window__title">Vault · {m.tag || short(view.vaultId)}</span></div>
            <div className="p-6 sm:p-8" style={{ background: "var(--app-bg)", color: "var(--app-ink)" }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-[30px] font-bold tracking-[-0.03em]">{t(`phase_${phase}`)}</h1>
                  <p className="mt-1 max-w-md text-[14.5px]" style={{ color: "var(--app-ink-2)" }}>
                    {t(`phase_${phase}_d`, { have: valid.length, k: m.k, need: status.releasesNeeded })}
                  </p>
                </div>
                <span className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold" style={{ background: "rgba(255,255,255,.07)", color: DARK_PHASE[phase] }}>
                  <span className={`h-2 w-2 rounded-full ${phase === "alive" ? "beat" : ""}`} style={{ background: "currentColor" }} />{t(`phase_${phase}`)}
                </span>
              </div>
              <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
                <Pulse phase={phase} fraction={fraction} size={190} />
                <div className="grid w-full gap-3">
                  {hb && dueAt !== null && hb.expiresAt > live && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-[12px] px-4 py-3" style={{ background: "var(--app-card)" }}>
                        <p className="text-[12px]" style={{ color: "var(--app-ink-2)" }}>{t("t_due_in")}</p>
                        <p className="t-mono ticker mt-1 text-[22px]">{dueAt > live ? duration(blocksToSeconds(dueAt - live)) : "—"}</p>
                      </div>
                      <div className="rounded-[12px] px-4 py-3" style={{ background: "var(--app-card)" }}>
                        <p className="text-[12px]" style={{ color: "var(--app-ink-2)" }}>{t("t_lapses_in")}</p>
                        <p className="t-mono ticker mt-1 text-[22px]">{duration(blocksToSeconds(hb.expiresAt - live))}</p>
                      </div>
                    </div>
                  )}
                  <p className="text-[12.5px]" style={{ color: "var(--app-ink-2)" }}>
                    {t("vp_rhythm", { i: duration(m.interval_s), g: duration(m.grace_s), k: m.k, n: m.n, mode: t(m.release.mode === "newsroom" ? "vp_mode_newsroom" : "vp_mode_public") })}
                  </p>
                </div>
              </div>
              {status.earlyRelease && <div className="mt-4"><Notice tone="danger">{t("early_release")}</Notice></div>}
            </div>
          </div>
        </div>

        <Card>
          <h2 className="font-serif text-lg font-bold">{t("v_custodians")}</h2>
          <ul className="mt-3 divide-y divide-line">
            {m.custodians.map((c) => {
              const ack = view.acks.find((a) => a.slot === c.slot);
              const rel = view.releases.find((r) => r.slot === c.slot && r.valid);
              return (
                <li key={c.slot} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span>
                    <span className="font-semibold">{t("v_custodian_slot", { slot: c.slot })}</span>{" "}
                    <span className="font-mono text-xs text-muted">{short(c.address)}</span>
                  </span>
                  <span className="text-xs">
                    {rel ? (
                      <span style={{ color: "var(--color-lapsed)" }}>● {t("v_released_piece")}</span>
                    ) : ack ? (
                      <span style={{ color: "var(--color-alive)" }}>● {t("v_ack_live", { time: duration(blocksToSeconds(ack.expiresAt - live)) })}</span>
                    ) : (
                      <span className="text-muted">○ {t("v_ack_missing")}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full transition-all" style={{ width: `${(Math.min(valid.length, m.k) / m.k) * 100}%`, background: "var(--color-lapsed)" }} />
          </div>
          <p className="mt-1 text-xs text-muted">{valid.length} / {m.k}</p>
        </Card>

        {(phase === "released" || phase === "releasing") && <Documents view={view} />}

        {view.rejected.length > 0 && (
          <Card>
            <h2 className="font-serif text-lg font-bold">{t("v_rejected")}</h2>
            <p className="mt-1 text-sm text-muted">{t("v_rejected_d")}</p>
            <ul className="mt-3 space-y-1 text-xs">
              {view.rejected.map((r) => (
                <li key={r.key} className="font-mono"><span className="text-lapsed">✕</span> {r.kind} {short(r.key)}: {REJECT_KEY[r.reason] ? t(REJECT_KEY[r.reason]) : r.reason}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <h2 className="font-serif text-lg font-bold">{t("vp_on_arkiv")}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li style={{ color: view.sealed ? "var(--color-alive)" : "var(--color-overdue)" }}>{view.sealed ? "✓" : "!"} {t(view.sealed ? "v_sealed_yes" : "v_sealed_no")}</li>
            <li>✓ {t("vp_chunks", { n: m.chunks.count, size: fmtBytes(m.chunks.bytes) })} <span className="font-mono text-xs">{short(view.creator)}</span></li>
            <li>✓ {t("vp_envelopes", { have: view.envelopes.filter((e) => e.sealed).length, n: m.n })}</li>
            <li>✓ {t("vp_kept", { b: view.expiresAt.toString(), d: duration(blocksToSeconds(view.expiresAt - live)) })}</li>
            <li className="text-muted">{t("vp_sealed_at", { b: view.createdAt.toString(), date: new Date(m.sealed_at_ms).toLocaleString() })}</li>
          </ul>
          <KeepAlive view={view} onDone={refresh} />
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg font-bold">{t("v_events")}</h2>
            <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-alive)" }}><span className="beat h-2 w-2 rounded-full" style={{ background: "var(--color-alive)" }} />{t("v_live")} · WebSocket</span>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {events.length === 0 && <li className="text-muted">{t("vp_waiting")}</li>}
            {events.map((e, i) => (
              <li key={i} className="flex justify-between gap-2"><span>{e.text}</span>{e.tx && <TxLink hash={e.tx} />}</li>
            ))}
          </ul>
        </Card>

        <AsOf view={view} />
        <VerifyPanel view={view} />
      </div>
    </div>
  );
}

function Documents({ view }: { view: VaultView }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [msg, setMsg] = useState("");
  const shares = view.releases.filter((r) => r.valid && r.share).map((r) => r.share!);
  if (view.manifest.release.mode === "newsroom") return <Card><Notice>{t("v_newsroom")}</Notice></Card>;
  const open = async () => {
    setState("busy");
    try {
      const { ciphertext } = await read((c) => loadCiphertext(c, view));
      const out = unsealVault(view.vaultId, ciphertext, shares);
      setFiles(out.files);
      setMsg(out.verified ? t("v_verified", { block: view.createdAt.toString(), date: new Date(out.bundle.sealedAtMs).toLocaleString() }) : t("vp_mismatch"));
      setState("done");
    } catch (e) {
      setMsg((e as Error).message);
      setState("error");
    }
  };
  return (
    <Card>
      <h2 className="font-serif text-lg font-bold">{t("v_files")}</h2>
      {state === "idle" && <Button className="mt-3" disabled={shares.length < view.manifest.k} onClick={open}>{t("v_open")}</Button>}
      {state === "busy" && <p className="mt-3 text-sm text-muted">{t("v_opening")}</p>}
      {msg && <div className="mt-3"><Notice tone={state === "error" ? "danger" : "info"}>{msg}</Notice></div>}
      <ul className="mt-3 space-y-3">
        {files.map((f) => <FilePreview key={f.name} f={f} />)}
      </ul>
    </Card>
  );
}

function FilePreview({ f }: { f: VaultFile }) {
  const { t } = useI18n();
  const url = useMemo(() => URL.createObjectURL(new Blob([new Uint8Array(f.bytes)], { type: f.type })), [f]);
  const isText = f.type.startsWith("text/");
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">{f.name}</span>
        <a className="underline" href={url} download={f.name}>{t("vp_download")} · {fmtBytes(f.bytes.length)}</a>
      </div>
      {isText && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-3 text-xs">{new TextDecoder().decode(f.bytes)}</pre>}
      {f.type.startsWith("image/") && <img className="mt-2 max-h-96 rounded-lg" src={url} alt={f.name} />}
      {f.type === "application/pdf" && <iframe className="mt-2 h-96 w-full rounded-lg border border-line" src={url} title={f.name} />}
    </li>
  );
}

function KeepAlive({ view, onDone }: { view: VaultView; onDone: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<string>("");
  const go = async () => {
    setState(t("ka_gas"));
    try {
      const w = await sessionWallet();
      const yearOut = view.head + 365n * 43_200n;
      const keys = (await read((c) => extendableKeys(c, view, "anyone"))).filter((k) => k.expiresAt < yearOut).map((k) => k.key);
      if (keys.length === 0) return setState(t("ka_none"));
      setState(t("ka_extending", { n: keys.length }));
      const r = await keepAlive(w, keys, 366);
      setState(`${t("ka_done")} · ${r.txHash}`);
      onDone();
    } catch (e) {
      setState((e as Error).message);
    }
  };
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Button variant="ghost" onClick={go}>{t("v_keepalive")}</Button>
      <p className="mt-2 text-xs text-muted">{t("v_keepalive_d")}</p>
      {state && <p className="mt-2 break-all font-mono text-xs">{state}</p>}
    </div>
  );
}

/** Reads the vault as it stood at a past block, so anyone can show the heartbeat was alive (or gone) at that moment. */
function AsOf({ view }: { view: VaultView }) {
  const { t } = useI18n();
  const [block, setBlock] = useState(String(view.head - 43_200n > view.createdAt ? view.head - 43_200n : view.createdAt));
  const [out, setOut] = useState<string>("");
  const go = async () => {
    setOut(t("as_reading"));
    try {
      const at = BigInt(block);
      const past = await read((c) => loadVault(c, view.vaultId, view.creator, { atBlock: at }));
      const hb = past.heartbeat;
      setOut(t("as_at", { b: at.toString(), phase: t(`phase_${past.status.phase}`) }) + (hb ? t("as_hb", { b: hb.expiresAt.toString() }) : t("as_nohb")) + t("as_pieces", { n: past.releases.filter((r) => r.valid).length }));
    } catch (e) {
      setOut((e as Error).message.split("\n")[0]);
    }
  };
  return (
    <Card>
      <h2 className="font-serif text-lg font-bold">{t("as_t")}</h2>
      <p className="mt-1 text-sm text-muted">{t("as_d")}</p>
      <div className="mt-3 flex gap-2">
        <input className={`${inputCls} font-mono`} value={block} onChange={(e) => setBlock(e.target.value.replace(/[^0-9]/g, ""))} />
        <Button variant="ghost" onClick={go}>{t("as_read")}</Button>
      </div>
      {out && <p className="mt-2 text-sm">{out}</p>}
    </Card>
  );
}

function VerifyPanel({ view }: { view: VaultView }) {
  const { t } = useI18n();
  const q = verificationQueries(view.vaultId, view.creator);
  // A heredoc keeps the query's own single quotes intact, so this pastes straight into a shell.
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "arkiv_query", params: [q.heartbeat, { select: { key: true, expiresAt: true, owner: true, creator: true } }] });
  const curl = `curl -s ${TIRAMISU.rpc} -H 'content-type: application/json' --data-binary @- <<'EOF'\n${body}\nEOF`;
  return (
    <Card>
      <h2 className="font-serif text-lg font-bold">{t("vy_t")}</h2>
      <p className="mt-1 text-sm text-muted">{t("vy_d")}</p>
      {Object.entries(q).map(([name, s]) => (
        <div key={name} className="mt-3">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">{name}<Copy text={s} /></div>
          <pre className="mono-wrap mt-1 whitespace-pre-wrap rounded-lg bg-paper p-2 text-[11px]">{s}</pre>
        </div>
      ))}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">curl<Copy text={curl} /></div>
        <pre className="mono-wrap mt-1 whitespace-pre-wrap rounded-lg bg-paper p-2 text-[11px]">{curl}</pre>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">CLI<Copy text={`npx github:YASASWIP012/proof-of-life status ${view.vaultId} ${view.creator}`} /></div>
        <pre className="mono-wrap mt-1 rounded-lg bg-paper p-2 text-[11px]">npx github:YASASWIP012/proof-of-life status {view.vaultId} {view.creator}</pre>
      </div>
    </Card>
  );
}
