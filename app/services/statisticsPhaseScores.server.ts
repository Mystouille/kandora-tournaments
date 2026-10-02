import { GameModel, type Game } from "~/core/models/tournament/Game";
import { TeamModel, type Team } from "~/core/models/tournament/Team";
import { type League } from "~/core/models/tournament/League";
import {
  BracketModel,
  getSeedingParticipantId,
  type Bracket,
} from "~/core/models/tournament/Bracket";
import { resolveOrderedPhases } from "./league-configs";
import {
  computePhaseScoreTimeline,
  type DailyScoreChanges,
  type PhaseScoreTimeline,
} from "./league-strategies/phaseScoreTimeline";

export async function loadAllPhaseScores(
  leagues: League[],
  startDate: string | null,
  endDate: string | null
): Promise<PhaseScoreTimeline | null> {
  if (
    !leagues.some(
      (league) => resolveOrderedPhases(league.leagueTypeConfig).length > 1
    )
  ) {
    return null;
  }
  const leagueIds = leagues.map((league) => league._id);
  const [games, teams] = await Promise.all([
    GameModel.find({ league: { $in: leagueIds }, isValid: true })
      .select("league startTime phaseId results")
      .lean<Game[]>(),
    TeamModel.find({ leagueId: { $in: leagueIds } })
      .select("_id leagueId roster finalsRoster")
      .lean<Team[]>(),
  ]);
  const result: PhaseScoreTimeline = {
    players: new Map(),
    teams: new Map(),
    eliminatedTeams: new Map(),
    hasTransitions: false,
  };
  const merge = (
    target: DailyScoreChanges,
    source: DailyScoreChanges
  ): void => {
    for (const [id, changes] of source) {
      let daily = target.get(id);
      if (!daily) {
        daily = new Map();
        target.set(id, daily);
      }
      for (const [day, delta] of changes) {
        daily.set(day, (daily.get(day) ?? 0) + delta);
      }
    }
  };
  for (const league of leagues) {
    const leagueType = league.leagueTypeConfig;
    const bracket = leagueType?.finalPhase
      ? await BracketModel.findOne({ league: league._id })
          .select("seedings")
          .lean<Bracket | null>()
      : null;
    const timeline = computePhaseScoreTimeline({
      leagueType,
      rules: league.rulesConfig.gameRules,
      cutoffs: league.phaseCutoffTimes ?? [],
      teams: teams.filter(
        (team) => team.leagueId.toString() === league._id.toString()
      ),
      games: games
        .filter((game) => game.league?.toString() === league._id.toString())
        .map((game) => ({
          startTime: game.startTime,
          phaseId: game.phaseId,
          results: (game.results ?? []).map((entry) => ({
            userId: entry.userId.toString(),
            score: entry.score,
          })),
        })),
      finalParticipantIds:
        bracket && leagueType
          ? new Set(
              bracket.seedings.map((seed) =>
                getSeedingParticipantId(seed, leagueType.isTeamMode).toString()
              )
            )
          : null,
      startDate,
      endDate,
      excludedPlayerIds: new Set(
        (league.officialSubstitutes ?? []).map(String)
      ),
    });
    result.hasTransitions ||= timeline.hasTransitions;
    merge(result.players, timeline.players);
    merge(result.teams, timeline.teams);
    for (const [id, day] of timeline.eliminatedTeams) {
      result.eliminatedTeams.set(id, day);
    }
  }
  return result.hasTransitions ? result : null;
}
