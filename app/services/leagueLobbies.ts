export interface LeagueLobby {
  phaseId: string | null;
  tournamentId: string;
  internalTournamentId?: string;
  seasonId?: string;
}

interface LeaguePlatformConfig {
  tournamentId?: string | null;
  internalTournamentId?: string | null;
  seasonId?: string | null;
  phaseTournaments?: Array<{
    phaseId: string;
    tournamentId: string;
    internalTournamentId?: string | null;
    seasonId?: string | null;
  }> | null;
}

export function resolveLeagueLobbies(
  platformConfig: LeaguePlatformConfig
): LeagueLobby[] {
  const phaseTournaments = platformConfig.phaseTournaments ?? [];
  if (phaseTournaments.length > 0) {
    return phaseTournaments
      .filter((entry) => Boolean(entry.tournamentId))
      .map((entry) => ({
        phaseId: entry.phaseId,
        tournamentId: entry.tournamentId,
        internalTournamentId: entry.internalTournamentId ?? undefined,
        seasonId: entry.seasonId ?? undefined,
      }));
  }
  if (!platformConfig.tournamentId) {
    return [];
  }
  return [
    {
      phaseId: null,
      tournamentId: platformConfig.tournamentId,
      internalTournamentId:
        platformConfig.internalTournamentId ?? undefined,
      seasonId: platformConfig.seasonId ?? undefined,
    },
  ];
}