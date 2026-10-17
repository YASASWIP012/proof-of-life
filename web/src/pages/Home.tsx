import { listVaults, vaultStatus } from "@dhadkan/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pulse } from "../components/Pulse";
import { Button, Card } from "../components/ui";
import { useI18n } from "../lib/i18n";
import { read } from "../lib/net";

export default function Home() {
  const { t } = useI18n();
  const [stats, setStats] = useState<{ alive: number; released: number; total: number } | null>(null);
  useEffect(() => {
    read((c) => listVaults(c))
      .then(({ head, vaults }) => {
        const phases = vaults.map((v) => vaultStatus({ head, heartbeatExpiresAt: v.heartbeatExpiresAt, graceS: v.graceS, k: v.k, validReleases: v.releases }).phase);
        setStats({ total: vaults.length, alive: phases.filter((p) => p === "alive" || p === "overdue").length, released: phases.filter((p) => p === "released").length });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="text-sm font-semibold text-pulse">{t("hero_kicker")}</p>
          <h1 className="mt-3 font-serif text-4xl font-bold leading-tight sm:text-5xl">{t("hero_title")}</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{t("hero_body")}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/drill"><Button>{t("hero_cta_drill")}</Button></Link>
            <Link to="/new"><Button variant="ghost">{t("hero_cta_new")}</Button></Link>
          </div>
          <p className="mt-4 text-xs text-muted">{t("hero_note")}</p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <Pulse phase="alive" fraction={0.72} size={260} />
          {stats && (
            <p className="text-sm text-muted">
              <b className="text-ink">{stats.alive}</b> beating · <b className="text-ink">{stats.released}</b> released · {stats.total} vaults on Arkiv
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold">{t("why_title")}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {([1, 2, 3] as const).map((i) => (
            <Card key={i}>
              <p className="font-serif text-4xl font-bold text-pulse">{t(`why_${i}_n`)}</p>
              <p className="mt-2 text-sm">{t(`why_${i}`)}</p>
            </Card>
          ))}
        </div>
        <p className="mt-5 max-w-3xl text-muted">{t("why_story")}</p>
        <p className="mt-2 text-xs text-muted">
          Sources: <a className="underline" href="https://www.theweek.in/magazine/theweek/cover/2025/10/04/rti-act-at-20-why-india-needs-better-whistleblower-protection-for-activists.html" target="_blank" rel="noreferrer">The Week (Oct 2025), citing CHRI</a> ·{" "}
          <a className="underline" href="https://thewire.in/government/govt-says-amendment-to-whistle-blowers-protection-act-not-in-agenda-of-current-parliament-session-report" target="_blank" rel="noreferrer">The Wire</a> ·{" "}
          <a className="underline" href="https://moneylife.in/article/probing-rti-killings-in-maharashtra-a-tough-instructive-task/62848.html" target="_blank" rel="noreferrer">Moneylife</a>
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold">{t("how_title")}</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-4">
          {([1, 2, 3, 4] as const).map((i) => (
            <Card key={i}>
              <p className="font-mono text-xs text-muted">0{i}</p>
              <h3 className="mt-1 font-serif text-lg font-bold">{t(`how_${i}_t`)}</h3>
              <p className="mt-2 text-sm text-muted">{t(`how_${i}`, { k: 2 })}</p>
            </Card>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-serif text-xl font-bold">Why it has to be Arkiv</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><b>The deadline is the database's, not ours.</b> The heartbeat is an Arkiv entity with an expiry. When it is not extended, Arkiv drops it. No cron job, no server we could be ordered to keep running.</li>
            <li><b>Nobody can delete the evidence.</b> Every sealed entity is read-only and owned by an address no one holds. A court order to us, or a gun to the activist, cannot remove it.</li>
            <li><b>Pieces count only from the right people.</b> A release is accepted only if its on-chain creator is the custodian named for that slot. Anyone can write; nobody can forge who wrote it.</li>
            <li><b>Anyone can read it, with or without us.</b> This site, the CLI and a curl command all read the same public entities.</li>
          </ul>
        </Card>
        <Card>
          <h2 className="font-serif text-xl font-bold">What never touches Arkiv</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>Your documents in readable form, and their titles.</li>
            <li>Every private key and passphrase. Keys stay in your browser, wrapped with your passphrase.</li>
            <li>Who you are, and who your custodians are. Each custodian uses a fresh key made for this one vault.</li>
            <li>How to reach anyone. Custodians contact the activist through their own channels.</li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
