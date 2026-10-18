// Sealing a real vault: files are encrypted here, split among custodians, and written to Arkiv sealed.
import { createVault, envelopesFor, hexToBytes, MAX_BUNDLE_BYTES, sealVault, walletClient, type Manifest } from "@proof-of-life/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Hex } from "viem";
import { KeyGate } from "../components/KeyGate";
import { Button, Card, Copy, Field, Notice, TxLink, inputCls } from "../components/ui";
import { duration, fmtBytes, vaultPath } from "../lib/format";
import { parseInvite, type OpenKey } from "../lib/keys";
import { read, readClient } from "../lib/net";
import { ensureGas, waitForOwnFunds } from "../lib/tap";
import { formatEther } from "viem";
import { useI18n } from "../lib/i18n";

const RHYTHMS = [
  { id: "daily", label: "nv_rh_daily", interval: 86_400, grace: 86_400 },
  { id: "weekly", label: "nv_rh_weekly", interval: 7 * 86_400, grace: 3 * 86_400 },
  { id: "fortnight", label: "nv_rh_fortnight", interval: 14 * 86_400, grace: 7 * 86_400 },
  { id: "monthly", label: "nv_rh_monthly", interval: 30 * 86_400, grace: 7 * 86_400 },
  { id: "test", label: "nv_rh_test", interval: 600, grace: 300 },
] as const;

export default function NewVault() {
  const { t } = useI18n();
  const [acct, setAcct] = useState<OpenKey | null>(null);
  if (!acct)
    return (
      <div className="mx-auto max-w-xl">
        <KeyGate
          role="activist" forceNew offerDuress title={t("nv_gate_t")}
          intro={t("nv_gate_i")}
          onReady={(keys) => setAcct(keys[0])}
        />
      </div>
    );
  return <Form account={acct.account} keyInfo={acct} />;
}

