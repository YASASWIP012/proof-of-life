import { listVaults, vaultStatus, type Phase } from "@proof-of-life/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Hex } from "viem";
import { AppIcon } from "../components/Layout";
import { Reveal } from "../components/Reveal";
import { Pulse } from "../components/Pulse";
import { PHASE_COLOR } from "../components/ui";
import { useHead, useVault } from "../hooks/useVault";
import { blocksToSeconds, duration, short, vaultPath } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { read } from "../lib/net";

// The demo vault a keeper bot checks in for every few hours (scripts/demo-vaults.json).
const LIVE = { vaultId: "0x87935a7665533da43c4b562fa4a39951c6fe2a4d3a82a19b24c2aef7bca31dc9" as Hex, creator: "0x8C8adBA31c57C51b4cBAdA5c503826378260e01e" as Hex };
const RELEASED = vaultPath("0xff209ceea0104dab5d737fc1e7d5c740c717832d74af8e8970dafd1cb7077bca", "0x126B45be97c649DcA7A44e3eB41e8dacf79436d8");

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICONS = {
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  key: "M15 7a4 4 0 1 1-3.9 4.8L4 19v2h3l1-1v-2h2l1.6-1.6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  radio: "M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M8 16a5 5 0 0 1 0-8M16 8a5 5 0 0 1 0 8M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  stamp: "M5 21h14M6 17h12l-1-4H7zM9 13V9a3 3 0 1 1 6 0v4",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
};

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
    <>
      <section className="hero">
        <div className="container">
          <span className="badge"><span className="badge__tag">Live</span>{stats ? `${stats.alive} heartbeats beating on Arkiv right now` : "Running on Arkiv's Tiramisu testnet"}</span>
          <h1>{t("hero_title_a")} <span className="t-muted">{t("hero_title_b")}</span></h1>
          <p className="lead">{t("hero_body")}</p>
          <div className="cta-row">
            <Link to="/rti" className="btn btn-ink btn-lg">{t("hero_cta_rti")}</Link>
            <Link to="/drill" className="btn btn-outline btn-lg">{t("hero_cta_drill")}</Link>
          </div>
          <p className="trust"><span>{t("trust_1")}</span><span>{t("trust_2")}</span><span>English · हिन्दी · తెలుగు</span></p>
          <div className="hero__visual bleed">
            <div className="stage"><HeroVisual /></div>
          </div>
        </div>
      </section>

      <section className="section section--alt after-bleed">
        <div className="container">
          <div className="card flex flex-col gap-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="max-w-[640px]">
                <Eyebrow dot>{t("home_rti_eyebrow")}</Eyebrow>
                <h2 className="t-h3 mt-3">{t("home_rti_h2")}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{t("home_rti_lead")}</p>
              </div>
              <Link to="/rti" className="btn btn-ink btn-lg flex-none">{t("home_rti_cta")}</Link>
            </div>
            <div className="grid grid-3">
              {([1, 2, 3] as const).map((i) => (
                <div key={i}>
                  <p className="t-h3 ticker" style={{ color: "var(--accent-ink)" }}>{t(`home_rti_n${i}`)}</p>
                  <p className="t-small mt-2">{t(`home_rti_s${i}`)}</p>
                </div>
              ))}
            </div>
            <p className="t-micro">
              Sources: <a className="underline" href="https://www.etvbharat.com/en/bharat/right-to-information-applications-filed-during-2023-to-24-centre-enn25120405545" target="_blank" rel="noreferrer">Rajya Sabha reply, via ETV Bharat</a> ·{" "}
              <a className="underline" href="https://www.snsindia.org/wp-content/uploads/2025/10/Press-Release-2025.pdf" target="_blank" rel="noreferrer">Satark Nagrik Sangathan report card 2024-25</a>
            </p>
          </div>
          <p className="t-small mt-6 text-center">{t("home_rti_next")}</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <Eyebrow>{t("why_title")}</Eyebrow>
            <h2>{t("why_h2_a")} <span className="t-muted">{t("why_h2_b")}</span></h2>
            <p className="lead">{t("why_story")}</p>
          </div>
          <div className="grid grid-3">
            {([1, 2, 3] as const).map((i) => (
              <Reveal key={i} className="card" i={i}>
                <p className="t-h3 ticker" style={{ color: "var(--accent-ink)" }}>{t(`why_${i}_n`)}</p>
                <p className="t-small mt-3">{t(`why_${i}`)}</p>
              </Reveal>
            ))}
          </div>
          <p className="t-micro mt-6 text-center">
            Sources: <a className="underline" href="https://www.theweek.in/magazine/theweek/cover/2025/10/04/rti-act-at-20-why-india-needs-better-whistleblower-protection-for-activists.html" target="_blank" rel="noreferrer">The Week, citing CHRI</a> ·{" "}
            <a className="underline" href="https://thewire.in/government/govt-says-amendment-to-whistle-blowers-protection-act-not-in-agenda-of-current-parliament-session-report" target="_blank" rel="noreferrer">The Wire</a> ·{" "}
            <a className="underline" href="https://moneylife.in/article/probing-rti-killings-in-maharashtra-a-tough-instructive-task/62848.html" target="_blank" rel="noreferrer">Moneylife</a>
          </p>
        </div>
      </section>

      <section className="section section--alt">
        <div className="container">
          <div className="grid grid-2">
            <div className="card card--flat">
              <Eyebrow>{t("old_eyebrow")}</Eyebrow>
              <h3 className="t-title mt-3">{t("old_title")}</h3>
              <ul className="mt-4 space-y-3 text-[15px] text-ink-2">
                {(["old_1", "old_2", "old_3"] as const).map((k) => <li key={k} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[var(--ink-4)]" />{t(k)}</li>)}
              </ul>
            </div>
            <div className="card card--chosen">
              <Eyebrow dot>{t("new_eyebrow")}</Eyebrow>
              <h3 className="t-title mt-3">{t("new_title")}</h3>
              <ul className="checklist !my-4">
                {(["new_1", "new_2", "new_3"] as const).map((k) => <li key={k}>{t(k)}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container stack">
          <Feature eyebrow={t("how_1_t")} icon={ICONS.lock} title={t("f1_title")} body={t("how_1")} chips={["AES-256-GCM", t("f1_chip_2"), "0x…dEaD"]}>
            <SealVisual />
          </Feature>
          <Feature flip eyebrow={t("how_2_t")} icon={ICONS.users} title={t("f2_title")} body={t("how_2", { k: 2 })} chips={[t("f2_chip_1"), t("f2_chip_2"), t("f2_chip_3")]}>
            <CustodianVisual />
          </Feature>
          <Feature eyebrow={t("how_3_t")} icon={ICONS.clock} title={t("f3_title")} body={t("how_3")} chips={[t("f3_chip_1"), t("f3_chip_2"), t("f3_chip_3")]}>
            <PhoneVisual />
          </Feature>
          <Feature flip eyebrow={t("how_4_t")} icon={ICONS.key} title={t("f4_title")} body={t("how_4")} chips={[t("f4_chip_1"), t("f4_chip_2")]}>
            <ReleaseVisual />
          </Feature>
        </div>
      </section>

      <section className="section section--alt" id="try">
        <div className="container">
          <div className="section-head">
            <Eyebrow dot>{t("try_eyebrow")}</Eyebrow>
            <h2>{t("try_h2")}</h2>
            <p className="lead">{t("try_lead")}</p>
          </div>
          <Simulator />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <Eyebrow>{t("arkiv_eyebrow")}</Eyebrow>
            <h2>{t("arkiv_h2_a")} <span className="t-muted">{t("arkiv_h2_b")}</span></h2>
          </div>
          <div className="grid grid-3">
            {([["clock", 1], ["stamp", 2], ["users", 3], ["eye", 4], ["radio", 5], ["phone", 6]] as const).map(([icon, i]) => (
              <Reveal key={i} className="tile" i={i % 3}>
                <span className="icon-tile"><Icon d={ICONS[icon]} /></span>
                <div>
                  <p className="t-title">{t(`tile_${i}_t`)}</p>
                  <p>{t(`tile_${i}`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--alt">
        <div className="container">
          <div className="section-head">
            <Eyebrow>{t("faq_eyebrow")}</Eyebrow>
            <h2>{t("faq_h2")}</h2>
          </div>
          <div className="faq">
            {([1, 2, 3, 4, 5, 6, 7] as const).map((i) => (
              <details key={i}>
                <summary>{t(`faq_${i}_q`)}</summary>
                <p>{t(`faq_${i}_a`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container text-center">
          <div className="mx-auto mb-7 w-fit rounded-[22%] shadow-[var(--shadow-2)]"><AppIcon size={88} /></div>
          <h2 className="mx-auto max-w-[760px]">{t("final_a")} <span className="t-muted">{t("final_b")}</span></h2>
          <div className="cta-row">
            <Link to="/drill" className="btn btn-ink btn-lg">{t("hero_cta_drill")}</Link>
            <Link to={RELEASED} className="btn btn-outline btn-lg">{t("final_cta_2")}</Link>
          </div>
          <p className="t-small mx-auto mt-8 max-w-[620px]">{t("use_body")}</p>
        </div>
      </section>
    </>
  );
}

function Eyebrow({ children, dot = false }: { children: ReactNode; dot?: boolean }) {
  return <p className="eyebrow">{dot && <span className="dot" />}{children}</p>;
}

function Feature({ eyebrow, icon, title, body, chips, flip = false, children }: { eyebrow: string; icon: string; title: string; body: string; chips: string[]; flip?: boolean; children: ReactNode }) {
  return (
    <div className={`split ${flip ? "split--flip" : ""}`}>
      <div>
        <p className="eyebrow"><Icon d={icon} />{eyebrow}</p>
        <h3>{title}</h3>
        <p className="lead">{body}</p>
        <div className="chips">{chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>
      </div>
      <Reveal className="stage">{children}</Reveal>
    </div>
  );
}

/* ---------- Hero: the real always-alive vault, read live from Arkiv ---------- */

function HeroVisual() {
  const { t } = useI18n();
  const { view, fetchedAt } = useVault(LIVE.vaultId, LIVE.creator);
  const { head } = useHead(view?.head, fetchedAt);
  const live = head ?? 0n;
  const hb = view?.heartbeat;
  const m = view?.manifest;
  const grace = BigInt(Math.ceil((m?.grace_s ?? 0) / 2));
  const dueAt = hb ? hb.expiresAt - grace : null;
  const phase: Phase = view ? vaultStatus({ head: live, heartbeatExpiresAt: hb?.expiresAt ?? null, graceS: m!.grace_s, k: m!.k, validReleases: view.releases.filter((r) => r.valid).length }).phase : "alive";
  const fraction = dueAt && m ? Number(dueAt - live) / (m.interval_s / 2) : 0.7;
  return (
    <div className="relative mx-auto max-w-[880px]">
      <div className="window window--dark" aria-label="A live demo vault read from Arkiv">
        <div className="window__bar"><span className="lights"><i /><i /><i /></span><span className="window__title">Vault · always-alive</span></div>
        <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:p-8" style={{ background: "var(--app-bg)" }}>
          <div className="flex justify-center"><Pulse phase={phase} fraction={fraction} size={170} /></div>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex h-7 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold" style={{ background: "rgba(255,255,255,.06)", color: PHASE_COLOR[phase] === "var(--alive)" ? "#4ADE80" : "#FBBF24" }}>
                <span className="beat h-2 w-2 rounded-full" style={{ background: "currentColor" }} /> {t(`phase_${phase}`)}
              </span>
              <span className="text-[12.5px]" style={{ color: "var(--app-ink-2)" }}>{t("hm_read")} {view ? t("hm_at", { b: view.head.toString() }) : "…"}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label={t("mk_next")} value={dueAt && dueAt > live ? duration(blocksToSeconds(dueAt - live)) : "…"} />
              <Stat label={t("dr_stops").replace(/:$/, "")} value={hb ? duration(blocksToSeconds(hb.expiresAt - live)) : "…"} />
            </div>
            <div className="space-y-1.5">
              {(m?.custodians ?? [1, 2, 3].map((slot) => ({ slot, address: "0x…" }))).map((c) => {
                const ack = view?.acks.find((a) => a.slot === c.slot);
                return (
                  <div key={c.slot} className="flex items-center justify-between rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "var(--app-card)", color: "var(--app-ink)" }}>
                    <span>{t("hm_custodian", { n: c.slot })} <span className="t-mono" style={{ color: "var(--app-ink-2)" }}>{short(c.address, 4)}</span></span>
                    <span style={{ color: ack ? "#4ADE80" : "var(--app-ink-2)" }}>{ack ? t("hm_holding") : "…"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="float left-[-64px] top-[8%]" aria-hidden="true">
        <div className="flex items-center gap-2.5"><Dot c="var(--alive)" /><div><b>{t("hm_f1_t")}</b><br /><span className="text-muted">{t("hm_f1")}</span></div></div>
      </div>
      <div className="float bottom-[18%] right-[-40px]" aria-hidden="true">
        <div className="flex items-center gap-2.5"><Dot c="var(--sealed)" /><div><b>{t("hm_f2_t")}</b><br /><span className="text-muted">{t("hm_f2")}</span></div></div>
      </div>
      <div className="float bottom-[-22px] left-[14%]" aria-hidden="true">
        <div className="flex items-center gap-2.5"><Dot c="var(--accent)" /><div><b>{t("hm_f3_t")}</b><br /><span className="text-muted">{t("hm_f3")}</span></div></div>
      </div>
    </div>
  );
}

const Dot = ({ c }: { c: string }) => <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: c, boxShadow: `0 0 0 4px color-mix(in oklab, ${c} 18%, transparent)` }} />;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] px-4 py-3" style={{ background: "var(--app-card)" }}>
      <p className="text-[12px]" style={{ color: "var(--app-ink-2)" }}>{label}</p>
      <p className="t-mono ticker mt-1 text-[22px] font-medium" style={{ color: "var(--app-ink)" }}>{value}</p>
    </div>
  );
}

/* ---------- Feature visuals (decorative mockups of real screens) ---------- */

function SealVisual() {
  const { t } = useI18n();
  const rows = [["rti-reply-rural-works.pdf", "412 KB"], ["field-survey.csv", "2 KB"], ["note-to-reader.txt", "1 KB"]];
  return (
    <div className="window" aria-hidden="true">
      <div className="window__bar"><span className="lights"><i /><i /><i /></span><span className="window__title">{t("nav_new")}</span></div>
      <div className="space-y-2 p-5 text-[13px]">
        {rows.map(([n, s]) => (
          <div key={n} className="flex items-center justify-between rounded-[10px] bg-paper-alt px-3 py-2.5"><span className="font-medium">{n}</span><span className="text-muted">{s}</span></div>
        ))}
        <div className="flex items-center gap-2 py-1 text-[12px] text-muted"><span className="h-px flex-1 bg-[var(--line-2)]" />{t("mk_enc")}<span className="h-px flex-1 bg-[var(--line-2)]" /></div>
        {["9f3c…a1d0", "51be…7c42", "e07a…3b19", "c2d4…08fe", "7a11…94c3"].map((h, i) => (
          <div key={h} className="flex items-center justify-between rounded-[10px] px-3 py-2 shadow-[var(--ring)]">
            <span className="t-mono text-[12px]">{t("mk_chunk", { i })} · {h}</span>
            <span className="text-[12px] font-semibold" style={{ color: "var(--sealed)" }}>{t("mk_sealed")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustodianVisual() {
  const { t } = useI18n();
  const people = [[t("mk_journalist"), t("mk_slot", { n: 1 }), "var(--accent)"], [t("mk_lawyer"), t("mk_slot", { n: 2 }), "var(--sealed)"], [t("mk_friend"), t("mk_slot", { n: 3 }), "var(--alive)"]];
  return (
    <div className="card card--raised !p-6" aria-hidden="true">
      <p className="eyebrow">{t("mk_2of3")}</p>
      <div className="mt-4 space-y-3">
        {people.map(([who, slot, c]) => (
          <div key={who} className="flex items-center gap-3">
            <span className="avatar" style={{ background: `color-mix(in oklab, ${c} 16%, white)`, color: c }}>{who[0]}</span>
            <div className="flex-1">
              <p className="text-[14px] font-semibold">{who} <span className="font-normal text-muted">· {slot}</span></p>
              <p className="text-[12.5px] text-muted">{t("mk_piece")}</p>
            </div>
            <svg viewBox="0 0 40 16" width="48" height="20"><path d="M4 8h22M26 8l-4-4M26 8l-4 4" stroke={c} strokeWidth="2" fill="none" strokeLinecap="round" /><circle cx="33" cy="8" r="4" fill={c} /></svg>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-[12px] bg-paper-alt px-4 py-3 text-[13px] text-ink-2">{t("mk_any2")}</div>
    </div>
  );
}

function PhoneVisual() {
  const { t } = useI18n();
  return (
    <div className="phone" aria-hidden="true">
      <div className="phone__screen">
        <div className="phone__status"><span>9:41</span><span>5G</span></div>
        <div className="phone__body flex h-[calc(100%-48px)] flex-col items-center justify-center gap-4 text-center">
          <Pulse phase="alive" fraction={0.86} size={150} />
          <p className="text-[13px] text-muted">{t("mk_next")}</p>
          <p className="t-mono -mt-3 text-[26px] font-medium">6d 04h</p>
          <span className="btn btn-ink w-full">{t("mk_safe")}</span>
          <p className="text-[12px] text-muted">मैं सुरक्षित हूँ · నేను క్షేమంగా ఉన్నాను</p>
        </div>
      </div>
    </div>
  );
}

function ReleaseVisual() {
  const { t } = useI18n();
  return (
    <div className="window" aria-hidden="true">
      <div className="window__bar"><span className="lights"><i /><i /><i /></span><span className="window__title">{t("phase_released")}</span></div>
      <div className="space-y-3 p-5 text-[13px]">
        <div className="flex items-center gap-2 font-semibold" style={{ color: "var(--lapsed)" }}><span className="h-2 w-2 rounded-full bg-[var(--lapsed)]" />{t("mk_stopped", { b: "693,104" })}</div>
        {[[t("hm_custodian", { n: 1 }), t("mk_published"), "var(--sealed)"], [t("hm_custodian", { n: 3 }), t("mk_published"), "var(--sealed)"], [t("mk_stranger", { a: "0x9a4…f2e" }), t("mk_ignored"), "var(--ink-4)"]].map(([w, s, c]) => (
          <div key={w} className="flex justify-between rounded-[10px] px-3 py-2 shadow-[var(--ring)]"><span>{w}</span><span style={{ color: c }}>{s}</span></div>
        ))}
        <div className="rounded-[12px] bg-paper-alt p-4">
          <p className="font-semibold">rti-reply-rural-works.pdf</p>
          <p className="mt-1 text-muted">{t("mk_matches", { b: "692,595" })}</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Try it here: a local simulation, one day per second ---------- */

const RHYTHMS = [
  { id: "week", label: "Weekly", interval: 7, grace: 3 },
  { id: "fortnight", label: "Fortnightly", interval: 14, grace: 7 },
  { id: "month", label: "Monthly", interval: 30, grace: 7 },
] as const;

function Simulator() {
  const { t } = useI18n();
  const [rhythm, setRhythm] = useState<(typeof RHYTHMS)[number]>(RHYTHMS[0]);
  const [k, setK] = useState(2);
  const [auto, setAuto] = useState(true);
  const [day, setDay] = useState(0);
  const [last, setLast] = useState(0);
  const [released, setReleased] = useState<number[]>([]);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    timer.current = setInterval(() => setDay((d) => d + 0.25), 250);
    return () => clearInterval(timer.current);
  }, []);
  const reset = () => (setDay(0), setLast(0), setReleased([]));
  useEffect(reset, [rhythm, k]);

  const sinceLast = day - last;
  const phase: Phase = released.length >= k ? "released" : released.length ? "releasing" : sinceLast >= rhythm.interval + rhythm.grace ? "lapsed" : sinceLast >= rhythm.interval ? "overdue" : "alive";
  useEffect(() => {
    if (auto && phase === "alive" && sinceLast >= rhythm.interval - 1) setLast(day);
  }, [day]);
  useEffect(() => {
    if (phase === "lapsed" || phase === "releasing") {
      const id = setTimeout(() => setReleased((r) => (r.length < k ? [...r, r.length + 1] : r)), 900);
      return () => clearTimeout(id);
    }
  }, [phase, released.length]);
  const left = Math.max(0, rhythm.interval - sinceLast);

  return (
    <div className="try">
      <div className="card space-y-6">
        <div>
          <p className="t-title">{t("sim_rhythm")}</p>
          <div className="segmented mt-3" role="tablist">
            {RHYTHMS.map((r) => <button key={r.id} aria-selected={rhythm.id === r.id} onClick={() => setRhythm(r)}>{t(`rh_${r.id}`)}</button>)}
          </div>
        </div>
        <div>
          <p className="t-title">{t("sim_k", { k })}</p>
          <input type="range" className="range mt-2" min={2} max={5} value={k} style={{ ["--val" as string]: `${((k - 2) / 3) * 100}%` }} onChange={(e) => setK(Number(e.target.value))} />
        </div>
        <label className="flex items-center justify-between gap-4">
          <span><span className="t-title block">{t("sim_auto")}</span><span className="t-small">{t("sim_auto_d")}</span></span>
          <input type="checkbox" className="switch" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ink btn-sm" onClick={() => setLast(day)} disabled={phase !== "alive" && phase !== "overdue"}>{t("sim_checkin")}</button>
          <button className="btn btn-outline btn-sm" onClick={reset}>{t("sim_reset")}</button>
        </div>
        <p className="t-micro">{t("sim_note")}</p>
      </div>
      <div className="stage flex items-center justify-center">
        <div className="w-full max-w-[420px] rounded-[20px] bg-card p-6 text-center shadow-[var(--shadow-3)]">
          <div className="flex justify-center"><Pulse phase={phase} fraction={phase === "alive" ? left / rhythm.interval : 0} size={170} /></div>
          <p className="mt-2 text-[15px] font-semibold" style={{ color: PHASE_COLOR[phase] }}>{t(`phase_${phase}`)}</p>
          <p className="t-small mt-1">{phase === "alive" ? t("sim_due", { d: Math.ceil(left) }) : t(`phase_${phase}_d`, { have: released.length, k, need: Math.max(0, k - released.length) })}</p>
          <div className="mt-5 flex justify-center gap-2">
            {Array.from({ length: Math.max(k + 1, 3) }, (_, i) => i + 1).map((slot) => (
              <span key={slot} className="chip !h-8 !px-3 !text-[12.5px]" style={released.includes(slot) ? { color: "var(--sealed)", boxShadow: "inset 0 0 0 1.5px var(--sealed)" } : undefined}>
                {released.includes(slot) ? "✓" : "○"} {slot}
              </span>
            ))}
          </div>
          <p className="t-mono ticker mt-5 text-[12.5px] text-muted">day {Math.floor(day)}</p>
        </div>
      </div>
    </div>
  );
}
