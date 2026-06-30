import type { Locale } from "../i18n/types";
import type { LocalizedTournamentText } from "../types/tournament";

export function getTournamentText(
  value: LocalizedTournamentText | undefined,
  locale: Locale
): string {
  if (!value) {
    return "";
  }
  return value[locale] || value.fr || "";
}

function toDateLocale(locale: Locale): string {
  return locale === "fr" ? "fr-FR" : "en-GB";
}

export function formatTournamentDate(date: string | Date, locale: Locale) {
  return new Date(date).toLocaleDateString(toDateLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatTournamentDateRange(
  dates: Array<string | Date> | undefined,
  locale: Locale
) {
  if (!dates || dates.length === 0) {
    return "";
  }

  const normalized = dates
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  if (normalized.length === 0) {
    return "";
  }
  if (normalized.length === 1) {
    return formatTournamentDate(normalized[0], locale);
  }

  const first = formatTournamentDate(normalized[0], locale);
  const last = formatTournamentDate(normalized[normalized.length - 1], locale);
  return first === last ? first : `${first} - ${last}`;
}
