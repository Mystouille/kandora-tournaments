import { slugify } from "~/utils/slugify";

export function buildLeagueStatisticsUrl({
  baseUrl,
  leagueName,
  locale,
  slug,
}: {
  baseUrl: string;
  leagueName: string;
  locale: "en" | "fr";
  slug?: string;
}): string {
  const localeSegment = locale === "en" ? "/en" : "";
  const leagueSlug = slug ?? slugify(leagueName);
  return `${baseUrl.replace(/\/+$/, "")}${localeSegment}/online-tournaments/${leagueSlug}/statistics`;
}
