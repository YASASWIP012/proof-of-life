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
  const [filter, setFilter] = useState<"all" | "soon" | "slow">("all");
  useEffect(() => {
    read((c) => listReleased(c)).then(setReleased).catch(() => setReleased([]));
  }, []);
  useEffect(() => {
    setRows(null);
    const opts = filter === "soon" ? { stopsWithinS: 3 * 86_400 } : filter === "slow" ? { rhythmAtLeastS: 7 * 86_400 } : {};
    read((c) => listVaults(c, opts))
      .then(({ head, vaults }) =>
        setRows(vaults.map((v) => ({ ...v, phase: vaultStatus({ head, heartbeatExpiresAt: v.heartbeatExpiresAt, graceS: v.graceS, k: v.k, validReleases: v.releases }).phase })).sort((a, b) => Number(b.createdAt - a.createdAt))),
      )
      .catch((e) => setErr(e.message));
  }, [filter]);
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-3xl font-bold">{t("nav_vaults")}</h1>
      {released && released.length > 0 && (
        <Card>
          <h2 className="font-serif text-lg font-bold">{t("vl_rel_t")}</h2>
          <p className="mt-1 text-sm text-muted">{t("vl_rel_b")}</p>
          <ul className="mt-3 divide-y divide-line">
            {released.map((r) => (
              <li key={r.vaultId + r.creator} className="flex items-center justify-between py-2 text-sm">
                <Link className="font-mono underline" to={vaultPath(r.vaultId, r.creator)}>{short(r.vaultId)}</Link>
                <span className="text-muted">{t("vl_pieces", { n: r.pieces, b: r.firstBlock.toString() })}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="max-w-2xl text-sm text-muted">{t("vl_intro")}</p>
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "soon", "slow"] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? "font-semibold ring-2 ring-ink" : ""}`} onClick={() => setFilter(f)}>{t(f === "all" ? "vl_all" : f === "soon" ? "vl_soon" : "vl_slow")}</button>
        ))}
      </div>
      {filter !== "all" && <p className="text-xs text-muted">{t("vl_filter_note")}</p>}
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
              <p className="mt-2 text-xs text-muted">{t("vl_row", { k: v.k, n: v.n, mode: v.mode, by: short(v.creator, 4) })}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
