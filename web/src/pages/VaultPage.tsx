import { keepAlive, loadCiphertext, unsealVault, verificationQueries, type VaultView, type VaultFile } from "@proof-of-life/core";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { Hex } from "viem";
import { Pulse } from "../components/Pulse";
import { Button, Card, Copy, Notice, PhaseBadge, TxLink } from "../components/ui";
import { useHead, useVault } from "../hooks/useVault";
import { blocksToSeconds, duration, fmtBytes, short } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { read } from "../lib/net";
import { sessionWallet } from "../lib/session";
import { TIRAMISU } from "@proof-of-life/core";

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
  const phase = view.status.phase;
  const valid = view.releases.filter((r) => r.valid);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted">Vault · {m.tag || short(view.vaultId)}</p>
              <h1 className="mt-1 font-serif text-2xl font-bold">{t(`phase_${phase}`)}</h1>
              <p className="mt-1 max-w-md text-sm text-muted">
                {t(`phase_${phase}_d`, { have: valid.length, k: m.k, need: view.status.releasesNeeded })}
              </p>
            </div>
            <PhaseBadge phase={phase} />
          </div>
          <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-8">
            <Pulse phase={phase} fraction={fraction} />
            <dl className="grid w-full gap-3 text-sm">
              {hb && dueAt !== null && (
                <>
                  <div>
                    <dt className="text-muted">{t("t_due_in")}</dt>
                    <dd className="font-mono text-2xl font-semibold">{dueAt > live ? duration(blocksToSeconds(dueAt - live)) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("t_lapses_in")}</dt>
                    <dd className="font-mono text-lg">{duration(blocksToSeconds(hb.expiresAt - live))}</dd>
                  </div>
                </>
              )}
              <div className="text-xs text-muted">
                Every {duration(m.interval_s)} · grace {duration(m.grace_s)} · {m.k} of {m.n} custodians · {m.release.mode === "newsroom" ? "release to newsroom" : "public release"}
              </div>
            </dl>
          </div>
          {view.status.earlyRelease && <div className="mt-4"><Notice tone="danger">{t("early_release")}</Notice></div>}
        </Card>

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
                <li key={r.key} className="font-mono"><span className="text-lapsed">✕</span> {r.kind} {short(r.key)}: {r.reason}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <h2 className="font-serif text-lg font-bold">On Arkiv</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li style={{ color: view.sealed ? "var(--color-alive)" : "var(--color-overdue)" }}>{view.sealed ? "✓" : "!"} {t(view.sealed ? "v_sealed_yes" : "v_sealed_no")}</li>
            <li>✓ {m.chunks.count} encrypted chunk(s), {fmtBytes(m.chunks.bytes)}, sealed by <span className="font-mono text-xs">{short(view.creator)}</span></li>
            <li>✓ {view.envelopes.filter((e) => e.sealed).length} of {m.n} key envelopes sealed</li>
            <li>✓ Vault data kept until block {view.expiresAt.toString()} (~{duration(blocksToSeconds(view.expiresAt - live))})</li>
            <li className="text-muted">Sealed at block {view.createdAt.toString()} · {new Date(m.sealed_at_ms).toLocaleString()}</li>
          </ul>
          <KeepAlive view={view} onDone={refresh} />
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg font-bold">{t("v_events")}</h2>
            <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-alive)" }}><span className="beat h-2 w-2 rounded-full" style={{ background: "var(--color-alive)" }} />{t("v_live")} · WebSocket</span>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {events.length === 0 && <li className="text-muted">Waiting for check-ins, acknowledgements and releases…</li>}
            {events.map((e, i) => (
              <li key={i} className="flex justify-between gap-2"><span>{e.text}</span>{e.tx && <TxLink hash={e.tx} />}</li>
            ))}
          </ul>
        </Card>

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
      setMsg(out.verified ? t("v_verified", { block: view.createdAt.toString(), date: new Date(out.bundle.sealedAtMs).toLocaleString() }) : "Some files do not match their sealed hash.");
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
  const url = useMemo(() => URL.createObjectURL(new Blob([new Uint8Array(f.bytes)], { type: f.type })), [f]);
  const isText = f.type.startsWith("text/");
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">{f.name}</span>
        <a className="underline" href={url} download={f.name}>Download · {fmtBytes(f.bytes.length)}</a>
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
    setState("Getting test gas…");
    try {
      const w = await sessionWallet();
      const yearOut = view.head + 365n * 43_200n;
      const keys = view.sealedKeys.filter((k) => k.expiresAt < yearOut).map((k) => k.key);
      if (keys.length === 0) return setState("Everything is already kept for at least a year.");
      setState(`Extending ${keys.length} sealed entities…`);
      const r = await keepAlive(w, keys, 366);
      setState(`Done · ${r.txHash}`);
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

function VerifyPanel({ view }: { view: VaultView }) {
  const q = verificationQueries(view.vaultId, view.creator);
  const curl = `curl -s ${TIRAMISU.rpc} -H 'content-type: application/json' --data '${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "arkiv_query", params: [q.heartbeat, { select: { key: true, expiresAt: true, owner: true, creator: true } }] })}'`;
  return (
    <Card>
      <h2 className="font-serif text-lg font-bold">Check this without us</h2>
      <p className="mt-1 text-sm text-muted">Every fact on this page comes from these Arkiv queries. Run them against any Arkiv endpoint.</p>
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
