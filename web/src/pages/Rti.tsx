// The RTI clock: deadlines and a drafted First Appeal for a real RTI application, worked out in the browser.
// The only thing that can leave the device is a salted commitment to the application, and only if the filer records it.
import { bytesToHex, checkRtiReceipt, explorerAddress, loadRti, randomBytes, recordRti, rtiClock, rtiCommitment, RtiReceipt, sha256Hex, utf8, walletClient, type RtiKind, type RtiView } from "@proof-of-life/core";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Hex } from "viem";
import { Button, Card, Copy, Field, Notice, PageHead, TxLink, inputCls } from "../components/ui";
import { SITE_URL } from "../lib/config";
import { duration, short } from "../lib/format";
import { LANG_NAMES, useI18n, type Lang } from "../lib/i18n";
import { newSecret } from "../lib/keys";
import { read, readClient } from "../lib/net";
import { en, type Strings } from "../lib/strings.en";
import { hi } from "../lib/strings.hi";
import { te } from "../lib/strings.te";
import { ensureGas } from "../lib/tap";

const ACT_URL = "https://indiacode.gov.in/act/6fa557d9-5620-4002-ba6c-aef1ee6daca0/sections";
const DICTS: Record<Lang, Partial<Strings>> = { en, hi, te };
const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", te: "te-IN" };
const isHash = (h: string | null): h is Hex => !!h && /^0x[0-9a-f]{64}$/.test(h);
const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Date and time are formatted apart: some locales wrap a joined date-time in words ("को … बजे") that the letters already supply.
function fmt(ms: number, lang: Lang, withTime = false) {
  const day = new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "long", year: "numeric" }).format(ms);
  return withTime ? `${day}, ${new Intl.DateTimeFormat(LOCALE[lang], { hour: "numeric", minute: "2-digit" }).format(ms)}` : day;
}

/** The application text is trimmed and its line endings made \n, so the same text pasted twice gives the same hash. */
const textHash = (s: string) => sha256Hex(utf8(s.replace(/\r\n?/g, "\n").trim()));

