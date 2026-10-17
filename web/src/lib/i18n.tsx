import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { en, type Strings } from "./strings.en";
import { hi } from "./strings.hi";
import { te } from "./strings.te";

export type Lang = "en" | "hi" | "te";
const DICTS: Record<Lang, Partial<Strings>> = { en, hi, te };
export const LANG_NAMES: Record<Lang, string> = { en: "English", hi: "हिन्दी", te: "తెలుగు" };

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: keyof Strings, vars?: Record<string, string | number>) => string };
const I18n = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem("dhadkan.lang") as Lang | null;
      if (saved && saved in DICTS) return saved;
    } catch {}
    const nav = navigator.language.slice(0, 2);
    return nav === "hi" || nav === "te" ? nav : "en";
  });
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("dhadkan.lang", lang);
    } catch {}
  }, [lang]);
  const t: Ctx["t"] = (k, vars) => {
    let s = DICTS[lang][k] ?? en[k];
    if (vars) for (const [name, v] of Object.entries(vars)) s = s.replaceAll(`{${name}}`, String(v));
    return s;
  };
  return <I18n.Provider value={{ lang, setLang, t }}>{children}</I18n.Provider>;
}

export function useI18n() {
  const c = useContext(I18n);
  if (!c) throw new Error("useI18n outside provider");
  return c;
}
