"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { type Locale, defaultLocale, getDirection, t } from "./i18n";

interface LocaleContextType {
  locale: Locale;
  direction: "rtl" | "ltr";
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleContextType>({
  locale: defaultLocale,
  direction: getDirection(defaultLocale),
  setLocale: () => {},
  t: (key: string) => key,
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    document.documentElement.setAttribute("dir", getDirection(newLocale));
    document.documentElement.setAttribute("lang", newLocale);
  }, []);

  const translate = useCallback(
    (key: string) => t(locale, key),
    [locale]
  );

  return (
    <LocaleContext.Provider
      value={{
        locale,
        direction: getDirection(locale),
        setLocale,
        t: translate,
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}
