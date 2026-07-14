import { createHash } from "node:crypto";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { type League, LeagueModel, ongoingLeagueFilter } from "~/db/League";
import { GameModel, type Game } from "~/db/Game";
import { TeamModel, type Team } from "~/db/Team";
import { LeagueUserModel } from "~/db/LeagueUser";
import { UserModel, type User } from "~/db/User";
import {
  BracketModel,
  type Bracket,
  getSeedingParticipantId,
} from "~/db/Bracket";
import { LeagueRankingMessageModel } from "~/db/LeagueRankingMessage";
import { computePlayerDeltas } from "~/services/leagueUtils";
import { hydrateLeagueGames } from "~/services/GameHydrationService.server";
import { createConnectorForLeague } from "~/services/connectors/createConnectorForLeague.server";
import type { ILeagueTournamentConnector } from "~/services/connectors/ILeagueTournamentConnector.server";
import { syncOngoingGameMessages } from "~/services/ongoingGameMessageService.server";
import {
  buildUserToTeamMap,
  computeNonTeamRankingData,
  computeTeamBasedRankingData,
  type PlayerRankingScore,
} from "~/services/league-strategies/regularRankingStrategies";
import { resolveFinalDeltaComputer } from "~/services/league-strategies/finalPhaseStrategies";
import {
  computeBracket,
  renderBracketAsciiParts,
  type BracketContext,
} from "~/services/bracketUtils";
import { buildOfficialSubstituteTeamMap } from "~/services/schedulingMessageService.server";
import { en, fr } from "~/i18n";
import type { Locale } from "~/i18n";
import { formatString } from "~/i18n/formatString";
import {
  sendChannelMessage,
  editChannelMessage,
  fetchChannelMessage,
  deleteChannelMessage,
} from "~/services/discordPublisher.server";
import {
  buildFinalsGameMatch,
  buildRegularGameMatch,
  computeScoreCarryOverOffsets,
  isMultiPhaseLeague,
  resolveConfiguredBracketStages,
  resolveCurrentPhaseIndex,
  resolveFinalPhaseGameCutoff,
  resolveLeagueTypeConfig,
  resolveMultiPhaseCutoffs,
  type LeagueTypeConfig,
} from "~/services/league-configs";
import { computeMultiPhaseStandings } from "~/services/league-strategies/multiPhaseStrategies";
import { getLeagueQueue } from "~/services/queue.server";
import { slugify } from "~/utils/slugify";
import {
  getLeaguePlatform,
  resolvePlayerDisplay,
} from "~/services/playerDisplay.server";

/**
 * Stable content signature for a ranking message part. The rendered text
 * always carries a relative "last updated" timestamp (`<t:1700000000:R>`) that
 * changes on every pass, so those tokens are normalized out before hashing.
 * Two renders with the same underlying data therefore hash identically, letting
 * callers skip needless Discord edits when nothing meaningful changed.
 */
function rankingPartHash(content: string): string {
  const normalized = content.replace(/<t:\d+(?::[tTdDfFR])?>/g, "<t>");
  return createHash("sha256").update(normalized).digest("hex");
}

function getLeagueLocale(league: League): Locale {
  const raw = league.discordConfig?.locale;
  return raw === "en" ? "en" : "fr";
}

function getLeagueText(league: League) {
  return getLeagueLocale(league) === "en" ? en.leagueService : fr.leagueService;
}

function getLeagueStatisticsText(league: League) {
  return getLeagueLocale(league) === "en" ? en.statistics : fr.statistics;
}

function getLeagueStatisticsUrl(league: League, slug?: string): string {
  const localeSegment = getLeagueLocale(league) === "en" ? "/en" : "";
  const leagueSlug = slug ?? slugify(league.name);
  return `https://www.tnt-sessions.com${localeSegment}/online-tournaments/${leagueSlug}/statistics`;
}

/**
 * Render a column of ranking scores as decimal-aligned, inline-code strings so
 * their decimal points line up in Discord's monospace code span — independent
 * of the (variable-width, e.g. Hangul) names that follow on each line. Each
 * score is signed and fixed to one decimal; the integer part is left-padded to
 * a common width so the decimal points share a column.
 */
function formatAlignedScores(scores: number[]): string[] {
  const strings = scores.map((s) => `${s >= 0 ? "+" : ""}${s.toFixed(1)}`);
  const maxIntWidth = strings.reduce(
    (max, s) => Math.max(max, s.indexOf(".")),
    0
  );
  return strings.map((s) => {
    const dot = s.indexOf(".");
    return `\`${s.slice(0, dot).padStart(maxIntWidth)}${s.slice(dot)}\``;
  });
}

/**
 * Parse a Discord snowflake id into a BigInt for chronological comparison.
 * Snowflakes are monotonically increasing with creation time, so a larger id
 * means a newer message. Returns null for ids that aren't plain decimal
 * snowflakes so callers can fall back to non-ordering behaviour.
 */
