import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { explorerTx, type Phase } from "@proof-of-life/core";
import { useI18n } from "../lib/i18n";
import { short } from "../lib/format";

export function Card({ children, className = "", flat = false, raised = false }: { children: ReactNode; className?: string; flat?: boolean; raised?: boolean }) {
  return <div className={`card ${flat ? "card--flat" : ""} ${raised ? "card--raised" : ""} ${className}`}>{children}</div>;
}

type Variant = "primary" | "ghost" | "danger" | "soft";
export function Button({ variant = "primary", size, className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "lg" }) {
  const v = { primary: "btn-ink", ghost: "btn-outline", danger: "btn-danger", soft: "btn-ghost" }[variant];
  return <button {...p} className={`btn ${v} ${size ? `btn-${size}` : ""} ${className}`} />;
}

export const PHASE_COLOR: Record<Phase, string> = {
  alive: "var(--alive)",
  overdue: "var(--overdue)",
  lapsed: "var(--lapsed)",
  releasing: "var(--lapsed)",
  released: "var(--sealed)",
};

export function PhaseBadge({ phase }: { phase: Phase }) {
  const { t } = useI18n();
  return (
    <span className="chip" style={{ color: PHASE_COLOR[phase] }}>
      <span className={`h-2 w-2 rounded-full ${phase === "alive" ? "beat" : ""}`} style={{ background: PHASE_COLOR[phase] }} />
      {t(`phase_${phase}`)}
    </span>
  );
}

export function Copy({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}>
      {done ? t("common_copied") : label ?? t("common_copy")}
    </button>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a className="t-mono text-[12.5px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink" href={explorerTx(hash)} target="_blank" rel="noreferrer">
      {short(hash)}
    </a>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[14.5px] font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-[13px] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "field";

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: ReactNode }) {
  const c = { info: "var(--sealed)", warn: "var(--overdue)", danger: "var(--lapsed)" }[tone];
  return (
    <div className="flex gap-3 rounded-[14px] bg-paper-alt px-4 py-3 text-[14.5px] leading-relaxed text-ink-2">
      <span className="mt-[7px] h-2 w-2 flex-none rounded-full" style={{ background: c }} />
      <div>{children}</div>
    </div>
  );
}

export function Eyebrow({ children, dot = false }: { children: ReactNode; dot?: boolean }) {
  return <p className="eyebrow">{dot && <span className="dot" />}{children}</p>;
}

export function PageHead({ eyebrow, title, lead }: { eyebrow?: string; title: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-10 max-w-[680px]">
      {eyebrow && <div className="mb-4"><Eyebrow dot>{eyebrow}</Eyebrow></div>}
      <h1 className="t-h2">{title}</h1>
      {lead && <p className="lead mt-4">{lead}</p>}
    </div>
  );
}
