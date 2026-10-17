import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Phase } from "@proof-of-life/core";
import { useI18n } from "../lib/i18n";
import { explorerTx } from "@proof-of-life/core";
import { short } from "../lib/format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-card p-5 sm:p-6 ${className}`}>{children}</div>;
}

export function Button({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-ink text-paper hover:opacity-90",
    ghost: "border border-line hover:bg-line/40",
    danger: "bg-lapsed text-white hover:opacity-90",
  }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`} />;
}

export const PHASE_COLOR: Record<Phase, string> = {
  alive: "var(--color-alive)",
  overdue: "var(--color-overdue)",
  lapsed: "var(--color-lapsed)",
  releasing: "var(--color-lapsed)",
  released: "var(--color-sealed)",
};

export function PhaseBadge({ phase }: { phase: Phase }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide" style={{ borderColor: PHASE_COLOR[phase], color: PHASE_COLOR[phase] }}>
      <span className={`h-2 w-2 rounded-full ${phase === "alive" ? "beat" : ""}`} style={{ background: PHASE_COLOR[phase] }} />
      {t(`phase_${phase}`)}
    </span>
  );
}

export function Copy({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-ink"
      onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
    >
      {done ? t("common_copied") : label ?? t("common_copy")}
    </button>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a className="font-mono text-xs underline decoration-dotted underline-offset-2 hover:text-pulse" href={explorerTx(hash)} target="_blank" rel="noreferrer">
      {short(hash)}
    </a>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm outline-none focus:border-ink";

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: ReactNode }) {
  const c = { info: "var(--color-sealed)", warn: "var(--color-overdue)", danger: "var(--color-lapsed)" }[tone];
  return (
    <div className="rounded-xl border-l-4 bg-card px-4 py-3 text-sm" style={{ borderColor: c }}>
      {children}
    </div>
  );
}
