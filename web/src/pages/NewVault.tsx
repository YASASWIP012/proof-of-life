// Sealing a real vault: files are encrypted here, split among custodians, and written to Arkiv sealed.
import { createVault, hexToBytes, MAX_BUNDLE_BYTES, sealVault, walletClient, type Manifest } from "@proof-of-life/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Hex } from "viem";
import { KeyGate, type Unlocked } from "../components/KeyGate";
import { Button, Card, Copy, Field, Notice, TxLink, inputCls } from "../components/ui";
import { duration, fmtBytes, vaultPath } from "../lib/format";
import { attachVault, parseInvite, type StoredKey } from "../lib/keys";
import { readClient } from "../lib/net";
import { ensureGas } from "../lib/tap";

const RHYTHMS = [
  { id: "daily", label: "Every day", interval: 86_400, grace: 86_400 },
  { id: "weekly", label: "Every week", interval: 7 * 86_400, grace: 3 * 86_400 },
  { id: "fortnight", label: "Every two weeks", interval: 14 * 86_400, grace: 7 * 86_400 },
  { id: "monthly", label: "Every month", interval: 30 * 86_400, grace: 7 * 86_400 },
  { id: "test", label: "Test: every 10 minutes", interval: 600, grace: 300 },
] as const;

export default function NewVault() {
  const [acct, setAcct] = useState<{ a: Unlocked; k: StoredKey } | null>(null);
  if (!acct) return <div className="mx-auto max-w-xl"><KeyGate role="activist" title="First, your activist key" onReady={(a, k) => setAcct({ a, k })} /></div>;
  return <Form account={acct.a} />;
}

