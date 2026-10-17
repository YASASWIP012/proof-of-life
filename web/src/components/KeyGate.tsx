// Unlock, create or restore keys. Nothing about a key is readable in this browser until its passphrase opens it.
import { useEffect, useState } from "react";
import type { SealedBlob } from "@proof-of-life/core";
import { backupFile, createKey, importBackup, loadBlobs, unlockAll, type OpenKey, type Role } from "../lib/keys";
import { short } from "../lib/format";
import { Button, Card, Field, Notice, inputCls } from "./ui";

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
    if (keys.length === 0) return setErr(`That passphrase opens no ${role} key in this browser.`);
    onReady(keys);
  };

  const doCreate = async () => {
    if (pass.length < 8) return setErr("Use at least 8 characters. A short sentence is best.");
    if (pass !== pass2) return setErr("The two passphrases differ.");
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
        <h2 className="font-serif text-lg font-bold">Your key is ready</h2>
        <p className="mt-2 text-sm">A backup file just downloaded. Keep it away from this phone, for example with someone you trust. Without your passphrase it is a few lines of random text.</p>
        <div className="mt-3"><Notice tone="warn">If you lose both this browser and the backup, you cannot check in, and the vault will be released when the deadline passes. That is how it is meant to work.</Notice></div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => onReady([fresh.key])}>Continue</Button>
          <Button variant="ghost" onClick={() => downloadBackup(fresh.blobs, `proof-of-life-${role}`)}>Download the backup again</Button>
        </div>
        <p className="mt-3 font-mono text-xs text-muted">Key address {short(fresh.key.account.address)}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="font-serif text-lg font-bold">{title}</h2>
      {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      {!forceNew && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {stored > 0 && <button className={`rounded-lg px-3 py-1.5 ${mode === "unlock" ? "bg-line/60 font-semibold" : ""}`} onClick={() => setMode("unlock")}>Unlock</button>}
          <button className={`rounded-lg px-3 py-1.5 ${mode === "new" ? "bg-line/60 font-semibold" : ""}`} onClick={() => setMode("new")}>Make a new key</button>
          <label className="cursor-pointer rounded-lg px-3 py-1.5 text-muted hover:text-ink">
            Restore a backup
            <input type="file" accept="application/json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const n = importBackup(await f.text());
                setErr(null);
                setMode("unlock");
                setLabel(`${n} key${n === 1 ? "" : "s"} restored. Enter the passphrase.`);
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
            <Field label="Passphrase">
              <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doUnlock()} autoComplete="current-password" />
            </Field>
            <Button onClick={doUnlock} disabled={busy || !pass}>{busy ? "Unlocking…" : "Unlock"}</Button>
          </>
        ) : (
          <>
            <Field label="A label only you will see" hint="Shown after you unlock, to tell keys apart. Never a real name.">
              <input className={inputCls} value={label} maxLength={24} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Passphrase" hint="At least 8 characters. A sentence only you would write works well. You can use the same one for every vault.">
              <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Passphrase again">
              <input type="password" className={inputCls} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
            </Field>
            {offerDuress && (
              <Field label="Duress passphrase (optional)" hint="If someone forces you to check in, use this one instead. The check-in looks normal on your screen and on the public vault page. Its encrypted note tells your custodians to release now. Nothing stored on this phone shows that a duress passphrase exists.">
                <input type="password" className={inputCls} value={duress} onChange={(e) => setDuress(e.target.value)} autoComplete="new-password" />
              </Field>
            )}
            <Button onClick={doCreate} disabled={busy}>{busy ? "Making the key…" : "Make the key and download its backup"}</Button>
          </>
        )}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Card>
  );
}
