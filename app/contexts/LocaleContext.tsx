import React, { createContext, useContext, useState, useEffect } from "react";
import type { Translations, Locale } from "../i18n/types";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";

const translations: Record<Locale, Translations> = { en, fr };

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

export const useLocale = () => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
};

interface LocaleProviderProps {
  children: React.ReactNode;
  initialLocale?: Locale;
}

export const LocaleProvider: React.FC<LocaleProviderProps> = ({
  children,
  initialLocale = "fr",
}) => {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // One-time sync: cookie (initialLocale from server) is authoritative —
  // update localStorage to match so both stores stay in sync.
  useEffect(() => {
    const saved = localStorage.getItem("locale") as Locale | null;
    if (saved !== locale) {
      localStorage.setItem("locale", locale);
      document.documentElement.lang = locale;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("locale", newLocale);
    document.cookie = `locale=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
    document.documentElement.lang = newLocale;
  };

  const t = translations[locale];

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
};