export default function Rti() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(params.get("d") ?? localDate());
  const [time, setTime] = useState(params.get("tm") ?? "10:00");
  const [kind, setKind] = useState<RtiKind>(params.get("k") === "life" ? "life" : "normal");
  const [apio, setApio] = useState(params.get("a") === "1");
  const [fee, setFee] = useState(Math.max(0, Number(params.get("f")) || 0));
  // The application's own hash never leaves this tab. Arkiv and the link carry only the salted commitment.
  const [fileHash, setFileHash] = useState<Hex | null>(null);
  const [commitment, setCommitment] = useState<Hex | null>(isHash(params.get("c")) ? (params.get("c") as Hex) : null);
  const [receipt, setReceipt] = useState<RtiReceipt | null>(null);
  const [atBlock, setAtBlock] = useState<bigint | null>(/^\d+$/.test(params.get("b") ?? "") ? BigInt(params.get("b")!) : null);
  const [text, setText] = useState("");
  const [view, setView] = useState<RtiView | null>(null);
  const [step, setStep] = useState<"idle" | "gas" | "write">("idle");
  const [tx, setTx] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const receivedMs = new Date(`${date}T${kind === "life" ? time : "10:00"}`).getTime();
  const valid = Number.isFinite(receivedMs);
  const input = { receivedMs, kind, apio, feeDays: fee };
  const first = valid ? rtiClock(input) : null;
  const passed = !!first && now > first.replyDueMs;
  // Once the reply is overdue, the appeal dates count from today, the earliest day the appeal can now go in.
  const clock = first && passed ? rtiClock({ ...input, appealMs: Math.max(now, first.appealMs) }) : first;

  // The link carries the form, so it reopens the same deadlines. It lives after the #, so no server ever sees it.
  const query = useMemo(() => {
    const q = new URLSearchParams({ d: date, k: kind });
    if (kind === "life") q.set("tm", time);
    if (apio) q.set("a", "1");
    if (fee) q.set("f", String(fee));
    if (commitment) q.set("c", commitment);
    if (atBlock !== null) q.set("b", atBlock.toString());
    return q;
  }, [date, time, kind, apio, fee, commitment, atBlock]);
  useEffect(() => setParams(query, { replace: true }), [query]);
  // A saved link opened while this page is already showing: take the form from it.
  useEffect(() => {
    if (params.toString() === query.toString()) return;
    const c = params.get("c");
    const b = params.get("b") ?? "";
    setDate(params.get("d") ?? localDate());
    setTime(params.get("tm") ?? "10:00");
    setKind(params.get("k") === "life" ? "life" : "normal");
    setApio(params.get("a") === "1");
    setFee(Math.max(0, Number(params.get("f")) || 0));
    setCommitment(isHash(c) ? c : null);
    setReceipt(null);
    setAtBlock(/^\d+$/.test(b) ? BigInt(b) : null);
    setText("");
    setTx(null);
  }, [params]);
  const link = `${SITE_URL}/#/rti?${query.toString()}`;

  useEffect(() => {
    if (!commitment) return setView(null);
    let live = true;
    setView(null);
    read((c) => loadRti(c, commitment, { atBlock: atBlock ?? undefined }))
      .then((v) => {
        if (!live) return;
        setView(v);
        if (v.record && atBlock === null) setAtBlock(v.record.createdAt);
      })
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [commitment, atBlock]);

  useEffect(() => {
    if (!text.trim()) return;
    const id = setTimeout(() => {
      setErr(null);
      setFileHash(textHash(text));
    }, 500);
    return () => clearTimeout(id);
  }, [text]);

  async function pickFile(f: File | undefined) {
    if (!f) return;
    setErr(null);
    setFileHash(sha256Hex(new Uint8Array(await f.arrayBuffer())));
  }

  async function openReceipt(f: File | undefined) {
    if (!f) return;
    setErr(null);
    try {
      const r = RtiReceipt.parse(JSON.parse(await f.text()));
      if (!checkRtiReceipt(r).consistent) throw new Error();
      setReceipt(r);
      setTx(null);
      setCommitment(r.commitment as Hex);
      setAtBlock(BigInt(r.block));
    } catch {
      setErr(t("rti_rec_badreceipt"));
    }
  }

  function downloadReceipt(r: RtiReceipt) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
    a.download = `rti-receipt-block-${r.block}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function record() {
    if (!fileHash || !clock) return;
    setErr(null);
    try {
      // A fresh salt per recording. It goes into the receipt and nowhere else.
      const salt = bytesToHex(randomBytes(32)) as Hex;
      const c = rtiCommitment(salt, fileHash);
      const key = newSecret();
      setStep("gas");
      await ensureGas(key.account.address);
      setStep("write");
      const r = await recordRti(walletClient(key.account), readClient(), { commitment: c, dueMs: clock.replyDueMs });
      const v = await read((cl) => loadRti(cl, c));
      const block = v.record?.createdAt ?? null;
      setReceipt({ v: 2, kind: "proof-of-life/rti-receipt", salt, sha256: fileHash, commitment: c, key: r.key.toLowerCase(), block: String(block ?? 0n), due_block: r.dueBlock.toString(), tx: r.txHash });
      setTx(r.txHash);
      setView(v);
      setCommitment(c);
      setAtBlock(block);
    } catch (e) {
      setErr((e as Error).message.slice(0, 240));
    } finally {
      setStep("idle");
    }
  }

  const rec = view?.record ?? null;
  const match = receipt && fileHash ? checkRtiReceipt(receipt, fileHash).matchesFile : null;
  const overdue = passed || !!view?.duePassed;
  const withTime = kind === "life";

  return (
    <div className="space-y-8">
      <PageHead eyebrow={t("rti_eyebrow")} title={t("rti_title")} lead={t("rti_lead")} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card className="space-y-5 self-start">
          <h2 className="t-title">{t("rti_form_t")}</h2>
          <Field label={t("rti_received")} hint={t("rti_received_hint")}>
            <div className="flex gap-2">
              <input type="date" className={inputCls} value={date} max={localDate()} onChange={(e) => setDate(e.target.value)} />
              {kind === "life" && <input type="time" aria-label={t("rti_time")} className={`${inputCls} max-w-[140px]`} value={time} onChange={(e) => setTime(e.target.value)} />}
            </div>
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-[14.5px] font-semibold">{t("rti_kind")}</legend>
            {(["normal", "life"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-[14.5px]">
                <input type="radio" name="rti-kind" checked={kind === k} onChange={() => setKind(k)} /> {t(k === "normal" ? "rti_kind_normal" : "rti_kind_life")}
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-3 text-[14.5px]">
            <input type="checkbox" className="switch mt-1" checked={apio} onChange={(e) => setApio(e.target.checked)} />
            <span>{t("rti_apio")}</span>
          </label>
          <Field label={t("rti_fee")} hint={t("rti_fee_hint")}>
            <input type="number" min={0} max={365} className={`${inputCls} max-w-[120px]`} value={fee} onChange={(e) => setFee(Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0))))} />
          </Field>
        </Card>

        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="t-title">{t("rti_tl_t")}</h2>
            {clock && (
              <span className="chip" style={{ color: overdue ? "var(--lapsed)" : "var(--alive)" }}>
                <span className={`h-2 w-2 rounded-full ${overdue ? "" : "beat"}`} style={{ background: overdue ? "var(--lapsed)" : "var(--alive)" }} />
                {overdue ? t("rti_passed") : t("rti_left", { n: duration((clock.replyDueMs - now) / 1000) })}
              </span>
            )}
          </div>
          {clock && (
            <ol className="space-y-4">
              <Row label={t("rti_due")} when={fmt(clock.replyDueMs, lang, withTime)} note={`${t("rti_due_s")}${apio ? ` · ${t("rti_due_apio")}` : ""}`} accent />
              <Row label={t("rti_deemed")} when="" note={t("rti_deemed_s")} />
              <Row label={t("rti_fa")} when={fmt(clock.firstAppealByMs, lang)} note={t("rti_fa_s")} />
              <Row label={t("rti_faa")} when={fmt(clock.faaDecisionDueMs, lang)} note={t("rti_faa_s", { date: fmt(clock.appealMs, lang) })} />
              <Row label={t("rti_sa")} when={fmt(clock.secondAppealByMs, lang)} note={t("rti_sa_s")} />
            </ol>
          )}
          <p className="text-[13px] leading-snug text-muted">
            {t("rti_source")}{" "}
            <a className="underline decoration-dotted underline-offset-2 hover:text-ink" href={ACT_URL} target="_blank" rel="noreferrer">{t("rti_source_link")}</a>
          </p>
        </Card>
      </div>

      <Card className="space-y-4">
        <h2 className="t-title">{t("rti_rec_t")}</h2>
        <p className="max-w-[760px] text-[14.5px] leading-relaxed text-ink-2">{t("rti_rec_lead")}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("rti_rec_file")}>
            <input type="file" className="block w-full text-[14px]" onChange={(e) => pickFile(e.target.files?.[0])} />
          </Field>
          <Field label={t("rti_rec_text")}>
            <textarea className={inputCls} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
        {fileHash && (
          <div className="space-y-1">
            <p className="text-[13px] font-semibold text-muted">{t("rti_rec_hash")}</p>
            <p className="t-mono mono-wrap text-[12.5px]">{fileHash}</p>
          </div>
        )}
        {receipt && fileHash && (!match ? <Notice tone="danger">{t("rti_rec_nomatch")}</Notice> : rec && receipt.commitment === commitment ? <Notice>{t("rti_rec_match")}</Notice> : null)}
        {receipt && view && !rec && <Notice tone="warn">{t("rti_rec_norecord")}</Notice>}
        {fileHash && !(receipt && receipt.sha256 === fileHash) && (
          passed ? (
            <Notice tone="warn">{t("rti_rec_late")}</Notice>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={record} disabled={step !== "idle"}>{step === "gas" ? t("rti_rec_gas") : step === "write" ? t("rti_rec_write") : t("rti_rec_go")}</Button>
              <span className="text-[13.5px] text-muted">{t("rti_rec_none")}</span>
            </div>
          )
        )}
        <label className="flex flex-wrap items-center gap-3 text-[14px]">
          <span className="font-semibold">{t("rti_rec_open")}</span>
          <input type="file" accept="application/json,.json" className="text-[13.5px]" onChange={(e) => openReceipt(e.target.files?.[0])} />
        </label>
        {rec && view && (
          <div className="space-y-2 rounded-[14px] bg-paper-alt px-4 py-3 text-[14px] leading-relaxed">
            <p className="font-semibold">{t("rti_rec_t2")}</p>
            <p>
              {t("rti_rec_by", { block: rec.createdAt.toString(), time: view.createdMs ? fmt(view.createdMs, lang, true) : "", addr: short(rec.creator) })}{" "}
              <a className="underline decoration-dotted underline-offset-2" href={explorerAddress(rec.creator)} target="_blank" rel="noreferrer">↗</a>
            </p>
            <p>{view.expired ? t("rti_rec_gone", { block: rec.expiresAt.toString(), at: (atBlock ?? rec.createdAt).toString() }) : t("rti_rec_live", { block: rec.expiresAt.toString(), due: rec.dueBlock.toString() })}</p>
            <p className="text-muted">{t("rti_rec_commit")} <span className="t-mono mono-wrap text-[12px]">{commitment}</span></p>
            {tx && <p>{t("rti_rec_tx")}: <TxLink hash={tx} /></p>}
            {receipt && receipt.commitment === commitment ? (
              <div className="space-y-2 pt-1">
                <p>{t("rti_rec_receipt_s")}</p>
                <Button size="sm" onClick={() => downloadReceipt(receipt)}>{t("rti_rec_receipt")}</Button>
              </div>
            ) : (
              <p className="text-muted">{t("rti_rec_needreceipt")}</p>
            )}
            <p className="pt-1 text-muted">{t("rti_rec_link")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-mono mono-wrap text-[12px]">{link}</span>
              <Copy text={link} />
            </div>
          </div>
        )}
        {view && view.rejected.length > 0 && <p className="text-[13px] text-muted">{t("rti_rec_rejected", { n: view.rejected.length })}</p>}
        {err && <Notice tone="danger">{err}</Notice>}
        <p className="text-[13px] text-muted">{t("rti_rec_net")}</p>
      </Card>

      {clock && <Letter clock={clock} overdue={overdue} receivedMs={receivedMs} withTime={withTime} now={now} record={rec && view ? { block: rec.createdAt, ms: view.createdMs ?? 0, link } : null} />}
    </div>
  );
}

function Row({ label, when, note, accent = false }: { label: string; when: string; note: string; accent?: boolean }) {
  return (
    <li className="grid gap-1 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">{label}</p>
        {when && <p className={`text-[17px] font-semibold ${accent ? "text-ink" : "text-ink-2"}`}>{when}</p>}
      </div>
      <p className="text-[14px] leading-snug text-ink-2">{note}</p>
    </li>
  );
}

type Fields = { name: string; addr: string; auth: string; pio: string; reg: string; subject: string; reason: string };

function Letter({ clock, overdue, receivedMs, withTime, now, record }: { clock: ReturnType<typeof rtiClock>; overdue: boolean; receivedMs: number; withTime: boolean; now: number; record: { block: bigint; ms: number; link: string } | null }) {
  const { t, lang } = useI18n();
  const [ll, setLl] = useState<Lang>(lang);
  const [f, setF] = useState<Fields>({ name: "", addr: "", auth: "", pio: "", reg: "", subject: "", reason: "" });
  useEffect(() => setLl(lang), [lang]);
  const L = (k: keyof Strings, vars: Record<string, string> = {}) => {
    let s = DICTS[ll][k] ?? en[k];
    for (const [name, v] of Object.entries(vars)) s = s.replaceAll(`{${name}}`, v);
    return s;
  };
  const v = (k: keyof Fields, ph: keyof Strings) => f[k].trim() || L(ph);
  const late = now > clock.firstAppealByMs;
  const letter = L("rti_letter_body", {
    auth: v("auth", "rti_ph_auth"),
    name: v("name", "rti_ph_name"),
    addr: v("addr", "rti_ph_addr"),
    pio: v("pio", "rti_ph_pio"),
    reg: v("reg", "rti_ph_reg"),
    subject: v("subject", "rti_ph_subject"),
    today: fmt(now, ll),
    filed: fmt(receivedMs, ll, withTime),
    due: fmt(clock.replyDueMs, ll, withTime),
    timing: late ? L("rti_letter_late", { reason: v("reason", "rti_ph_reason") }) : L("rti_letter_intime"),
    record: record ? L("rti_letter_record", { block: record.block.toString(), time: fmt(record.ms, ll, true), link: record.link }) : "",
  });

  useEffect(() => {
    const done = () => document.body.classList.remove("print-letter");
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);
  const print = () => {
    document.body.classList.add("print-letter");
    window.print();
  };

  const input = (k: keyof Fields, label: keyof Strings, area = false) => (
    <Field label={t(label)}>
      {area ? <textarea className={inputCls} rows={2} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <input className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
    </Field>
  );

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-title">{t("rti_letter_t")}</h2>
        {overdue && (
          <span className="chip" style={{ color: "var(--lapsed)" }}>
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--lapsed)" }} />
            {t("rti_passed")}
          </span>
        )}
      </div>
      {!overdue && <Notice>{t("rti_letter_early")}</Notice>}
      <p className="text-[14.5px] text-ink-2">{t("rti_letter_lead")}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {input("name", "rti_l_name")}
        {input("auth", "rti_l_auth")}
        {input("addr", "rti_l_addr", true)}
        {input("subject", "rti_l_subject", true)}
        {input("pio", "rti_l_pio")}
        {input("reg", "rti_l_reg")}
        {late && input("reason", "rti_l_reason")}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[14.5px] font-semibold">{t("rti_l_lang")}</span>
        <div className="segmented" role="tablist">
          {(Object.keys(LANG_NAMES) as Lang[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={ll === k} onClick={() => setLl(k)}>{LANG_NAMES[k]}</button>
          ))}
        </div>
      </div>
      <pre id="rti-letter" lang={ll} className="whitespace-pre-wrap break-words rounded-[14px] bg-paper-alt p-5 [font-family:inherit] text-[14.5px] leading-relaxed text-ink">{letter}</pre>
      <div className="flex flex-wrap gap-2">
        <Copy text={letter} label={t("rti_l_copy")} />
        <Button variant="ghost" size="sm" onClick={print}>{t("rti_l_print")}</Button>
      </div>
    </Card>
  );
}
