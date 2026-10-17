import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Fades a block in the first time it scrolls into view. A plain scroll check (throttled to animation frames)
 * instead of IntersectionObserver, which some embedded and power-saving browsers never fire.
 */
export function Reveal({ children, className = "", i = 0, style }: { children: ReactNode; className?: string; i?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = ref.current;
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.92) setShown(true);
    };
    const onScroll = () => (frame ||= requestAnimationFrame(check));
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [shown]);
  return <div ref={ref} className={`reveal ${shown ? "in" : ""} ${className}`} style={{ ["--i" as string]: i, ...style }}>{children}</div>;
}
