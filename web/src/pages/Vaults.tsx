import { listReleased, listVaults, vaultStatus, type ReleasedVault, type VaultSummary, type Phase } from "@proof-of-life/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, PhaseBadge } from "../components/ui";
import { short, vaultPath } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { read } from "../lib/net";

export default function Vaults() {
  const { t } = useI18n();
  const [rows, setRows] = useState<(VaultSummary & { phase: Phase })[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [released, setReleased] = useState<ReleasedVault[] | null>(null);
  useEffect(() => {
    read((c) => listReleased(c)).then(setReleased).catch(() => setReleased([]));
  }, []);
  useEffect(() => {
    read((c) => listVaults(c))
      .then(({ head, vaults }) =>
        setRows(vaults.map((v) => ({ ...v, phase: vaultStatus({ head, heartbeatExpiresAt: v.heartbeatExpiresAt, graceS: v.graceS, k: v.k, validReleases: v.releases }).phase })).sort((a, b) => Number(b.createdAt - a.createdAt))),
      )
      .catch((e) => setErr(e.message));
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-3xl font-bold">{t("nav_vaults")}</h1>
      {released && released.length > 0 && (
        <Card>
          <h2 className="font-serif text-lg font-bold">Released evidence</h2>
          <p className="mt-1 text-sm text-muted">Vaults whose pieces are public. A vault can stay unlisted while its heartbeat beats; every released piece carries the project tag and its vault's creator, so released evidence is findable from the chain alone.</p>
          <ul className="mt-3 divide-y divide-line">
            {released.map((r) => (
              <li key={r.vaultId + r.creator} className="flex items-center justify-between py-2 text-sm">
                <Link className="font-mono underline" to={vaultPath(r.vaultId, r.creator)}>{short(r.vaultId)}</Link>
                <span className="text-muted">{r.pieces} piece{r.pieces === 1 ? "" : "s"} · since block {r.firstBlock.toString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="max-w-2xl text-sm text-muted">Every vault on Arkiv, read live. A vault shows only a random id, a short tag, its custodian count and its heartbeat. Nothing here says who made it or what is inside. Release counts in this list are raw; open a vault to see which pieces pass their checks.</p>
      {err && <Card>{err}</Card>}
      {!rows && !err && <p className="text-muted">{t("common_loading")}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {rows?.map((v) => (
          <Link key={v.key} to={vaultPath(v.vaultId, v.creator)}>
            <Card className="transition hover:border-ink">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm">{short(v.vaultId)}</span>
                <PhaseBadge phase={v.phase} />
              </div>
              <p className="mt-2 text-xs text-muted">{v.k} of {v.n} custodians · {v.mode} release · by {short(v.creator, 4)}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