function Form({ account, keyInfo: key }: { account: OpenKey["account"]; keyInfo: OpenKey }) {
  const { t } = useI18n();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [invites, setInvites] = useState(["", "", ""]);
  const [k, setK] = useState(2);
  const [rhythm, setRhythm] = useState<(typeof RHYTHMS)[number]["id"]>("weekly");
  const [mode, setMode] = useState<"public" | "newsroom">("newsroom");
  const [newsroom, setNewsroom] = useState("");
  const [listed, setListed] = useState(false);
  const [anyoneKeeps, setAnyoneKeeps] = useState(true);
  const [ownGas, setOwnGas] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ text: string; tx?: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ manifest: Manifest; vaultId: Hex } | null>(null);

  // Photos shrink before sealing, so they count at an estimated 250 KB each against the limit.
  const total = files.reduce((n, f) => n + (f.type.startsWith("image/") && f.type !== "image/gif" ? Math.min(f.size, 250_000) : f.size), 0);
  const parsed = invites.map((c) => {
    if (!c.trim()) return null;
    try {
      return parseInvite(c);
    } catch (e) {
      return e as Error;
    }
  });
  const custodians = parsed.filter((p): p is { address: Hex; pubkey: Hex } => !!p && !(p instanceof Error));
  const dup = new Set(custodians.map((c) => c.address.toLowerCase())).size !== custodians.length;
  // A custodian key that already guards another vault would link the two vaults on chain. Ask for a fresh invite.
  const [reused, setReused] = useState<string[]>([]);
  const addrKey = custodians.map((c) => c.address).join(",");
  useEffect(() => {
    let live = true;
    Promise.all(custodians.map((c) => read((r) => envelopesFor(r, c.address)).then((e) => (e.length ? c.address : null)).catch(() => null)))
      .then((xs) => live && setReused(xs.filter((x): x is Hex => !!x)));
    return () => {
      live = false;
    };
  }, [addrKey]);
  const r = RHYTHMS.find((x) => x.id === rhythm)!;
  const ready = files.length > 0 && total <= MAX_BUNDLE_BYTES * 0.7 && custodians.length >= 2 && !dup && reused.length === 0 && k >= 2 && k <= custodians.length && agree && (mode === "public" || /^0x0[23][0-9a-fA-F]{64}$/.test(newsroom));

  const seal = async () => {
    setBusy(true);
    setErr(null);
    setLog([]);
    try {
      const sealed = sealVault({
        title, note, k,
        files: await Promise.all(files.map(prepareFile)),
        custodianPubKeys: custodians.map((c) => hexToBytes(c.pubkey)),
        beatTokens: key.tokens ?? undefined,
      });
      setLog((l) => [...l, { text: t("nv_enc", { n: files.length, c: sealed.chunks.length }) }]);
      const need = BigInt(sealed.chunks.length + 2) * 4_000_000_000_000_000n;
      if (ownGas) {
        setLog((l) => [...l, { text: t("nv_owngas_wait", { glm: formatEther(need), addr: account.address }) }]);
        await waitForOwnFunds(account.address, need, () => {});
      } else {
        await ensureGas(account.address, need);
      }
      const res = await createVault(walletClient(account), readClient(), {
        sealed, k, custodians, intervalS: r.interval, graceS: r.grace, mode,
        newsroomPubkey: mode === "newsroom" ? (newsroom as Hex) : undefined, listed, keepAliveByAnyone: anyoneKeeps,
      }, (p) => p.txHash && setLog((l) => [...l, { text: p.stage === "chunks" ? t("nv_chunk", { d: p.done, t: p.total }) : t("nv_manifest"), tx: p.txHash }]));
      setDone({ manifest: res.manifest, vaultId: sealed.vaultId });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const link = `${location.origin}${location.pathname}#${vaultPath(done.vaultId, account.address)}`;
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="font-serif text-2xl font-bold">{t("nv_done_t")}</h1>
        <p className="mt-2 text-sm">{t("nv_done_b", { i: duration(r.interval), g: duration(r.grace) })}</p>
        <Field label={t("nv_send_link")}>
          <div className="flex gap-2"><input readOnly className={inputCls} value={link} /><Copy text={link} /></div>
        </Field>
        <div className="mt-4 flex gap-2">
          <Link to={vaultPath(done.vaultId, account.address)}><Button>{t("nv_open")}</Button></Link>
          <Link to="/checkin"><Button variant="ghost">{t("nv_checkin")}</Button></Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card>
          <h2 className="font-serif text-lg font-bold">{t("nv_s1")}</h2>
          <p className="mt-1 text-sm text-muted">{t("nv_s1_b")}</p>
          <input type="file" multiple className="mt-3 block text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          {files.length > 0 && <p className="mt-2 text-xs text-muted">{t("nv_count", { n: files.length, size: fmtBytes(total) })}</p>}
          {total > MAX_BUNDLE_BYTES * 0.7 && <Notice tone="danger">{t("nv_too_big")}</Notice>}
          <div className="mt-4 grid gap-3">
            <Field label={t("nv_title_l")}><input className={inputCls} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label={t("nv_note_l")}><textarea className={inputCls} rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </Card>

        <Card>
          <h2 className="font-serif text-lg font-bold">{t("nv_s2")}</h2>
          <p className="mt-1 text-sm text-muted">{t("nv_s2_b")}</p>
          <div className="mt-3 space-y-2">
            {invites.map((c, i) => (
              <div key={i}>
                <input className={`${inputCls} font-mono text-xs`} placeholder="pol-custodian:0x…:0x…" value={c} onChange={(e) => setInvites(invites.map((x, j) => (j === i ? e.target.value : x)))} />
                {parsed[i] instanceof Error && <p className="mt-1 text-xs text-lapsed">{(parsed[i] as Error).message}</p>}
              </div>
            ))}
            {invites.length < 7 && <Button variant="ghost" onClick={() => setInvites([...invites, ""])}>{t("nv_add")}</Button>}
            {dup && <Notice tone="danger">{t("nv_dup")}</Notice>}
            {reused.length > 0 && <Notice tone="danger">{t("nv_reused")}</Notice>}
          </div>
          <Field label={t("nv_k", { k, n: Math.max(custodians.length, 2) })} hint={t("nv_k_hint")}>
            <input type="range" min={2} max={Math.max(custodians.length, 2)} value={k} onChange={(e) => setK(Number(e.target.value))} className="w-full" />
          </Field>
        </Card>

        <Card>
          <h2 className="font-serif text-lg font-bold">{t("nv_s3")}</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {RHYTHMS.map((x) => (
              <label key={x.id} className={`cursor-pointer rounded-xl border p-3 text-sm ${rhythm === x.id ? "border-ink" : "border-line"}`}>
                <input type="radio" className="mr-2" checked={rhythm === x.id} onChange={() => setRhythm(x.id)} />
                {t(x.label)} <span className="text-muted">· {t("nv_grace", { d: duration(x.grace) })}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-2">
            <label className="text-sm"><input type="radio" className="mr-2" checked={mode === "public"} onChange={() => setMode("public")} /> {t("nv_public")}</label>
            <label className="text-sm"><input type="radio" className="mr-2" checked={mode === "newsroom"} onChange={() => setMode("newsroom")} /> {t("nv_newsroom")}</label>
            {mode === "newsroom" && <input className={`${inputCls} font-mono text-xs`} placeholder={t("nv_newsroom_ph")} value={newsroom} onChange={(e) => setNewsroom(e.target.value.trim())} />}
          </div>
          <div className="mt-4 space-y-3">
            <label className="flex items-start justify-between gap-4 text-sm">
              <span><b>{t("nv_anyone_t")}</b><br /><span className="text-muted">{t("nv_anyone_b")}</span></span>
              <input type="checkbox" className="switch mt-1" checked={anyoneKeeps} onChange={(e) => setAnyoneKeeps(e.target.checked)} />
            </label>
            <label className="flex items-start justify-between gap-4 text-sm">
              <span><b>{t("nv_owngas_t")}</b><br /><span className="text-muted">{t("nv_owngas_b")}</span></span>
              <input type="checkbox" className="switch mt-1" checked={ownGas} onChange={(e) => setOwnGas(e.target.checked)} />
            </label>
            <label className="flex items-start justify-between gap-4 text-sm">
              <span><b>{t("nv_listed_t")}</b><br /><span className="text-muted">{t("nv_listed_b")}</span></span>
              <input type="checkbox" className="switch mt-1" checked={listed} onChange={(e) => setListed(e.target.checked)} />
            </label>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <h2 className="font-serif text-lg font-bold">{t("nv_what")}</h2>
          <table className="mt-3 w-full text-left text-xs">
            <thead><tr className="text-muted"><th className="py-1">{t("nv_pub_h")}</th><th>{t("nv_you_h")}</th></tr></thead>
            <tbody className="align-top">
              <tr><td className="py-1 pr-2">{t("nv_r1a")}</td><td>{t("nv_r1b")}</td></tr>
              <tr><td className="py-1 pr-2">{t("nv_r2a")}</td><td>{t("nv_r2b")}</td></tr>
              <tr><td className="py-1 pr-2">{t("nv_r3a")}</td><td>{t("nv_r3b")}</td></tr>
              <tr><td className="py-1 pr-2">{t("nv_r4a", { k, n: custodians.length || "n" })}</td><td>{t("nv_r4b")}</td></tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">{t("nv_watch")}</p>
          <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {t("nv_agree")}</label>
          <Button className="mt-4 w-full" disabled={!ready || busy} onClick={seal}>{busy ? t("nv_sealing") : t("nv_seal")}</Button>
          {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
          <ol className="mt-3 space-y-1 text-xs">
            {log.map((l, i) => <li key={i} className="flex justify-between gap-2"><span>{l.text}</span>{l.tx && <TxLink hash={l.tx} />}</li>)}
          </ol>
        </Card>
      </div>
    </div>
  );
}

/**
 * RTI replies are usually phone photos of paper. Photos over 300 KB are scaled to 1600 px on the long side and
 * re-encoded as JPEG on this phone before sealing, so a multi-page reply fits in one vault. Other files are untouched.
 */
async function prepareFile(f: File): Promise<{ name: string; type: string; bytes: Uint8Array }> {
  const raw = new Uint8Array(await f.arrayBuffer());
  if (!f.type.startsWith("image/") || f.type === "image/gif" || raw.length < 300_000) return { name: f.name, type: f.type || "application/octet-stream", bytes: raw };
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error("encode failed"))), "image/jpeg", 0.72));
    const out = new Uint8Array(await blob.arrayBuffer());
    return out.length < raw.length ? { name: f.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", bytes: out } : { name: f.name, type: f.type, bytes: raw };
  } catch {
    return { name: f.name, type: f.type, bytes: raw };
  }
}
