// Unlock, create or restore keys. Nothing about a key is readable in this browser until its passphrase opens it.
import { useEffect, useState } from "react";
import type { SealedBlob } from "@proof-of-life/core";
import { backupFile, createKey, importBackup, loadBlobs, unlockAll, type OpenKey, type Role } from "../lib/keys";
import { short } from "../lib/format";
import { Button, Card, Field, Notice, inputCls } from "./ui";
import { useI18n } from "../lib/i18n";

export function useBlobCount() {
  const [n, setN] = useState(() => loadBlobs().length);
  useEffect(() => {
    const on = () => setN(loadBlobs().length);
    window.addEventListener("pol-keys", on);
    return () => window.removeEventListener("pol-keys", on);
  }, []);
  return n;
}

export function downloadBackup(blobs: SealedBlob[], name = "proof-of-life-keys") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(backupFile(blobs));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

type Props = {
  role: Role;
  title: string;
  intro?: string;
  /** Skip "unlock": every vault gets a key that has never written anything else. */
  forceNew?: boolean;
  /** Offer a duress passphrase while creating. Activists only. */
  offerDuress?: boolean;
  onReady: (keys: OpenKey[]) => void;
};

export function KeyGate({ role, title, intro, forceNew = false, offerDuress = false, onReady }: Props) {
  const { t } = useI18n();
  const stored = useBlobCount();
  const [mode, setMode] = useState<"unlock" | "new">(stored && !forceNew ? "unlock" : "new");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [duress, setDuress] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ key: OpenKey; blobs: SealedBlob[] } | null>(null);

  const doUnlock = async () => {
    setBusy(true);
    setErr(null);
    const keys = (await unlockAll(pass)).filter((k) => k.role === role);
    setBusy(false);
    if (keys.length === 0) return setErr(t(role === "activist" ? "kg_no_key_activist" : "kg_no_key_custodian"));
    onReady(keys);
  };

  const doCreate = async () => {
    if (pass.length < 8) return setErr(t("kg_short"));
    if (pass !== pass2) return setErr(t("kg_differ"));
    setBusy(true);
    setErr(null);
    try {
      const made = await createKey(role, pass, label.trim() || role, duress || undefined);
      downloadBackup(made.blobs, `proof-of-life-${role}`);
      setFresh(made);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (fresh) {
    return (
      <Card>
        <h2 className="font-serif text-lg font-bold">{t("kg_ready_t")}</h2>
        <p className="mt-2 text-sm">{t("kg_ready_b")}</p>
        <div className="mt-3"><Notice tone="warn">{t("kg_ready_warn")}</Notice></div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => onReady([fresh.key])}>{t("kg_continue")}</Button>
          <Button variant="ghost" onClick={() => downloadBackup(fresh.blobs, `proof-of-life-${role}`)}>{t("kg_again")}</Button>
        </div>
        <p className="mt-3 font-mono text-xs text-muted">{t("kg_addr")} {short(fresh.key.account.address)}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="font-serif text-lg font-bold">{title}</h2>
      {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      {!forceNew && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {stored > 0 && <button className={`rounded-lg px-3 py-1.5 ${mode === "unlock" ? "bg-line/60 font-semibold" : ""}`} onClick={() => setMode("unlock")}>{t("kg_unlock")}</button>}
          <button className={`rounded-lg px-3 py-1.5 ${mode === "new" ? "bg-line/60 font-semibold" : ""}`} onClick={() => setMode("new")}>{t("kg_new")}</button>
          <label className="cursor-pointer rounded-lg px-3 py-1.5 text-muted hover:text-ink">
            {t("kg_restore")}
            <input type="file" accept="application/json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const n = importBackup(await f.text());
                setErr(null);
                setMode("unlock");
                setLabel(t("kg_restored", { n }));
              } catch (x) {
                setErr((x as Error).message);
              }
            }} />
          </label>
        </div>
      )}
      <div className="mt-4 space-y-3">
        {mode === "unlock" ? (
          <>
            {label && <p className="text-sm text-muted">{label}</p>}
            <Field label={t("kg_pass")}>
              <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doUnlock()} autoComplete="current-password" />
            </Field>
            <Button onClick={doUnlock} disabled={busy || !pass}>{busy ? t("kg_unlocking") : t("kg_unlock")}</Button>
          </>
        ) : (
          <>
            <Field label={t("kg_label")} hint={t("kg_label_hint")}>
              <input className={inputCls} value={label} maxLength={24} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label={t("kg_pass")} hint={t("kg_pass_hint")}>
              <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label={t("kg_pass2")}>
              <input type="password" className={inputCls} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
            </Field>
            {offerDuress && (
              <Field label={t("kg_duress")} hint={t("kg_duress_hint")}>
                <input type="password" className={inputCls} value={duress} onChange={(e) => setDuress(e.target.value)} autoComplete="new-password" />
              </Field>
            )}
            <Button onClick={doCreate} disabled={busy}>{busy ? t("kg_making") : t("kg_make")}</Button>
          </>
        )}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Card>
  );
}
