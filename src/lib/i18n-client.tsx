"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, makeT, type Locale, type TFunction } from "@/lib/i18n";

type Ctx = { locale: Locale; setLocale: (l: Locale) => void; t: TFunction };

const I18nContext = createContext<Ctx>({ locale: DEFAULT_LOCALE, setLocale: () => {}, t: makeT(DEFAULT_LOCALE) });

export function I18nProvider({ locale: initial, children }: { locale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: makeT(locale) }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Hook dịch cho Client Component: `const t = useT(); t("common.save")`. */
export function useT(): TFunction {
  return useContext(I18nContext).t;
}

export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}
