import type { ReactNode } from "react";
import type { Translations, Locale } from "../i18n/types";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import {
  LocaleProvider as BaseLocaleProvider,
  useLocale as useLocaleBase,
} from "~/core/ui/LocaleContext";

const dictionaries: Record<Locale, Translations> = { en, fr };

interface LocaleProviderProps {
  children: ReactNode;
  initialLocale?: Locale;
  sharedCookieDomain?: string | null;
}

/**
 * App-side Locale wrapper: binds this deployment's (divergent) dictionaries to
 * the shared LocaleProvider in kandora-core, and re-exposes a `useLocale` typed
 * to this app's full `Translations`.
 */
export function LocaleProvider({
  children,
  initialLocale = "fr",
  sharedCookieDomain,
}: LocaleProviderProps) {
  return (
    <BaseLocaleProvider
      dictionaries={dictionaries}
      initialLocale={initialLocale}
      sharedCookieDomain={sharedCookieDomain}
    >
      {children}
    </BaseLocaleProvider>
  );
}

export function useLocale() {
  return useLocaleBase<Translations>() as unknown as {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: Translations;
  };
}
