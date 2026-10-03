import type { Ruleset } from "~/core/models/tournament/League";
import type { LeagueTypeConfig } from "~/core/types/league-config";
import type {
  SummaryData,
  SummaryIdentity,
  SummaryStanding,
} from "~/types/leagueGameSummary";
import { resolveGamePhaseId, resolveOrderedPhases } from "./league-configs";
import { isGameScored } from "./leagueUtils";
import {
  buildUserToTeamMap,
  computeNonTeamRankingData,
  computeTeamBasedRankingData,
} from "./league-strategies/regularRankingStrategies";
import {
  computePhaseScoreTimeline,
  totalTimelineScore,
  type PhaseScoreTeam,
} from "./league-strategies/phaseScoreTimeline";
import { computeMultiPhaseStandings } from "./league-strategies/multiPhaseStrategies";

export interface SummaryStandingsGame {
  id: string;
  startTime: Date;
  endTime: Date | null;
  phaseId?: string | null;
  isValid: boolean;
  results: { userId: string; score: number; place: number }[];
}

export interface SummaryStandingsInput {
  selectedGameId: string;
  games: SummaryStandingsGame[];
  teams: PhaseScoreTeam[];
  participants: SummaryIdentity[];
  isTeamMode: boolean;
  leagueType: LeagueTypeConfig | null;
  rules: Ruleset;
  cutoffs: Date[];
  finalParticipantIds: Set<string> | null;
  excludedPlayerIds: ReadonlySet<string>;
  /** Scheduled appearances in the selected game's phase. */
  scheduledGameCounts: ReadonlyMap<string, number>;
}

function hasCompletion(game: SummaryStandingsGame): boolean {
  return (
    game.endTime !== null &&
    Number.isFinite(game.endTime.getTime()) &&
    game.endTime.getTime() >= game.startTime.getTime()
  );
}

function completionOrder(a: SummaryStandingsGame, b: SummaryStandingsGame) {
  return (
    a.endTime!.getTime() - b.endTime!.getTime() ||
    a.startTime.getTime() - b.startTime.getTime() ||
    a.id.localeCompare(b.id)
  );
}