function toSnowflake(id: string): bigint | null {
  if (!/^\d+$/.test(id)) {
    return null;
  }
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

function buildFactionGroupedSeedOrder(
  sortedPlayers: PlayerRankingScore[],
  qualifiedByFaction: Set<string>
): PlayerRankingScore[] {
  const grouped = new Map<string, PlayerRankingScore[]>();
  const noFactionQualified: PlayerRankingScore[] = [];

  for (const player of sortedPlayers) {
    if (!qualifiedByFaction.has(player.userId)) {
      continue;
    }

    if (!player.factionTeamId) {
      noFactionQualified.push(player);
      continue;
    }

    const players = grouped.get(player.factionTeamId) ?? [];
    players.push(player);
    grouped.set(player.factionTeamId, players);
  }

  for (const players of grouped.values()) {
    players.sort((a, b) => {
      if (b.rankingScore !== a.rankingScore) {
        return b.rankingScore - a.rankingScore;
      }
      return a.userId.localeCompare(b.userId);
    });
  }

  const sortedFactions = Array.from(grouped.entries()).sort((a, b) => {
    const bestA = a[1][0]?.rankingScore ?? -Infinity;
    const bestB = b[1][0]?.rankingScore ?? -Infinity;
    if (bestB !== bestA) {
      return bestB - bestA;
    }
    return a[0].localeCompare(b[0]);
  });

  const ordered: PlayerRankingScore[] = [];
  for (const [, players] of sortedFactions) {
    ordered.push(...players);
  }
  ordered.push(...noFactionQualified);

  if (ordered.length < qualifiedByFaction.size) {
    const seen = new Set(ordered.map((p) => p.userId));
    for (const player of sortedPlayers) {
      if (qualifiedByFaction.has(player.userId) && !seen.has(player.userId)) {
        ordered.push(player);
        seen.add(player.userId);
      }
    }
  }

  return ordered;
}

function includeMissingFactionMembers(
  players: PlayerRankingScore[],
  teams: Team[]
): PlayerRankingScore[] {
  const augmented = [...players];
  const seen = new Set(players.map((p) => p.userId));

  for (const team of teams) {
    const factionTeamId = team._id.toString();
    const rosterIds = [
      ...(team.roster.members ?? []),
      ...(team.roster.substitutes ?? []),
    ];
    for (const memberId of rosterIds) {
      const userId = memberId.toString();
      if (seen.has(userId)) {
        continue;
      }
      augmented.push({
        userId,
        rankingScore: 0,
        gamesCounted: 0,
        totalGamesPlayed: 0,
        factionTeamId,
      });
      seen.add(userId);
    }
  }

  return augmented;
}

function computeFactionQualifiedUsers(
  players: PlayerRankingScore[],
  qualificationCount: number,
  minGames = 0
): Set<string> {
  const qualified = new Set<string>();
  const byFaction = new Map<string, PlayerRankingScore[]>();

  for (const player of players) {
    if (!player.factionTeamId) {
      continue;
    }
    // Exclude players below the phase's minimum-games gate from qualification.
    if (minGames > 0 && (player.totalGamesPlayed ?? 0) < minGames) {
      continue;
    }
    const factionPlayers = byFaction.get(player.factionTeamId) ?? [];
    factionPlayers.push(player);
    byFaction.set(player.factionTeamId, factionPlayers);
  }

  for (const factionPlayers of byFaction.values()) {
    factionPlayers.sort((a, b) => {
      if (b.rankingScore !== a.rankingScore) {
        return b.rankingScore - a.rankingScore;
      }
      const gamesA = a.totalGamesPlayed ?? a.gamesCounted;
      const gamesB = b.totalGamesPlayed ?? b.gamesCounted;
      if (gamesB !== gamesA) {
        return gamesB - gamesA;
      }
      return a.userId.localeCompare(b.userId);
    });

    for (const player of factionPlayers.slice(0, qualificationCount)) {
      qualified.add(player.userId);
    }
  }

  return qualified;
}

export class LeagueService {
  private static readonly GLOBAL_KEY = "__LeagueService__";

  private constructor() {}

  public static get instance(): LeagueService {
    if (!(globalThis as any)[LeagueService.GLOBAL_KEY]) {
      (globalThis as any)[LeagueService.GLOBAL_KEY] = new LeagueService();
    }
    return (globalThis as any)[LeagueService.GLOBAL_KEY];
  }

  public async InitLeague(specificLeague?: League): Promise<void> {
    await connectToDatabase();

    const leagues = specificLeague
      ? [specificLeague]
      : await LeagueModel.find({
          ...ongoingLeagueFilter(),
          "platformConfig.tournamentId": { $exists: true, $ne: null },
        })
          .populate("leagueTypeConfig")
          .lean<League[]>();

    // Remove schedulers for leagues that are no longer active
    const activeLeagueIds = new Set(leagues.map((l) => l._id.toString()));

    const existingSchedulers = await getLeagueQueue().getJobSchedulers(0, 1000);
    for (const scheduler of existingSchedulers) {
      if (!scheduler) {
        continue;
      }
      const schedulerKey =
        (scheduler as any).key ?? (scheduler as any).id ?? null;
      if (!schedulerKey) {
        continue;
      }
      const match = schedulerKey.match(/^league-update-repeat-(.+)$/);
      if (match && !activeLeagueIds.has(match[1])) {
        await getLeagueQueue().removeJobScheduler(schedulerKey);
        console.log(`Removed stale scheduler ${schedulerKey}`);
      }
    }

    if (leagues.length === 0) {
      console.log("No ongoing league found.");
      return;
    }

    for (const league of leagues) {
      const currentTime = new Date();
      if (currentTime > league.startTime) {
        // Enqueue jobs as long as league is ongoing and hasn't ended
        const leagueHasEnded = league.endTime && currentTime > league.endTime;
        if (!leagueHasEnded) {
          const leagueId = league._id.toString();
          const schedulerId = `league-update-repeat-${leagueId}`;
          const repeatJobName = `update-games:${leagueId}`;

          // Enqueue recurring league update jobs every minute
          const queueWithScheduler = getLeagueQueue() as ReturnType<
            typeof getLeagueQueue
          > & {
            upsertJobScheduler?: (
              id: string,
              repeatOpts: { every: number },
              jobTemplate: {
                name: string;
                data: { leagueId: string };
                opts: {
                  removeOnComplete: boolean;
                  removeOnFail: boolean;
                  attempts: number;
                  backoff: { type: "exponential"; delay: number };
                };
              }
            ) => Promise<unknown>;
          };

          if (queueWithScheduler.upsertJobScheduler) {
            await queueWithScheduler.upsertJobScheduler(
              schedulerId,
              {
                every: 30 * 1000,
              },
              {
                name: repeatJobName,
                data: { leagueId },
                opts: {
                  removeOnComplete: true,
                  removeOnFail: false,
                  attempts: 3,
                  backoff: {
                    type: "exponential",
                    delay: 2000,
                  },
                },
              }
            );
          } else {
            // Fallback for older BullMQ APIs.
            await getLeagueQueue().add(
              repeatJobName,
              { leagueId },
              {
                jobId: schedulerId,
                repeat: {
                  every: 30 * 1000,
                },
                removeOnComplete: true,
                removeOnFail: false,
                attempts: 3,
                backoff: {
                  type: "exponential",
                  delay: 2000,
                },
              }
            );
          }

          console.log(`League update jobs enqueued for league ${league.name}.`);
        }
      }
    }
  }

  public async updateGamesInLeagueById(leagueId: string): Promise<string> {
    await connectToDatabase();

    const league = (await LeagueModel.findById(leagueId)
      .populate("leagueTypeConfig")
      .lean()) as League | null;
    if (!league) {
      console.log(`League with id ${leagueId} not found.`);
      return leagueId;
    }

    const connector = createConnectorForLeague(league);
    await hydrateLeagueGames(league, connector);
    await this.updateRankingMessages(league);
    try {
      await syncOngoingGameMessages(league, connector);
    } catch (error) {
      console.error(
        `Failed to sync ongoing-game messages for league ${league.name}:`,
        error
      );
    }
    return league.name;
  }

  private async updateRankingMessages(league: League) {
    try {
      await this.publishNewGames(league);
    } catch (error) {
      console.error(
        `Failed to publish new games for league ${league.name}:`,
        error
      );
    }

    if (!league.discordConfig?.rankingChannel) {
      return;
    }

    const t = getLeagueText(league);

    const connector = createConnectorForLeague(league);
    const lobbyStatusLine = await this.buildLobbyStatusLine(league, connector);

    const leagueType = resolveLeagueTypeConfig(league.leagueTypeConfig);

    const firstCutoff = league.phaseCutoffTimes?.[0]
      ? new Date(league.phaseCutoffTimes[0])
      : null;
    const isPastFinalsCutoff = firstCutoff != null && new Date() >= firstCutoff;
    const isFinalsOnly =
      leagueType?.finalPhase != null &&
      !leagueType.regularPhase &&
      !leagueType.regularPhases;
    const shouldRenderBracket =
      leagueType?.finalPhase != null && (isPastFinalsCutoff || isFinalsOnly);

    if (shouldRenderBracket) {
      await this.ensureBracketSeedings(league, leagueType!);
      await this.updateBracketMessage(league, lobbyStatusLine);
      return;
    }

    if (isMultiPhaseLeague(leagueType)) {
      await this.updateMultiPhaseRankingMessage(
        league,
        leagueType!,
        lobbyStatusLine
      );
      return;
    }

    await connectToDatabase();

    const games = await GameModel.find({
      league: league._id,
      isValid: true,
    }).lean<Game[]>();

    const isTeamMode =
      league.rulesConfig.isTeamMode ?? leagueType?.isTeamMode ?? true;

    if (!isTeamMode) {
      const scoring = leagueType?.regularPhase?.scoring;

      const teams = await TeamModel.find({
        leagueId: league._id,
      }).lean<Team[]>();
      const teamMap = new Map(teams.map((team) => [team._id.toString(), team]));
      const userToTeamMap = buildUserToTeamMap(teams);

      const { sortedPlayers, qualifiedByFaction } = computeNonTeamRankingData(
        games.map((game) => ({
          startTime: game.startTime,
          results: (game.results ?? []).map((result) => ({
            userId: result.userId.toString(),
            score: result.score,
          })),
        })),
        league.rulesConfig.gameRules,
        scoring,
        userToTeamMap,
        leagueType?.regularPhase?.minGames ?? 0
      );

      const hasFactions = teams.length > 0;

      let rankingBody: string;
      if (hasFactions) {
        // Group players by faction, each faction sorted by score
        const factionGroups = new Map<
          string,
          { factionName: string; players: PlayerRankingScore[] }
        >();
        const noFaction: PlayerRankingScore[] = [];

        // Seed all factions so they appear even with zero games
        for (const [teamId, team] of teamMap) {
          factionGroups.set(teamId, {
            factionName: team.displayName || team.simpleName || t.unknownTeam,
            players: [],
          });
          // Ensure all members appear in the player list
          for (const memberId of [
            ...(team.roster.members ?? []),
            ...(team.roster.substitutes ?? []),
          ]) {
            const id = memberId.toString();
            if (!sortedPlayers.some((p) => p.userId === id)) {
              sortedPlayers.push({
                userId: id,
                rankingScore: 0,
                gamesCounted: 0,
                factionTeamId: teamId,
              });
            }
          }
        }

        // Fetch users for any newly added members
        const allUserIds = sortedPlayers.map((p) => p.userId);
        const users = await UserModel.find({
          _id: { $in: allUserIds },
        }).lean<User[]>();
        const userMap = new Map(users.map((u) => [u._id.toString(), u]));

        for (const playerScore of sortedPlayers) {
          if (playerScore.factionTeamId) {
            let group = factionGroups.get(playerScore.factionTeamId);
            if (!group) {
              const ft = teamMap.get(playerScore.factionTeamId);
              group = {
                factionName: ft?.displayName || ft?.simpleName || t.unknownTeam,
                players: [],
              };
              factionGroups.set(playerScore.factionTeamId, group);
            }
            group.players.push(playerScore);
          } else {
            noFaction.push(playerScore);
          }
        }

        const isBestConsecutive = scoring?.type === "best-consecutive-window";
        const windowSize =
          scoring?.type === "best-consecutive-window" ? scoring.windowSize : 0;

        const leaguePlatform = getLeaguePlatform(league);
        const factionScoreCells = formatAlignedScores(
          sortedPlayers.map((p) => p.rankingScore)
        );
        const alignedScoreByUserId = new Map(
          sortedPlayers.map((p, i) => [p.userId, factionScoreCells[i]])
        );
        const formatPlayerLine = (
          playerScore: (typeof sortedPlayers)[0],
          index: number
        ) => {
          const user = userMap.get(playerScore.userId);
          const display = resolvePlayerDisplay(user, {
            platform: leaguePlatform,
            unknownLabel: t.unknownUser,
          });
          const platformNameSlot = display.platformName ?? display.plainName;
          const scoreDisplay =
            alignedScoreByUserId.get(playerScore.userId) ??
            `\`${playerScore.rankingScore >= 0 ? "+" : ""}${playerScore.rankingScore.toFixed(1)}\``;

          const totalGames =
            playerScore.totalGamesPlayed ?? playerScore.gamesCounted;
          if (isBestConsecutive && totalGames > 0) {
            const fmtTrailing = (v?: number) =>
              v == null ? "—" : v >= 0 ? `\`+${v}\`` : `\`${v}\``;
            return formatString(
              t.factionRankingLineFormatConsecutive,
              (index + 1).toString(),
              display.mention,
              platformNameSlot,
              scoreDisplay,
              (windowSize - 1).toString(),
              fmtTrailing(playerScore.trailingNMinus1Score),
              (windowSize - 2).toString(),
              fmtTrailing(playerScore.trailingNMinus2Score)
            );
          }

          const gamesDisplay = totalGames.toString();
          return formatString(
            t.factionRankingLineFormat,
            (index + 1).toString(),
            display.mention,
            platformNameSlot,
            scoreDisplay,
            gamesDisplay
          );
        };

        // Sort factions by best player score descending
        const sortedFactions = Array.from(factionGroups.entries()).sort(
          (a, b) => {
            const bestA = a[1].players[0]?.rankingScore ?? -Infinity;
            const bestB = b[1].players[0]?.rankingScore ?? -Infinity;
            return bestB - bestA;
          }
        );

        const sections: string[] = [];
        for (const [, group] of sortedFactions) {
          const header = formatString(t.factionHeaderFormat, group.factionName);
          const lines = group.players.map((p, i) => formatPlayerLine(p, i));
          sections.push(`${header}\n${lines.join("\n")}`);
        }

        if (noFaction.length > 0) {
          const lines = noFaction.map((p, i) => formatPlayerLine(p, i));
          sections.push(lines.join("\n"));
        }

        rankingBody = sections.join("\n") || t.noGamesRecorded;
      } else {
        const users = await UserModel.find({
          _id: { $in: sortedPlayers.map((player) => player.userId) },
        }).lean<User[]>();
        const userMap = new Map(users.map((u) => [u._id.toString(), u]));
        const isBestConsecutiveNF = scoring?.type === "best-consecutive-window";
        const windowSizeNF =
          scoring?.type === "best-consecutive-window" ? scoring.windowSize : 0;
        const leaguePlatformNF = getLeaguePlatform(league);
        const playerScoreCells = formatAlignedScores(
          sortedPlayers.map((p) => p.rankingScore)
        );
        const rankingLines = sortedPlayers.map((playerScore, index) => {
          const user = userMap.get(playerScore.userId);
          const qualifierMarker = qualifiedByFaction.has(playerScore.userId)
            ? " [Q]"
            : "";
          const display = resolvePlayerDisplay(user, {
            platform: leaguePlatformNF,
            unknownLabel: t.unknownUser,
          });
          const displayName = `${display.line}${qualifierMarker}`;
          const scoreDisplay = playerScoreCells[index];

          const totalGamesNF =
            playerScore.totalGamesPlayed ?? playerScore.gamesCounted;
          if (isBestConsecutiveNF && totalGamesNF > 0) {
            const fmtTrailing = (v?: number) =>
              v == null ? "—" : v >= 0 ? `\`+${v}\`` : `\`${v}\``;
            return formatString(
              t.rankingLineFormatConsecutive,
              (index + 1).toString(),
              displayName,
              scoreDisplay,
              (windowSizeNF - 1).toString(),
              fmtTrailing(playerScore.trailingNMinus1Score),
              (windowSizeNF - 2).toString(),
              fmtTrailing(playerScore.trailingNMinus2Score)
            );
          }

          const gamesDisplay = totalGamesNF.toString();

          return formatString(
            t.rankingLineFormat,
            (index + 1).toString(),
            displayName,
            scoreDisplay,
            gamesDisplay
          );
        });
        rankingBody = rankingLines.join("\n") || t.noGamesRecorded;
      }

      const rankingTitle = formatString(
        hasFactions ? t.factionRankingTitleFormat : t.rankingTitleFormat,
        league.name
      );
      const lastUpdated = formatString(
        t.lastUpdatedFormat,
        `<t:${Math.floor(Date.now() / 1000)}:R>`
      );
      const statisticsLink = formatString(
        t.statisticsNote,
        getLeagueStatisticsUrl(league)
      );
      const message = `${lobbyStatusLine ? `${lobbyStatusLine}\n\n` : ""}${rankingTitle}\n\n${rankingBody}\n\n${lastUpdated}\n${statisticsLink}`;

      await this.upsertRankingMessage(league, message, "regular");
      return;
    }

    const teams = await TeamModel.find({
      leagueId: league._id,
    }).lean<Team[]>();
    const teamMap = new Map(teams.map((t) => [t._id.toString(), t]));

    const userToTeamMap = buildUserToTeamMap(teams);
    const { sortedTeams, userPendingScores } = computeTeamBasedRankingData(
      games.map((game) => ({
        startTime: game.startTime,
        results: (game.results ?? []).map((result) => ({
          userId: result.userId.toString(),
          score: result.score,
        })),
      })),
      league.rulesConfig.gameRules,
      userToTeamMap
    );

    // Build ranking message
    const teamScoreCells = formatAlignedScores(
      sortedTeams.map((entry) => entry.totalScore)
    );
    const rankingLines = sortedTeams.map((teamScore, index) => {
      const team = teamMap.get(teamScore.teamId);
      const displayName =
        team?.displayName || team?.simpleName || t.unknownTeam;
      const scoreDisplay = teamScoreCells[index];
      return formatString(
        t.rankingLineFormat,
        (index + 1).toString(),
        displayName,
        scoreDisplay,
        teamScore.gamesPlayed.toString()
      );
    });

    // Build pending scores section
    let pendingScoresSection = "";
    if (userPendingScores.size > 0) {
      const userIds = Array.from(userPendingScores.keys());
      const users = await UserModel.find({
        _id: { $in: userIds },
      }).lean<User[]>();
      const userMap = new Map(users.map((u) => [u._id.toString(), u]));

      const pendingLines: string[] = [];
      const pendingLeaguePlatform = getLeaguePlatform(league);
      for (const [userId, pending] of userPendingScores) {
        const user = userMap.get(userId);
        const team = teamMap.get(pending.teamId);
        const teamMention = team?.roleId
          ? `<@&${team.roleId}>`
          : team?.displayName || team?.simpleName || t.unknownTeam;
        const display = resolvePlayerDisplay(user, {
          platform: pendingLeaguePlatform,
          unknownLabel: t.unknownUser,
        });
        const platformNameSlot = display.platformName ?? display.plainName;
        const sortedScores = [...pending.scores].sort((a, b) => b - a);
        const scoresDisplay = sortedScores
          .map((s) => (s >= 0 ? `\`+${s}\`` : `\`${s}\``))
          .join(", ");
        pendingLines.push(
          formatString(
            t.pendingScoreLineFormat,
            display.mention,
            platformNameSlot,
            teamMention,
            scoresDisplay
          )
        );
      }

      if (pendingLines.length > 0) {
        pendingScoresSection = `\n\n${t.pendingScoresHeader}\n${pendingLines.join("\n")}`;
      }
    }

    const rankingTitle = formatString(t.rankingTitleFormat, league.name);
    const lastUpdated = formatString(
      t.lastUpdatedFormat,
      `<t:${Math.floor(Date.now() / 1000)}:R>`
    );
    const statisticsLink = formatString(
      t.statisticsNote,
      getLeagueStatisticsUrl(league)
    );
    const message = `${lobbyStatusLine ? `${lobbyStatusLine}\n\n` : ""}${rankingTitle}\n\n${rankingLines.join("\n") || t.noGamesRecorded}${pendingScoresSection}\n\n${lastUpdated}\n${statisticsLink}`;

    await this.upsertRankingMessage(league, message, "regular");
  }

  private async buildLobbyStatusLine(
    league: League,
    connector: ILeagueTournamentConnector
  ): Promise<string | undefined> {
    if (
      !connector.getTournamentLobbyStatus ||
      !league.platformConfig.tournamentId
    ) {
      return undefined;
    }
    const t = getLeagueText(league);
    try {
      const status = await connector.getTournamentLobbyStatus(
        league.platformConfig.tournamentId,
        { tenhouBotId: league.platformConfig.tenhouBotId ?? undefined }
      );
      if (!status) {
        return undefined;
      }
      if (status.online != null) {
        return formatString(
          t.lobbyStatusFormat,
          status.online.toString(),
          status.ready.toString(),
          status.inGame.toString()
        );
      }
      return formatString(
        t.lobbyStatusNoOnlineFormat,
        status.ready.toString(),
        status.inGame.toString()
      );
    } catch {
      return undefined;
    }
  }

  private async upsertRankingMessage(
    league: League,
    messageOrParts: string | string[],
    phaseKey: string
  ) {
    const channelId = league.discordConfig?.rankingChannel;
    if (!channelId) {
      return;
    }
    const parts = Array.isArray(messageOrParts)
      ? messageOrParts
      : [messageOrParts];

    const existing = await LeagueRankingMessageModel.find({
      league: league._id,
      phaseKey,
    })
      .sort({ partIndex: 1 })
      .exec();

    // Legacy: migrate any pre-multipart doc keyed by phaseKey=null.
    if (existing.length === 0) {
      const legacy = await LeagueRankingMessageModel.findOne({
        league: league._id,
        phaseKey: null,
      }).exec();
      if (legacy) {
        await LeagueRankingMessageModel.updateOne(
          { _id: legacy._id },
          { phaseKey, partIndex: 0 }
        );
        legacy.phaseKey = phaseKey;
        legacy.partIndex = 0;
        existing.push(legacy);
      }
    }

    const existingByPart = new Map<number, (typeof existing)[number]>();
    for (const e of existing) {
      existingByPart.set(e.partIndex ?? 0, e);
    }

    // Walk parts in index order. Discord orders messages by creation time and
    // offers no reposition API, so a recreated message always lands at the
    // bottom of the channel (newest snowflake). To keep the multi-part ranking
    // displayed in partIndex order we edit each part in place while the stored
    // messages are still present and chronologically ascending. The moment a
    // part is missing, fails to edit, or is found out of order relative to an
    // earlier part, we switch to rebuilding: that part and every subsequent one
    // are deleted and re-sent in order so their creation times match their
    // index order. This both fixes a broken render and self-heals an already
    // out-of-order one on the next update.
    let rebuilding = false;
    let prevMessageId: bigint | null = null;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const existingPart = existingByPart.get(i);

      if (!rebuilding && existingPart) {
        const storedId = toSnowflake(existingPart.messageId);
        const outOfOrder =
          prevMessageId !== null &&
          storedId !== null &&
          storedId <= prevMessageId;

        if (outOfOrder) {
          console.log(
            `Ranking message part ${i} is out of order; recreating it and all following parts`
          );
        } else {
          const discordMsg = await fetchChannelMessage(
            channelId,
            existingPart.messageId
          );
          if (discordMsg) {
            const newHash = rankingPartHash(part);
            if (
              existingPart.contentHash &&
              existingPart.contentHash === newHash
            ) {
              // Nothing meaningful changed since the last render (only the
              // relative "last updated" timestamp would differ), so skip the
              // Discord edit to avoid needless API writes and timestamp churn.
              prevMessageId = storedId ?? prevMessageId;
              continue;
            }
            try {
              await editChannelMessage(channelId, existingPart.messageId, part);
              await LeagueRankingMessageModel.updateOne(
                { _id: existingPart._id },
                {
                  lastUpdatedAt: new Date(),
                  phaseKey,
                  partIndex: i,
                  contentHash: newHash,
                }
              );
              prevMessageId = storedId ?? prevMessageId;
              continue;
            } catch (err) {
              console.log(
                `Could not edit existing ranking message part ${i}, recreating it and all following parts`,
                err
              );
            }
          }
        }

        // This part can no longer be edited in place. Rebuild it and, because
        // any re-sent message jumps to the bottom, every later part too.
        rebuilding = true;
      }

      if (existingPart) {
        // Delete the stale message bound to this slot so we don't leak it,
        // then re-send fresh content at the bottom of the channel.
        try {
          await deleteChannelMessage(channelId, existingPart.messageId);
        } catch (deleteErr) {
          console.log(
            `Could not delete old ranking message ${existingPart.messageId}`,
            deleteErr
          );
        }
        const newMsg = await sendChannelMessage(channelId, part);
        await LeagueRankingMessageModel.updateOne(
          { _id: existingPart._id },
          {
            messageId: newMsg.id,
            lastUpdatedAt: new Date(),
            phaseKey,
            partIndex: i,
            contentHash: rankingPartHash(part),
          }
        );
        prevMessageId = toSnowflake(newMsg.id);
      } else {
        const newMsg = await sendChannelMessage(channelId, part);
        await LeagueRankingMessageModel.create({
          messageId: newMsg.id,
          league: league._id,
          phaseKey,
          partIndex: i,
          lastUpdatedAt: new Date(),
          contentHash: rankingPartHash(part),
        });
        prevMessageId = toSnowflake(newMsg.id);
      }

      // Once anything has been (re-)sent, all following parts must follow it in
      // creation order, so keep rebuilding for the rest of the loop.
      rebuilding = true;
    }

    // Drop stale parts that no longer exist in the new render.
    for (const [partIndex, doc] of existingByPart.entries()) {
      if (partIndex >= parts.length) {
        try {
          await deleteChannelMessage(channelId, doc.messageId);
        } catch (deleteErr) {
          console.log(
            `Could not delete stale ranking part ${partIndex} (msg=${doc.messageId})`,
            deleteErr
          );
        }
        await LeagueRankingMessageModel.deleteOne({ _id: doc._id });
      }
    }
  }

  private async updateMultiPhaseRankingMessage(
    league: League,
    leagueType: LeagueTypeConfig,
    lobbyStatusLine?: string
  ) {
    await connectToDatabase();

    const t = getLeagueText(league);

    const cutoffs = resolveMultiPhaseCutoffs(leagueType, league);
    const phaseIndex = resolveCurrentPhaseIndex(leagueType, league);
    const phases = leagueType.regularPhases!;
    const currentPhaseDef = phases[phaseIndex];

    const games = await GameModel.find({
      league: league._id,
      isValid: true,
    }).lean<Game[]>();

    const teams = await TeamModel.find({
      leagueId: league._id,
    }).lean<Team[]>();
    const teamMap = new Map(teams.map((t) => [t._id.toString(), t]));

    const result = computeMultiPhaseStandings(
      leagueType,
      games.map((game) => ({
        startTime: game.startTime,
        phaseId: game.phaseId,
        results: (game.results ?? []).map((r) => ({
          userId: r.userId.toString(),
          score: r.score,
        })),
      })),
      league.rulesConfig.gameRules,
      teams,
      cutoffs,
      phaseIndex
    );

    const phaseLabel = currentPhaseDef.id
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const standingScoreCells = formatAlignedScores(
      result.standings.map((entry) => entry.totalScore)
    );
    const rankingLines = result.standings.map((standing, index) => {
      const team = teamMap.get(standing.teamId);
      const displayName =
        team?.displayName || team?.simpleName || t.unknownTeam;
      const scoreDisplay = standingScoreCells[index];
      return formatString(
        t.rankingLineFormat,
        (index + 1).toString(),
        displayName,
        scoreDisplay,
        standing.gamesPlayed.toString()
      );
    });

    const rankingTitle = formatString(
      t.rankingTitleFormat,
      `${league.name} — ${phaseLabel}`
    );
    const lastUpdated = formatString(
      t.lastUpdatedFormat,
      `<t:${Math.floor(Date.now() / 1000)}:R>`
    );
    const statisticsLink = formatString(
      t.statisticsNote,
      getLeagueStatisticsUrl(league)
    );
    const message = `${lobbyStatusLine ? `${lobbyStatusLine}\n\n` : ""}${rankingTitle}\n\n${rankingLines.join("\n") || t.noGamesRecorded}\n\n${lastUpdated}\n${statisticsLink}`;

    await this.upsertRankingMessage(
      league,
      message,
      `regular:${currentPhaseDef.id}`
    );
  }

  /**
   * Builds bracket seedings for a finals-only tournament by assigning seeds
   * to participants (teams or league users) in their natural creation order.
   */
  private async computeFinalsOnlySeedings(
    league: League,
    leagueType: LeagueTypeConfig,
    maxSeed: number
  ): Promise<{ seed: number; teamId?: string; userId?: string }[]> {
    if (leagueType.isTeamMode) {
      const teams = await TeamModel.find({ leagueId: league._id })
        .sort({ _id: 1 })
        .select("_id")
        .lean<Pick<Team, "_id">[]>();
      const count = Math.min(maxSeed, teams.length);
      const seedings: { seed: number; teamId: string }[] = [];
      for (let i = 0; i < count; i++) {
        seedings.push({ seed: i + 1, teamId: teams[i]._id.toString() });
      }
      return seedings;
    }
    const leagueUsers = await LeagueUserModel.find({ leagueId: league._id })
      .sort({ _id: 1 })
      .select("userId")
      .lean<{ userId: { toString(): string } }[]>();
    const count = Math.min(maxSeed, leagueUsers.length);
    const seedings: { seed: number; userId: string }[] = [];
    for (let i = 0; i < count; i++) {
      seedings.push({ seed: i + 1, userId: leagueUsers[i].userId.toString() });
    }
    return seedings;
  }

  /**
   * Computes and persists bracket seedings from the regular-phase standings
   * exactly once, when the final phase starts and no Bracket document exists yet.
   */
  public async ensureBracketSeedings(
    league: League,
    leagueType: LeagueTypeConfig
  ) {
    if (!leagueType.finalPhase) {
      return;
    }

    await connectToDatabase();

    const existing = await BracketModel.findOne({ league: league._id })
      .select("_id")
      .lean();
    if (existing) {
      return;
    }

    // Determine how many seeds are needed from the final phase stage definitions
    const maxSeed = Math.max(
      ...leagueType.finalPhase.stages.flatMap((s) => s.seeds)
    );

    // Finals-only tournaments (no regular phase configured) cannot derive
    // seedings from ranking data — assign seeds in natural creation order
    // of the participants registered to the league.
    if (!leagueType.regularPhase && !leagueType.regularPhases) {
      const seedings = await this.computeFinalsOnlySeedings(
        league,
        leagueType,
        maxSeed
      );
      if (seedings.length === 0) {
        console.log(
          `Cannot compute bracket seedings for ${league.name}: no participants registered`
        );
        return;
      }
      await BracketModel.create({
        league: league._id,
        seedings,
      });
      console.log(
        `Auto-seeded finals-only bracket for ${league.name}: ${seedings.length} participants (natural order)`
      );
      return;
    }

    const finalsCutoff = resolveFinalPhaseGameCutoff(leagueType, league);
    if (!finalsCutoff) {
      console.log(
        `Cannot compute bracket seedings for ${league.name}: no finals cutoff date`
      );
      return;
    }

    const regularPhaseGames = await GameModel.find({
      league: league._id,
      isValid: true,
      ...(buildRegularGameMatch(leagueType, league) ?? {
        startTime: { $lt: finalsCutoff },
      }),
    }).lean<Game[]>();

    if (regularPhaseGames.length === 0) {
      console.log(
        `Cannot compute bracket seedings for ${league.name}: no regular phase games`
      );
      return;
    }

    const teams = await TeamModel.find({
      leagueId: league._id,
    }).lean<Team[]>();
    const userToTeamMap = buildUserToTeamMap(teams);

    const regularRankingInput = regularPhaseGames.map((g) => ({
      startTime: g.startTime,
      results: (g.results ?? []).map((r) => ({
        userId: r.userId.toString(),
        score: r.score,
      })),
    }));

    const isTeamMode = leagueType.isTeamMode;

    // Minimum-games gate for finals qualification. The finals follow the last
    // regular phase, so a multi-phase league uses that final phase's threshold.
    const lastRegularPhase =
      leagueType.regularPhase ??
      leagueType.regularPhases?.[leagueType.regularPhases.length - 1];
    const regularMinGames = lastRegularPhase?.minGames ?? 0;

    const seedings: { seed: number; teamId?: string; userId?: string }[] = [];

    if (isTeamMode) {
      // Seed from the minimum-games-aware phase results. For multi-phase
      // leagues that is the final phase's standings (which already apply
      // per-phase gating and cross-phase narrowing); for a single regular
      // phase it is a straight ranking of that phase's games.
      let sortedForSeeding: { teamId: string; gamesPlayed: number }[];
      if (isMultiPhaseLeague(leagueType)) {
        const { standings } = computeMultiPhaseStandings(
          leagueType,
          regularPhaseGames.map((g) => ({
            startTime: g.startTime,
            phaseId: g.phaseId,
            results: (g.results ?? []).map((r) => ({
              userId: r.userId.toString(),
              score: r.score,
            })),
          })),
          league.rulesConfig.gameRules,
          teams,
          resolveMultiPhaseCutoffs(leagueType, league)
        );
        sortedForSeeding = standings;
      } else {
        const { sortedTeams } = computeTeamBasedRankingData(
          regularRankingInput,
          league.rulesConfig.gameRules,
          userToTeamMap
        );
        sortedForSeeding = sortedTeams;
      }
      const eligibleTeams =
        regularMinGames > 0
          ? sortedForSeeding.filter((t) => t.gamesPlayed >= regularMinGames)
          : sortedForSeeding;
      for (let i = 0; i < Math.min(maxSeed, eligibleTeams.length); i++) {
        seedings.push({ seed: i + 1, teamId: eligibleTeams[i].teamId });
      }
    } else {
      const scoring = leagueType.regularPhase?.scoring;
      const { sortedPlayers, qualifiedByFaction } = computeNonTeamRankingData(
        regularRankingInput,
        league.rulesConfig.gameRules,
        scoring,
        userToTeamMap,
        regularMinGames
      );

      const useFactionGroupedSeeding =
        scoring?.type === "best-consecutive-window" &&
        scoring.qualificationMode === "faction-top-n" &&
        qualifiedByFaction.size > 0;

      const effectivePlayers = useFactionGroupedSeeding
        ? includeMissingFactionMembers(sortedPlayers, teams)
        : sortedPlayers;

      const effectiveQualifiedByFaction = useFactionGroupedSeeding
        ? computeFactionQualifiedUsers(
            effectivePlayers,
            scoring.qualificationCount ?? 2,
            regularMinGames
          )
        : qualifiedByFaction;

      const orderedPlayers = useFactionGroupedSeeding
        ? buildFactionGroupedSeedOrder(
            effectivePlayers,
            effectiveQualifiedByFaction
          )
        : effectivePlayers;

      // Players below the minimum-games gate are never seeded (they remain in
      // the standings for display only). Restrict both the plain top-N slice
      // and the backfill pool to eligible players.
      const eligiblePlayers =
        regularMinGames > 0
          ? effectivePlayers.filter(
              (p) => (p.totalGamesPlayed ?? 0) >= regularMinGames
            )
          : effectivePlayers;

      const selectedPlayers = useFactionGroupedSeeding
        ? orderedPlayers
        : eligiblePlayers.slice(0, Math.min(maxSeed, eligiblePlayers.length));

      const seenUserIds = new Set(selectedPlayers.map((p) => p.userId));
      if (selectedPlayers.length < Math.min(maxSeed, eligiblePlayers.length)) {
        for (const player of eligiblePlayers) {
          if (seenUserIds.has(player.userId)) {
            continue;
          }
          selectedPlayers.push(player);
          seenUserIds.add(player.userId);
          if (selectedPlayers.length >= maxSeed) {
            break;
          }
        }
      }

      for (let i = 0; i < Math.min(maxSeed, selectedPlayers.length); i++) {
        seedings.push({ seed: i + 1, userId: selectedPlayers[i].userId });
      }
    }

    if (seedings.length === 0) {
      console.log(
        `Cannot compute bracket seedings for ${league.name}: no ranked participants`
      );
      return;
    }

    await BracketModel.create({
      league: league._id,
      seedings,
    });

    console.log(
      `Auto-seeded bracket for ${league.name}: ${seedings.length} participants`
    );
  }

  private async updateBracketMessage(league: League, lobbyStatusLine?: string) {
    if (!league.discordConfig?.rankingChannel) {
      return;
    }

    const t = getLeagueText(league);
    const ts = getLeagueStatisticsText(league);

    const leagueType = resolveLeagueTypeConfig(league.leagueTypeConfig);
    const configuredStages = resolveConfiguredBracketStages(
      league.leagueTypeConfig
    );
    if (!configuredStages) {
      console.log(`No bracket stages configured for league ${league.name}`);

      const lastUpdated = formatString(
        t.lastUpdatedFormat,
        `<t:${Math.floor(Date.now() / 1000)}:R>`
      );
      const unsupportedFormatMessage = formatString(
        t.bracketUnsupportedFormat,
        "unknown"
      );
      const message = `${lobbyStatusLine ? `${lobbyStatusLine}\n\n` : ""}🏆 ${league.name}\n\n${unsupportedFormatMessage}\n\n${lastUpdated}`;
      await this.upsertRankingMessage(
        league,
        message,
        `final:${leagueType?.finalPhase?.id ?? "finals"}`
      );
      return;
    }

    await connectToDatabase();

    const bracket = await BracketModel.findOne({
      league: league._id,
    }).lean<Bracket | null>();
    if (!bracket || bracket.seedings.length === 0) {
      console.log(
        `No bracket found for final phase league ${league.name} (leagueId: ${league._id})`
      );
      return;
    }

    const isTeamMode = leagueType?.isTeamMode !== false;

    const seedings = new Map<number, string>();
    for (const s of bracket.seedings) {
      seedings.set(s.seed, getSeedingParticipantId(s, isTeamMode).toString());
    }

    const finalsCutoff = resolveFinalPhaseGameCutoff(leagueType, league);
    const gamesQuery: Record<string, unknown> = {
      league: league._id,
      isValid: true,
    };
    const finalsMatch = buildFinalsGameMatch(leagueType, league);
    if (finalsMatch) {
      Object.assign(gamesQuery, finalsMatch);
    }
    const games = await GameModel.find(gamesQuery).lean<Game[]>();

    const bracketGames = games.map((g) => ({
      results: (g.results ?? []).map((r) => ({
        userId: r.userId.toString(),
        score: r.score,
      })),
    }));

    const teamNameMap = new Map<string, string>();
    const userToTeamMap = new Map<string, string>();
    const participantToFactionMap = new Map<string, string>();
    if (!leagueType?.isTeamMode) {
      const teams = await TeamModel.find({
        leagueId: league._id,
      }).lean<Team[]>();
      for (const team of teams) {
        const factionId = team._id.toString();
        for (const memberId of team.roster.members ?? []) {
          participantToFactionMap.set(memberId.toString(), factionId);
        }
        for (const subId of team.roster.substitutes ?? []) {
          participantToFactionMap.set(subId.toString(), factionId);
        }
      }

      const participantIds = new Set<string>();
      for (const seededId of seedings.values()) {
        participantIds.add(seededId);
      }
      for (const game of bracketGames) {
        for (const result of game.results) {
          participantIds.add(result.userId);
        }
      }

      const users = await UserModel.find({
        _id: { $in: Array.from(participantIds) },
      }).lean<User[]>();
      const bracketPlatform = getLeaguePlatform(league);
      for (const user of users) {
        const userId = user._id.toString();
        // Bracket ASCII intentionally uses the plain name (no platform
        // suffix) to keep columns compact; the platform context is still
        // passed through for parity with other Discord paths.
        const display = resolvePlayerDisplay(user, {
          platform: bracketPlatform,
          unknownLabel: t.unknownUser,
        });
        teamNameMap.set(userId, display.plainName);
        userToTeamMap.set(userId, userId);
      }
    } else {
      const teams = await TeamModel.find({
        leagueId: league._id,
      }).lean<Team[]>();
      for (const team of teams) {
        teamNameMap.set(
          team._id.toString(),
          team.displayName || team.simpleName
        );
        for (const memberId of team.roster.members) {
          userToTeamMap.set(memberId.toString(), team._id.toString());
          participantToFactionMap.set(memberId.toString(), team._id.toString());
        }
        for (const subId of team.roster.substitutes ?? []) {
          userToTeamMap.set(subId.toString(), team._id.toString());
          participantToFactionMap.set(subId.toString(), team._id.toString());
        }
      }
    }

    const resolvedSeedings = seedings;

    let initialScoreOffsets: Map<string, number> | undefined;
    if (
      leagueType?.finalPhase?.scoreCarryOver &&
      leagueType.finalPhase.scoreCarryOver.num > 0 &&
      finalsCutoff
    ) {
      const regularPhaseGames = await GameModel.find({
        league: league._id,
        isValid: true,
        ...(buildRegularGameMatch(leagueType, league) ?? {
          startTime: { $lt: finalsCutoff },
        }),
      }).lean<Game[]>();

      const regularRankingInput = regularPhaseGames.map((g) => ({
        startTime: g.startTime,
        results: (g.results ?? []).map((r) => ({
          userId: r.userId.toString(),
          score: r.score,
        })),
      }));

      const regularPhaseScores = new Map<string, number>();
      if (!leagueType.isTeamMode) {
        const { sortedPlayers } = computeNonTeamRankingData(
          regularRankingInput,
          league.rulesConfig.gameRules,
          leagueType.regularPhase?.scoring,
          userToTeamMap
        );
        for (const player of sortedPlayers) {
          regularPhaseScores.set(player.userId, player.rankingScore);
        }
      } else {
        const { sortedTeams } = computeTeamBasedRankingData(
          regularRankingInput,
          league.rulesConfig.gameRules,
          userToTeamMap
        );
        for (const team of sortedTeams) {
          regularPhaseScores.set(team.teamId, team.totalScore);
        }
      }

      initialScoreOffsets = computeScoreCarryOverOffsets(
        leagueType,
        regularPhaseScores
      );
    }

    const ctx: BracketContext = {
      seedings: resolvedSeedings,
      userToTeamMap,
      teamNameMap,
      games: bracketGames,
      initialScoreOffsets,
      rules: league.rulesConfig.gameRules,
      deltaComputer: leagueType
        ? resolveFinalDeltaComputer(leagueType, league.rulesConfig.gameRules)
        : undefined,
      officialSubIds: new Set(
        (league.officialSubstitutes ?? []).map((id) => id.toString())
      ),
      officialSubTeamMap: await buildOfficialSubstituteTeamMap(league._id),
    };

    const stages = computeBracket(configuredStages, ctx);
    const bracketParts = renderBracketAsciiParts(
      league.name,
      stages,
      resolvedSeedings,
      teamNameMap,
      {
        stageLabels: ts.bracketPhaseLabels,
        advancementLabels: ts.bracketAdvancementLabels,
        tbdLabel: t.bracketTbd,
        seedLabel: t.bracketSeedLabel,
      }
    );

    const lastUpdated = formatString(
      t.lastUpdatedFormat,
      `<t:${Math.floor(Date.now() / 1000)}:R>`
    );

    const leagueSlug = league.name.trim().toLowerCase().replace(/\s+/g, "-");
    const statisticsLink = formatString(
      t.statisticsNote,
      getLeagueStatisticsUrl(league, leagueSlug)
    );

    if (bracketParts.length === 0) {
      bracketParts.push("");
    }
    if (lobbyStatusLine) {
      bracketParts[0] = `${lobbyStatusLine}\n\n${bracketParts[0]}`;
    }
    for (let i = 0; i < bracketParts.length; i++) {
      bracketParts[i] += `\n${lastUpdated}\n${statisticsLink}`;
    }

    await this.upsertRankingMessage(
      league,
      bracketParts,
      `final:${leagueType?.finalPhase?.id ?? "finals"}`
    );
  }

  private async publishNewGames(league: League) {
    if (!league.discordConfig?.resultChannel) {
      return;
    }

    await connectToDatabase();

    const t = getLeagueText(league);

    const unpublishedGames = await GameModel.find({
      league: league._id,
      isPublished: { $ne: true },
    }).lean<Game[]>();

    const teams = await TeamModel.find({
      leagueId: league._id,
    }).lean<Team[]>();

    for (const game of unpublishedGames) {
      const userIds = (game.results ?? []).map((r) => r.userId);
      const users = await UserModel.find({
        _id: { $in: userIds },
      }).lean<User[]>();
      const userMap = new Map(users.map((u) => [u._id.toString(), u]));

      const userToTeamMap = new Map<string, Team>();
      for (const team of teams) {
        for (const memberId of team.roster.members) {
          userToTeamMap.set(memberId.toString(), team);
        }
        for (const subId of team.roster.substitutes ?? []) {
          userToTeamMap.set(subId.toString(), team);
        }
      }

      // Build set of official substitute IDs
      const officialSubIds = new Set(
        (league.officialSubstitutes ?? []).map((id: any) => id.toString())
      );

      // Build set of team substitute IDs (players rostered as substitutes
      // on their team, not as regular members). Used to flag team-sub
      // appearances in the published game-result message.
      const teamSubIds = new Set<string>();
      if (league.rulesConfig.isTeamMode) {
        const teamMemberIds = new Set<string>();
        for (const team of teams) {
          for (const memberId of team.roster.members) {
            teamMemberIds.add(memberId.toString());
          }
        }
        for (const team of teams) {
          for (const subId of team.roster.substitutes ?? []) {
            const id = subId.toString();
            if (!teamMemberIds.has(id)) {
              teamSubIds.add(id);
            }
          }
        }
      }

      const publishPlatform = getLeaguePlatform(league);

      // Find players not in teams (only relevant for team-mode leagues)
      const playersNotInTeam: { discordMention: string; nickname: string }[] =
        [];
      if (league.rulesConfig.isTeamMode) {
        for (const result of game.results ?? []) {
          const user = userMap.get(result.userId.toString());
          const isInTeam = userToTeamMap.has(result.userId.toString());
          const isOfficialSub = officialSubIds.has(result.userId.toString());
          if (!isInTeam && !isOfficialSub) {
            const display = resolvePlayerDisplay(user, {
              platform: publishPlatform,
            });
            playersNotInTeam.push({
              discordMention: display.mention,
              nickname: display.platformName ?? display.plainName,
            });
          }
        }
      }

      // Build scores display
      const sortedResults = [...(game.results ?? [])].sort(
        (a, b) => b.score - a.score
      );
      const deltas = computePlayerDeltas(
        sortedResults,
        league.rulesConfig.gameRules
      );

      // Monospace alignment columns (rendered inside inline code):
      //  - points are left-aligned (padEnd) so their first digit lines up
      //  - delta scores are decimal-aligned (the integer part is left-padded)
      //    so their decimal points line up
      // Everything before the team/player name is then fixed width, so the
      // names start at the same column regardless of score magnitude.
      const pointStrings = sortedResults.map((r) => String(r.score));
      const maxPointWidth = pointStrings.reduce(
        (max, s) => Math.max(max, s.length),
        0
      );
      const deltaStrings = deltas.map(
        (d) => `${d > 0 ? "+" : ""}${d.toFixed(1)}`
      );
      const maxDeltaIntWidth = deltaStrings.reduce(
        (max, s) => Math.max(max, s.indexOf(".")),
        0
      );

      const scores = sortedResults
        .map((r, idx) => {
          const user = userMap.get(r.userId.toString());
          const team = userToTeamMap.get(r.userId.toString());
          // Prefer the team's Discord role mention; fall back to its name.
          const teamMention = team
            ? team.roleId
              ? `<@&${team.roleId}>`
              : team.displayName || team.simpleName || ""
            : "";
          const display = resolvePlayerDisplay(user, {
            platform: publishPlatform,
          });
          const rank = r.place && r.place > 0 ? r.place : idx + 1;

          const paddedPoints = pointStrings[idx].padEnd(maxPointWidth);
          const deltaStr = deltaStrings[idx];
          const dot = deltaStr.indexOf(".");
          const paddedDelta = `${deltaStr.slice(0, dot).padStart(maxDeltaIntWidth)}${deltaStr.slice(dot)}`;

          const teamLabel = teamMention ? `${teamMention} ` : "";
          const platformLabel =
            display.platformName && display.platformName !== display.plainName
              ? ` (*${display.platformName}*)`
              : "";
          const officialSubIndicator = officialSubIds.has(r.userId.toString())
            ? " 🆘"
            : teamSubIds.has(r.userId.toString())
              ? " 👥"
              : "";
          return `${rank}: \`${paddedPoints}\`→\`${paddedDelta}\` ${teamLabel}${display.mention}${platformLabel}${officialSubIndicator}`;
        })
        .join("\n");

      const startTime = game.startTime
        ? new Date(game.startTime).toLocaleString()
        : t.unknownTime;
      const endTime = game.endTime
        ? new Date(game.endTime).toLocaleString()
        : t.unknownTime;

      const sb: string[] = [];
      const gameLink = game.log
        ? `${t.gameLinkLabel}  ${game.log}`
        : `${t.gameIdLabel}  \`${game.gameId}\``;
      if (game.isValid) {
        sb.push(formatString(t.newGameRecordedFormat, league.name));
        sb.push(`${scores || t.scoresNotAvailable}`);
        sb.push(
          `${t.startTimeLabel} ${startTime}\n${t.endTimeLabel} ${endTime}`
        );
        sb.push(gameLink);
      } else {
        sb.push(formatString(t.invalidGameDetectedFormat, league.name));
        sb.push(t.playersNotInTeam);
        sb.push(
          playersNotInTeam
            .map((p) => `- ${p.discordMention} (${p.nickname})`)
            .join("\n")
        );
        sb.push(`${scores || t.scoresNotAvailable}`);
        sb.push(gameLink);
      }

      await sendChannelMessage(
        league.discordConfig?.resultChannel,
        sb.join("\n\n")
      );

      await GameModel.updateOne(
        { _id: game._id },
        { isPublished: true }
      ).exec();

      console.log(`Game ${game.gameId} published for league ${league.name}`);
    }
  }
}
