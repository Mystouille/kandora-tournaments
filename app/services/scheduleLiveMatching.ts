export interface MatchableScheduledGame {
  id: string;
  phaseId: string | null;
  scheduledAt: Date;
  participantIds: Array<string | null>;
}

export interface MatchableLiveGame {
  gameId: string;
  platform: string;
  phaseId: string | null;
  startTime: Date | null;
  participantIds: Array<string | null>;
  watchId?: string | null;
}

export interface TeamMembership {
  id: string;
  rosterUserIds: string[];
  finalsRosterUserIds?: string[] | null;
}

function participantSetKey(
  participantIds: Array<string | null>
): string | null {
  if (
    participantIds.length !== 4 ||
    participantIds.some((participantId) => participantId === null)
  ) {
    return null;
  }
  const ids = participantIds as string[];
  if (new Set(ids).size !== 4) {
    return null;
  }
  return [...ids].sort().join("|");
}

export function matchScheduledGamesToLiveGames(
  scheduledGames: MatchableScheduledGame[],
  liveGames: MatchableLiveGame[]
): Map<string, MatchableLiveGame> {
  const candidates: Array<{
    scheduledGame: MatchableScheduledGame;
    liveGame: MatchableLiveGame;
    distance: number;
  }> = [];

  for (const scheduledGame of scheduledGames) {
    const scheduledKey = participantSetKey(scheduledGame.participantIds);
    if (!scheduledKey) {
      continue;
    }
    for (const liveGame of liveGames) {
      if (
        liveGame.platform !== "tenhou" ||
        !liveGame.watchId ||
        liveGame.phaseId !== scheduledGame.phaseId
      ) {
        continue;
      }
      const liveKey = participantSetKey(liveGame.participantIds);
      if (liveKey !== scheduledKey) {
        continue;
      }
      candidates.push({
        scheduledGame,
        liveGame,
        // Calendar time is a tie-breaker only, never an eligibility
        // window. A game may start before or after its announced time.
        distance: liveGame.startTime
          ? Math.abs(
              liveGame.startTime.getTime() - scheduledGame.scheduledAt.getTime()
            )
          : Number.POSITIVE_INFINITY,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.scheduledGame.id.localeCompare(right.scheduledGame.id) ||
      left.liveGame.gameId.localeCompare(right.liveGame.gameId)
  );

  const matches = new Map<string, MatchableLiveGame>();
  const usedLiveGameIds = new Set<string>();
  for (const candidate of candidates) {
    if (
      matches.has(candidate.scheduledGame.id) ||
      usedLiveGameIds.has(candidate.liveGame.gameId)
    ) {
      continue;
    }
    matches.set(candidate.scheduledGame.id, candidate.liveGame);
    usedLiveGameIds.add(candidate.liveGame.gameId);
  }
  return matches;
}

export function resolveLiveTeamIds(
  userIds: Array<string | null>,
  teams: TeamMembership[],
  useFinalsRoster: boolean
): string[] | null {
  const teamByUserId = new Map<string, string | null>();
  for (const team of teams) {
    const effectiveRoster =
      useFinalsRoster && team.finalsRosterUserIds
        ? team.finalsRosterUserIds
        : team.rosterUserIds;
    for (const userId of effectiveRoster) {
      if (!teamByUserId.has(userId)) {
        teamByUserId.set(userId, team.id);
      } else if (teamByUserId.get(userId) !== team.id) {
        teamByUserId.set(userId, null);
      }
    }
  }

  const teamIds: string[] = [];
  for (const userId of userIds) {
    if (!userId) {
      return null;
    }
    const teamId = teamByUserId.get(userId);
    if (!teamId) {
      return null;
    }
    teamIds.push(teamId);
  }
  if (new Set(teamIds).size !== teamIds.length) {
    return null;
  }
  return teamIds;
}