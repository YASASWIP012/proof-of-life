import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { LANG_NAMES, useI18n, type Lang } from "../lib/i18n";
import { onReadMode, readMode, type ReadMode } from "../lib/net";
import { REPO_URL } from "../lib/config";

const NAV = [
  ["/new", "nav_new"],
  ["/checkin", "nav_checkin"],
  ["/custodian", "nav_custodian"],
  ["/vaults", "nav_vaults"],
  ["/verify", "nav_verify"],
] as const;

export function AppIcon({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className="app-icon" aria-hidden="true">
      <rect width="32" height="32" rx="7.2" fill="#17150F" />
      <path d="M4 17h6l3-7 5 13 3-8 2 2h5" fill="none" stroke="#E8895A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState<ReadMode>(readMode());
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => onReadMode((m) => setMode(m)), []);
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);
  const home = pathname === "/";
  return (
    <div className="flex min-h-screen flex-col">
      <header className="nav">
        <div className="nav__bar">
          <Link to="/" className="nav__brand">
            <AppIcon />
            Proof of Life
          </Link>
          <nav className="nav__links">
            {NAV.map(([to, k]) => (
              <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "!bg-[var(--tint)] !text-ink" : "")}>
                {t(k)}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="h-9 cursor-pointer appearance-none rounded-full bg-[var(--tint)] pl-3.5 pr-8 text-[13.5px] font-medium leading-9 text-ink-2 outline-none">
                {Object.entries(LANG_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <svg aria-hidden viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
            </div>
            <Link to="/drill" className="btn btn-ink btn-sm hidden sm:inline-flex">{t("nav_drill")}</Link>
            <button className="btn btn-ghost btn-sm min-[761px]:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>
      </header>
      {open && (
        <div className="fixed inset-x-3 top-[76px] z-40 rounded-[20px] bg-card p-2 shadow-[var(--shadow-2)] min-[761px]:hidden">
          {[["/drill", "nav_drill"] as const, ...NAV].map(([to, k]) => (
            <NavLink key={to} to={to} className="block rounded-xl px-4 py-3 text-[15px] font-medium hover:bg-[var(--tint)]">{t(k)}</NavLink>
          ))}
        </div>
      )}
      <main className={home ? "flex-1" : "app-main container flex-1 pb-24"}>{children}</main>
      <footer className="footer">
        <div className="container">
          <span className="flex items-center gap-2.5 font-semibold text-ink"><AppIcon size={22} /> Proof of Life <span className="font-normal text-muted">· {t("common_testnet")}</span></span>
          <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: mode === "direct" ? "var(--alive)" : "var(--overdue)" }} />
              {t(mode === "direct" ? "read_direct" : "read_relay")}
            </span>
            <Link to="/verify" className="hover:text-ink">{t("nav_verify")}</Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-ink">Source · MIT</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