function Form({ account }: { account: Unlocked }) {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [invites, setInvites] = useState(["", "", ""]);
  const [k, setK] = useState(2);
  const [rhythm, setRhythm] = useState<(typeof RHYTHMS)[number]["id"]>("weekly");
  const [mode, setMode] = useState<"public" | "newsroom">("public");
  const [newsroom, setNewsroom] = useState("");
  const [tag, setTag] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ text: string; tx?: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ manifest: Manifest; vaultId: Hex } | null>(null);

  const total = files.reduce((n, f) => n + f.size, 0);
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
  const r = RHYTHMS.find((x) => x.id === rhythm)!;
  const ready = files.length > 0 && total <= MAX_BUNDLE_BYTES * 0.7 && custodians.length >= 2 && !dup && k >= 2 && k <= custodians.length && agree && (mode === "public" || /^0x0[23][0-9a-fA-F]{64}$/.test(newsroom)) && !/\s{2,}/.test(tag);

  const seal = async () => {
    setBusy(true);
    setErr(null);
    setLog([]);
    try {
      const sealed = sealVault({
        title, note, k,
        files: await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type || "application/octet-stream", bytes: new Uint8Array(await f.arrayBuffer()) }))),
        custodianPubKeys: custodians.map((c) => hexToBytes(c.pubkey)),
      });
      setLog((l) => [...l, { text: `Encrypted ${files.length} file(s) in this browser; ${sealed.chunks.length} ciphertext chunk(s).` }]);
      await ensureGas(account.address, BigInt(sealed.chunks.length + 2) * 4_000_000_000_000_000n);
      const res = await createVault(walletClient(account), readClient(), {
        sealed, k, custodians, intervalS: r.interval, graceS: r.grace, mode,
        newsroomPubkey: mode === "newsroom" ? (newsroom as Hex) : undefined, tag: tag.trim().slice(0, 24),
      }, (p) => p.txHash && setLog((l) => [...l, { text: p.stage === "chunks" ? `Chunk ${p.done}/${p.total} sealed` : "Manifest, envelopes and heartbeat sealed together", tx: p.txHash }]));
      attachVault(account.address, { vaultId: sealed.vaultId, creator: account.address });
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
        <h1 className="font-serif text-2xl font-bold">Sealed. Your heartbeat has started.</h1>
        <p className="mt-2 text-sm">Check in within {duration(r.interval)}. You have {duration(r.grace)} of grace after that.</p>
        <Field label="Send this link to each custodian">
          <div className="flex gap-2"><input readOnly className={inputCls} value={link} /><Copy text={link} /></div>
        </Field>
        <div className="mt-4 flex gap-2">
          <Link to={vaultPath(done.vaultId, account.address)}><Button>Open the vault page</Button></Link>
          <Link to="/checkin"><Button variant="ghost">Check-in page</Button></Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-6">
        <Card>
          <h2 className="font-serif text-lg font-bold">1 · Documents</h2>
          <p className="mt-1 text-sm text-muted">Up to about 1.4 MB in total. Scans of RTI replies, notes, photos. Test documents only on this testnet.</p>
          <input type="file" multiple className="mt-3 block text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          {files.length > 0 && <p className="mt-2 text-xs text-muted">{files.length} file(s) · {fmtBytes(total)}</p>}
          {total > MAX_BUNDLE_BYTES * 0.7 && <Notice tone="danger">Too large. Keep the total under 1.4 MB.</Notice>}
          <div className="mt-4 grid gap-3">
            <Field label="Title (encrypted, only readable after release)"><input className={inputCls} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="A note for whoever reads this after release (encrypted)"><textarea className={inputCls} rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </Card>

        <Card>
          <h2 className="font-serif text-lg font-bold">2 · Custodians</h2>
          <p className="mt-1 text-sm text-muted">Ask each person to open the Custodians page and send you their invite code. Each code is a fresh key made for your vault only, so nothing on Arkiv links it to who they are.</p>
          <div className="mt-3 space-y-2">
            {invites.map((c, i) => (
              <div key={i}>
                <input className={`${inputCls} font-mono text-xs`} placeholder="pol-custodian:0x…:0x…" value={c} onChange={(e) => setInvites(invites.map((x, j) => (j === i ? e.target.value : x)))} />
                {parsed[i] instanceof Error && <p className="mt-1 text-xs text-lapsed">{(parsed[i] as Error).message}</p>}
              </div>
            ))}
            {invites.length < 7 && <Button variant="ghost" onClick={() => setInvites([...invites, ""])}>Add a custodian</Button>}
            {dup && <Notice tone="danger">The same custodian appears twice.</Notice>}
          </div>
          <Field label={`How many must act together to release: ${k} of ${Math.max(custodians.length, 2)}`} hint="Two or more protects you from one custodian acting alone. Fewer than all protects you from one being unreachable.">
            <input type="range" min={2} max={Math.max(custodians.length, 2)} value={k} onChange={(e) => setK(Number(e.target.value))} className="w-full" />
          </Field>
        </Card>

        <Card>
          <h2 className="font-serif text-lg font-bold">3 · Rhythm and release</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {RHYTHMS.map((x) => (
              <label key={x.id} className={`cursor-pointer rounded-xl border p-3 text-sm ${rhythm === x.id ? "border-ink" : "border-line"}`}>
                <input type="radio" className="mr-2" checked={rhythm === x.id} onChange={() => setRhythm(x.id)} />
                {x.label} <span className="text-muted">· grace {duration(x.grace)}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-2">
            <label className="text-sm"><input type="radio" className="mr-2" checked={mode === "public"} onChange={() => setMode("public")} /> Release to everyone. Anyone can open the documents once enough pieces are out.</label>
            <label className="text-sm"><input type="radio" className="mr-2" checked={mode === "newsroom"} onChange={() => setMode("newsroom")} /> Release to one newsroom. Pieces are sealed to its key; its editors check the documents before anything is published.</label>
            {mode === "newsroom" && <input className={`${inputCls} font-mono text-xs`} placeholder="Newsroom public key, 0x02… or 0x03…" value={newsroom} onChange={(e) => setNewsroom(e.target.value.trim())} />}
          </div>
          <Field label="Public tag (optional)" hint="Shown on the vault page so your custodians can tell vaults apart. Never a name or place.">
            <input className={inputCls} value={tag} maxLength={24} onChange={(e) => setTag(e.target.value)} />
          </Field>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <h2 className="font-serif text-lg font-bold">What goes on Arkiv</h2>
          <table className="mt-3 w-full text-left text-xs">
            <thead><tr className="text-muted"><th className="py-1">Public, forever readable</th><th>Stays with you</th></tr></thead>
            <tbody className="align-top">
              <tr><td className="py-1 pr-2">Encrypted chunks and their hashes</td><td>The files, the title, the note</td></tr>
              <tr><td className="py-1 pr-2">Each custodian's one-time address and public key</td><td>Who the custodians are</td></tr>
              <tr><td className="py-1 pr-2">Your heartbeat and its deadline</td><td>Your key and passphrase</td></tr>
              <tr><td className="py-1 pr-2">{k} of {custodians.length || "n"}, rhythm, release mode, tag</td><td>Anything that names you</td></tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">Someone watching the chain can see when you check in. Use the rhythm you would keep anyway, and check in from a network you would use anyway.</p>
          <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I understand nobody can delete this vault once sealed, me included, and that missing check-ins releases it.</label>
          <Button className="mt-4 w-full" disabled={!ready || busy} onClick={seal}>{busy ? "Sealing…" : "Seal and start my heartbeat"}</Button>
          {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
          <ol className="mt-3 space-y-1 text-xs">
            {log.map((l, i) => <li key={i} className="flex justify-between gap-2"><span>{l.text}</span>{l.tx && <TxLink hash={l.tx} />}</li>)}
          </ol>
        </Card>
      </div>
    </div>
  );
}
