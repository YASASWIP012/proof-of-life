// Pick, unlock, create or restore a key for one role. Keys never leave this browser except as the
// passphrase-wrapped backup file the person downloads.
import { useEffect, useState } from "react";
import type { PrivateKeyAccount } from "viem/accounts";
import { backupBlob, createKey, getUnlocked, importBackup, loadKeys, unlock, type Role, type StoredKey } from "../lib/keys";
import { short } from "../lib/format";
import { Button, Card, Field, Notice, inputCls } from "./ui";

export type Unlocked = PrivateKeyAccount & { secret: Uint8Array };

export function useKeys(role: Role) {
  const [keys, setKeys] = useState(() => loadKeys().filter((k) => k.role === role));
  useEffect(() => {
    const on = () => setKeys(loadKeys().filter((k) => k.role === role));
    window.addEventListener("pol-keys", on);
    return () => window.removeEventListener("pol-keys", on);
  }, [role]);
  return keys;
}

export function downloadBackup(k: StoredKey) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(backupBlob(k));
  a.download = `proof-of-life-${k.role}-${k.address.slice(2, 8)}.json`;
  a.click();
}

export function KeyGate({ role, onReady, title }: { role: Role; onReady: (a: Unlocked, k: StoredKey) => void; title: string }) {
  const keys = useKeys(role);
  const [mode, setMode] = useState<"pick" | "new">(keys.length ? "pick" : "new");
  const [sel, setSel] = useState(keys[0]?.address ?? "");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [label, setLabel] = useState(role === "activist" ? "my phone" : "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<StoredKey | null>(null);

  const doUnlock = async () => {
    const k = keys.find((x) => x.address === sel);
    if (!k) return;
    setBusy(true);
    setErr(null);
    try {
      const a = getUnlocked(k.address) ?? (await unlock(k, pass));
      onReady(a, k);
    } catch {
      setErr("That passphrase does not open this key.");
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    if (pass.length < 8) return setErr("Use at least 8 characters. A short sentence is best.");
    if (pass !== pass2) return setErr("The two passphrases differ.");
    setBusy(true);
    setErr(null);
    try {
      const k = await createKey(role, pass, label || role);
      downloadBackup(k);
      setFresh(k);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (f: File) => {
    try {
      const k = importBackup(await f.text());
      setSel(k.address);
      setMode("pick");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (fresh) {
    return (
      <Card>
        <h2 className="font-serif text-lg font-bold">Your key is ready</h2>
        <p className="mt-2 text-sm">A backup file just downloaded. Keep it somewhere safe and separate from this phone, for example with a person you trust. It is useless without your passphrase.</p>
        <Notice tone="warn">If you lose both this browser and the backup, you cannot check in, and your vault will be released when the deadline passes. That is the design.</Notice>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => onReady(getUnlocked(fresh.address)!, fresh)}>Continue</Button>
          <Button variant="ghost" onClick={() => downloadBackup(fresh)}>Download backup again</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="font-serif text-lg font-bold">{title}</h2>
      <div className="mt-3 flex gap-2 text-sm">
        {keys.length > 0 && <button className={`rounded-lg px-3 py-1.5 ${mode === "pick" ? "bg-line/60 font-semibold" : ""}`} onClick={() => setMode("pick")}>Use a saved key</button>}
        <button className={`rounded-lg px-3 py-1.5 ${mode === "new" ? "bg-line/60 font-semibold" : ""}`} onClick={() => setMode("new")}>Make a new key</button>
        <label className="cursor-pointer rounded-lg px-3 py-1.5 text-muted hover:text-ink">
          Restore a backup
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        </label>
      </div>
      <div className="mt-4 space-y-3">
        {mode === "pick" ? (
          <>
            <Field label="Key">
              <select className={inputCls} value={sel} onChange={(e) => setSel(e.target.value)}>
                {keys.map((k) => <option key={k.address} value={k.address}>{k.label} · {short(k.address, 4)}</option>)}
              </select>
            </Field>
            <Field label="Passphrase">
              <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doUnlock()} autoComplete="current-password" />
            </Field>
            <Button onClick={doUnlock} disabled={busy || !sel}>{busy ? "Unlocking…" : "Unlock"}</Button>
          </>
        ) : (
          <>
            <Field label="Label for this key" hint="Only you see it. Never use a real name.">
              <input className={inputCls} value={label} maxLength={24} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Passphrase" hint="At least 8 characters. A sentence only you would write works well.">
              <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Passphrase again">
              <input type="password" className={inputCls} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
            </Field>
            <Button onClick={doCreate} disabled={busy}>{busy ? "Making the key…" : "Make key and download backup"}</Button>
          </>
        )}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Card>
  );
}