export function buildGameSummaryStandings(
  input: SummaryStandingsInput
): SummaryData<SummaryStanding[]> {
  const selected = input.games.find((game) => game.id === input.selectedGameId);
  if (!selected || !hasCompletion(selected)) {
    return { status: "unavailable", reason: "unknownChronology" };
  }
  const now = selected.endTime!;
  const candidates = input.games.filter(
    (game) =>
      game.startTime.getTime() <= now.getTime() &&
      isGameScored(game.results) &&
      (game.isValid || game.id === selected.id)
  );
  if (candidates.some((game) => !hasCompletion(game))) {
    return { status: "unavailable", reason: "unknownChronology" };
  }
  const history = candidates
    .filter((game) => completionOrder(game, selected) <= 0 && game.isValid)
    .sort(completionOrder);
  const phases = resolveOrderedPhases(input.leagueType);
  const phaseIndexes = new Map(phases.map((phase) => [phase.id, phase.index]));

  // A tagged phase can begin before its configured calendar cutoff.
  const cutoffs = phases.slice(1).map((phase, index) => {
    const taggedStart = history
      .filter(
        (game) =>
          game.phaseId && (phaseIndexes.get(game.phaseId) ?? -1) >= phase.index
      )
      .reduce(
        (earliest, game) => Math.min(earliest, game.startTime.getTime()),
        Infinity
      );
    return new Date(
      Math.min(
        input.cutoffs[index]?.getTime() ?? Infinity,
        taggedStart,
        8.64e15
      )
    );
  });
  const activePhase = cutoffs.reduce(
    (phase, cutoff, index) => (cutoff <= now ? index + 1 : phase),
    0
  );
  const isFinalPhase = phases[activePhase]?.kind === "final";
  const isLastLeaguePhase =
    isFinalPhase || (phases.length > 1 && activePhase === phases.length - 1);
  if (activePhase > 0 && isFinalPhase && input.finalParticipantIds === null) {
    return { status: "unavailable", reason: "missingQualification" };
  }

  const teams = input.teams.map((team) => ({
    ...team,
    roster: {
      members: team.roster.members.filter(
        (id) => !input.excludedPlayerIds.has(String(id))
      ),
      substitutes: (team.roster.substitutes ?? []).filter(
        (id) => !input.excludedPlayerIds.has(String(id))
      ),
    },
    finalsRoster: team.finalsRoster
      ? {
          members: team.finalsRoster.members.filter(
            (id) => !input.excludedPlayerIds.has(String(id))
          ),
          substitutes: (team.finalsRoster.substitutes ?? []).filter(
            (id) => !input.excludedPlayerIds.has(String(id))
          ),
        }
      : null,
  }));
  const regularTeamMap = buildUserToTeamMap(teams);
  const finalTeamMap = buildUserToTeamMap(
    teams.map((team) => ({ ...team, roster: team.finalsRoster ?? team.roster }))
  );
  const rankingParticipants = input.isTeamMode
    ? teams
    : input.participants.map((person) => ({
        _id: person.id,
        roster: { members: [person.id], substitutes: [] },
      }));
  const entityFor = (game: SummaryStandingsGame, userId: string) => {
    if (input.excludedPlayerIds.has(userId)) {
      return undefined;
    }
    if (!input.isTeamMode) {
      return userId;
    }
    const phaseId = resolveGamePhaseId(game, input.leagueType, {
      phaseCutoffTimes: cutoffs,
    });
    return (
      phaseId === input.leagueType?.finalPhase?.id
        ? finalTeamMap
        : regularTeamMap
    ).get(userId);
  };

  const snapshot = (games: SummaryStandingsGame[]) => {
    let totals: Map<string, number>;
    let eliminated = new Set<string>();
    if (activePhase > 0) {
      const timeline = computePhaseScoreTimeline({
        leagueType: input.leagueType,
        games,
        teams,
        rules: input.rules,
        cutoffs,
        now,
        finalParticipantIds: input.finalParticipantIds,
        excludedPlayerIds: input.excludedPlayerIds,
      });
      totals = new Map(
        [...(input.isTeamMode ? timeline.teams : timeline.players)].map(
          ([id, changes]) => [id, totalTimelineScore(changes)]
        )
      );
      eliminated = new Set(timeline.eliminatedTeams.keys());
      if (!input.isTeamMode && input.leagueType) {
        const qualified = isFinalPhase
          ? input.finalParticipantIds!
          : new Set(
              computeMultiPhaseStandings(
                input.leagueType,
                games,
                input.rules,
                rankingParticipants,
                cutoffs,
                activePhase
              ).standings.map((standing) => standing.teamId)
            );
        eliminated = new Set(
          input.participants
            .filter((person) => !qualified.has(person.id))
            .map((person) => person.id)
        );
      }
    } else {
      const scoring =
        input.leagueType?.regularPhases?.[0]?.scoring ??
        input.leagueType?.regularPhase?.scoring;
      if (input.isTeamMode) {
        const result = computeTeamBasedRankingData(
          games,
          input.rules,
          regularTeamMap,
          scoring?.type === "team-delta-cap"
            ? {
                enableCap: true,
                capPercent: scoring.capPercent,
                minGamesForCap: scoring.minGamesForCap,
              }
            : { enableCap: false }
        );
        totals = new Map(
          result.sortedTeams.map((team) => [team.teamId, team.totalScore])
        );
      } else {
        const result = computeNonTeamRankingData(
          games,
          input.rules,
          scoring,
          regularTeamMap
        );
        totals = new Map(
          result.sortedPlayers.map((player) => [
            player.userId,
            player.rankingScore,
          ])
        );
      }
    }
    return { totals, eliminated };
  };

  const before = snapshot(history.filter((game) => game.id !== selected.id));
  const after = snapshot(history);
  const selectedPhaseId = resolveGamePhaseId(selected, input.leagueType, {
    phaseCutoffTimes: input.cutoffs,
  });
  const gamesPlayed = new Map<string, number>();
  const currentPhaseGames = history.filter(
    (game) =>
      resolveGamePhaseId(game, input.leagueType, {
        phaseCutoffTimes: cutoffs,
      }) === phases[activePhase]?.id
  );
  const currentPhaseCounts = new Map<string, number>();
  for (const game of currentPhaseGames) {
    for (const result of game.results) {
      const id = entityFor(game, result.userId);
      if (id) {
        currentPhaseCounts.set(id, (currentPhaseCounts.get(id) ?? 0) + 1);
      }
    }
  }
  for (const game of history) {
    if (
      resolveGamePhaseId(game, input.leagueType, {
        phaseCutoffTimes: input.cutoffs,
      }) !== selectedPhaseId
    ) {
      continue;
    }
    for (const result of game.results) {
      const id = entityFor(game, result.userId);
      if (id) {
        gamesPlayed.set(id, (gamesPlayed.get(id) ?? 0) + 1);
      }
    }
  }
  const playedThisGame = new Set(
    selected.results.map((result) => entityFor(selected, result.userId))
  );
  const rows: SummaryStanding[] = input.participants
    .filter(
      (person) => input.isTeamMode || !input.excludedPlayerIds.has(person.id)
    )
    .map((person) => {
      const eliminated = after.eliminated.has(person.id);
      const total = after.totals.get(person.id) ?? 0;
      return {
        ...person,
        rank: 0,
        rankHighlight: null,
        totalScore: eliminated ? null : total,
        pointsChange: eliminated
          ? null
          : Math.round((total - (before.totals.get(person.id) ?? 0)) * 10) / 10,
        pointsDifference: null,
        gamesPlayed: gamesPlayed.get(person.id) ?? 0,
        totalGames: eliminated
          ? null
          : (input.scheduledGameCounts.get(person.id) ?? null),
        eliminated,
        playedThisGame: playedThisGame.has(person.id),
      };
    })
    .sort(
      (a, b) =>
        Number(a.eliminated) - Number(b.eliminated) ||
        (b.totalScore ?? 0) - (a.totalScore ?? 0) ||
        a.id.localeCompare(b.id)
    );
  const regularPhase =
    input.leagueType?.regularPhases?.[activePhase] ??
    (activePhase === 0 ? input.leagueType?.regularPhase : undefined);
  const nextPhase = phases[activePhase + 1];
  let qualifiedIds = new Set<string>();
  if (!isLastLeaguePhase && regularPhase && input.leagueType) {
    if (regularPhase.progression && nextPhase?.kind === "regular") {
      qualifiedIds = new Set(
        computeMultiPhaseStandings(
          input.leagueType,
          history,
          input.rules,
          rankingParticipants,
          cutoffs,
          activePhase + 1
        ).standings.map((standing) => standing.teamId)
      );
    } else if (
      !input.isTeamMode &&
      regularPhase.scoring.type === "best-consecutive-window" &&
      regularPhase.scoring.qualificationMode === "faction-top-n"
    ) {
      qualifiedIds = computeNonTeamRankingData(
        currentPhaseGames,
        input.rules,
        regularPhase.scoring,
        regularTeamMap,
        regularPhase.minGames
      ).qualifiedByFaction;
    } else {
      const qualifyingCount =
        nextPhase?.kind === "final"
          ? Math.max(
              0,
              ...(input.leagueType.finalPhase?.stages.flatMap(
                (stage) => stage.seeds
              ) ?? [])
            )
          : (regularPhase.progression?.advancingCount ?? 0);
      qualifiedIds = new Set(
        rows
          .filter(
            (row) =>
              !row.eliminated &&
              (currentPhaseCounts.get(row.id) ?? 0) >=
                (regularPhase.minGames ?? 0)
          )
          .slice(0, qualifyingCount)
          .map((row) => row.id)
      );
    }
  }
  rows.forEach((row, index) => {
    row.rank = index + 1;
    if (row.eliminated) {
      return;
    }
    const precedingScore = rows[index - 1]?.totalScore;
    if (row.totalScore !== null && precedingScore != null) {
      row.pointsDifference =
        Math.round((precedingScore - row.totalScore) * 10) / 10;
    }
    if (isLastLeaguePhase && index === 0) {
      row.rankHighlight = "leader";
    } else if (qualifiedIds.has(row.id)) {
      row.rankHighlight = "qualified";
    }
  });
  return { status: "available", data: rows };
}
