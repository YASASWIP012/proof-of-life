import type { Phase } from "@proof-of-life/core";
import { PHASE_COLOR } from "./ui";

/**
 * The heartbeat. The ring drains as the check-in deadline approaches; the line flattens once it lapses.
 * `fraction` is the share of the interval still left before the due block.
 */
export function Pulse({ phase, fraction, size = 220 }: { phase: Phase; fraction: number; size?: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const color = PHASE_COLOR[phase];
  const flat = phase === "lapsed" || phase === "releasing" || phase === "released";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={phase}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-line)" strokeWidth="3" />
      <circle
        cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, flat ? 0 : fraction)))}
        transform="rotate(-90 50 50)" style={{ transition: "stroke-dashoffset 1s linear" }}
      />
      <g className={phase === "alive" ? "beat" : ""} style={{ transformOrigin: "50px 50px" }}>
        <path
          d={flat ? "M20 52 H80" : "M20 52 H36 L41 40 L48 64 L54 34 L59 52 H80"}
          fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
