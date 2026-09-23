import { webAppPath } from "./shell";

export interface MobileSeatEnrichment {
  teamName: string | null;
  teamLogoUrl: string | null;
}

export function absoluteSeatEnrichment(
  baseUrl: string,
  seatEnrichment: ReadonlyArray<MobileSeatEnrichment | null>
): Array<MobileSeatEnrichment | null> {
  return seatEnrichment.map((enrichment) => {
    if (enrichment === null || enrichment.teamLogoUrl === null) {
      return enrichment;
    }
    try {
      return {
        ...enrichment,
        teamLogoUrl: webAppPath(baseUrl, enrichment.teamLogoUrl),
      };
    } catch {
      return { ...enrichment, teamLogoUrl: null };
    }
  });
}
