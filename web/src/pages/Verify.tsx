// Everything Proof of Life shows can be checked without it.
import { PROJECT, TIRAMISU } from "@proof-of-life/core";
import { useState } from "react";
import { Button, Card, Copy, inputCls } from "../components/ui";
import { read } from "../lib/net";
import { REPO_URL } from "../lib/config";
import { useI18n } from "../lib/i18n";

const EXAMPLES = [
  `project = str('${PROJECT}') AND type = str('vault')`,
  `project = str('${PROJECT}') AND type = str('heartbeat')`,
  `project = str('${PROJECT}') AND type = str('release')`,
];

export default function Verify() {
  const { t } = useI18n();
  const [q, setQ] = useState(EXAMPLES[0]);
  const [out, setOut] = useState("");
  const run = async () => {
    setOut("…");
    try {
      const r = await read((c) => c.query(q, { select: { key: true, owner: true, creator: true, expiresAt: true, attributes: true }, limit: 25 }));
      setOut(JSON.stringify(r.entities, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    } catch (e) {
      setOut((e as Error).message);
    }
  };
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-bold">{t("nav_verify")}</h1>
      <p className="max-w-2xl text-muted">{t("vf_lead")}</p>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <h2 className="font-semibold">{t("vf_cli_t")}</h2>
          <p className="mt-1 text-sm text-muted">{t("vf_cli")}</p>
          <pre className="mono-wrap mt-2 rounded-lg bg-paper p-2 text-xs">npx github:YASASWIP012/proof-of-life status &lt;vault_id&gt; &lt;creator&gt;</pre>
        </Card>
        <Card>
          <h2 className="font-semibold">curl</h2>
          <p className="mt-1 text-sm text-muted">{t("vf_curl", { rpc: TIRAMISU.rpc.replace("https://", "") })}</p>
          <pre className="mono-wrap mt-2 rounded-lg bg-paper p-2 text-xs">{`arkiv_query("project = str('proof-of-life') AND type = str('vault')")`}</pre>
        </Card>
        <Card>
          <h2 className="font-semibold">{t("vf_src_t")}</h2>
          <p className="mt-1 text-sm text-muted">{t("vf_src")}</p>
          <a className="mt-2 inline-block text-sm underline" href={REPO_URL} target="_blank" rel="noreferrer">{REPO_URL.replace("https://", "")}</a>
        </Card>
      </div>
      <Card>
        <h2 className="font-serif text-lg font-bold">{t("vf_run_t")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} className="rounded-lg border border-line px-2 py-1 font-mono text-[11px]" onClick={() => setQ(e)}>{e.split("AND ")[1]}</button>)}</div>
        <textarea className={`${inputCls} mt-3 font-mono text-xs`} rows={3} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-2 flex gap-2"><Button onClick={run}>{t("vf_run")}</Button><Copy text={q} /></div>
        {out && <pre className="mono-wrap mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-3 text-[11px]">{out}</pre>}
      </Card>
    </div>
  );
}
