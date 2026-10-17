import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Link } from "react-router-dom";
import { LANG_NAMES, useI18n, type Lang } from "../lib/i18n";
import { onReadMode, readMode, type ReadMode } from "../lib/net";
import { REPO_URL } from "../lib/config";

const NAV = [
  ["/drill", "nav_drill"],
  ["/new", "nav_new"],
  ["/checkin", "nav_checkin"],
  ["/custodian", "nav_custodian"],
  ["/vaults", "nav_vaults"],
  ["/verify", "nav_verify"],
] as const;

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-serif text-xl font-bold">
      <svg viewBox="0 0 32 32" className="h-7 w-7"><path d="M2 17h7l3-7 5 14 4-10 2 3h7" fill="none" stroke="var(--color-pulse)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Proof of Life <span className="text-base font-normal text-muted">धड़कन</span>
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState<ReadMode>(readMode());
  const [open, setOpen] = useState(false);
  useEffect(() => onReadMode((m) => setMode(m)), []);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV.map(([to, k]) => (
              <NavLink key={to} to={to} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-line/60 font-semibold" : "text-muted hover:text-ink"}`}>
                {t(k)}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm">
              {Object.entries(LANG_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="rounded-lg border border-line px-3 py-1.5 text-sm lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open}>☰</button>
          </div>
        </div>
        {open && (
          <nav className="grid gap-1 border-t border-line px-4 py-2 lg:hidden">
            {NAV.map(([to, k]) => <NavLink key={to} to={to} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm">{t(k)}</NavLink>)}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted">
          <span>{t("common_testnet")}</span>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: mode === "direct" ? "var(--color-alive)" : "var(--color-overdue)" }} />{t(mode === "direct" ? "read_direct" : "read_relay")}</span>
            <a href={REPO_URL} className="underline" target="_blank" rel="noreferrer">GitHub · MIT</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
