import { GameModel, type Game, type GameResult } from "~/db/Game";
import { GameRecordModel } from "~/db/GameRecord";
import { ReplayLogModel } from "~/db/models/ReplayLog";
import { REPLAY_LOG_SCHEMA_VERSION } from "~/game/replay/types";
import { TeamModel } from "~/db/Team";
import { UserModel } from "~/db/User";
import type { League } from "~/db/League";
import { computePlayerDeltas } from "~/services/leagueUtils";
import type { ILeagueTournamentConnector } from "~/services/connectors/ILeagueTournamentConnector.server";
import type { UsersRounds } from "~/api/majsoul/types/gameRecordData";
import type { GameSummary } from "~/types/GameSummary";
import { sendChannelMessage } from "~/services/discordPublisher.server";
import {
  getLeaguePlatform,
  resolvePlayerDisplay,
} from "~/services/playerDisplay.server";
import { trackEvent } from "~/services/telemetry.server";
import { emitLeagueUpdated } from "~/services/cacheInvalidation.server";
import { linkPlayedGamesToTables } from "~/services/schedulingLink.server";

/**
 * Returns the effective roster for a team given the current phase.
 * During the finals phase, prefers `finalsRoster` when available.
 */
function getEffectiveRoster(
  team: {
    roster: { members: any[]; substitutes?: any[] | null };
    finalsRoster?: { members: any[]; substitutes?: any[] | null } | null;
  },
  useFinalsRoster: boolean
) {
  if (useFinalsRoster && team.finalsRoster) {
    return team.finalsRoster;
  }
  return team.roster;
}

/**
 * Returns true when the given game time falls in the finals phase
 * (at or after the first phaseCutoffTime).
 */
function isInFinalsPhase(
  gameTime: Date | null | undefined,
  league: { phaseCutoffTimes?: Date[] | null }
): boolean {
  if (!gameTime || new Date(gameTime).getTime() <= 0) {
    return false;
  }
  const cutoff = league.phaseCutoffTimes?.[0];
  if (!cutoff) {
    return false;
  }
  return new Date(gameTime) >= new Date(cutoff);
}

/**
 * Platform-agnostic league game hydration.
 *
 * Given a League and its matching ILeagueTournamentConnector:
 *   1. Fetches game summaries and upserts Game documents.
 *   2. For each Game without a linked GameRecord, fetches the full log,
 *      enriches per-user data with DB ids / deltas, and saves the GameRecord.
 */
export async function hydrateLeagueGames(
  league: League,
  connector: ILeagueTournamentConnector
): Promise<void> {
  if (!league.platformConfig.tournamentId) {
    console.warn(
      `hydrateLeagueGames: league ${league.name} has no tournamentId`
    );
    return;
  }

  const options = await connector.resolveOptions?.(league);

  let hasNewData = false;

  // --- Step 1: discover new games from the platform -------------------------
  // Build the set of known game IDs (fully processed) so the connector
  // doesn't re-fetch their logs.
  const fullyProcessedGames = await GameModel.find({
    league: league._id,
    gameRecord: { $ne: null },
  })
    .select("gameId")
    .lean();
  const knownGameIds = new Set(
    fullyProcessedGames.map((g) => g.gameId).filter(Boolean) as string[]
  );
  // Also include games that already exist in the DB (even without records)
  // so getGameSummaries doesn't return duplicates.
  const existingGames = await GameModel.find({
    league: league._id,
    gameRecord: null,
  })
    .select("gameId")
    .lean();
  for (const g of existingGames) {
    if (g.gameId) {
      knownGameIds.add(g.gameId);
    }
  }

  // fetchSince is no longer used — the listing pagination is fast (no
  // per-game API calls) and knownGameIds already prevents re-processing.
  // Using fetchSince caused games older than the newest known game to be
  // permanently skipped during initial ingestion or after a wipe.

  const summaries = await connector.getGameSummaries(
    league.platformConfig.tournamentId,
    {
      ...options,
      knownGameIds,
    }
  );

  console.log(
    `[${league.name}] Hydration: ${summaries.length} new from platform, ${knownGameIds.size} known`
  );

  for (const summary of summaries) {
    // Filter by league time window (skip for summaries with epoch-0 time —
    // real timestamps will be checked after getGameRecord fills them in).
    const hasRealTime = summary.startTime.getTime() > 0;
    if (hasRealTime) {
      if (summary.startTime < league.startTime) {
        continue;
      }
      if (league.endTime && summary.startTime >= league.endTime) {
        continue;
      }
    }

    await backfillPlatformIdentityNames(summary.players, summary.platform);

    let savedGame = await GameModel.findOne({
      gameId: summary.gameId,
      league: league._id,
    }).exec();

    if (!savedGame) {
      // Resolve DB users for each player
      const playerInfos = await Promise.all(
        summary.players.map(async (p) => {
          const user = await resolveUser(p.platformUserId, summary.platform);
          return {
            ...p,
            user,
            dbUserId: user?._id ?? null,
          };
        })
      );

      const allPlayersInDb = playerInfos.every((p) => p.user);

      let isValid = false;
      if (allPlayersInDb) {
        if (!league.rulesConfig.isTeamMode) {
          // Non-team league: no check during regular phase.
          // During finals, only allow qualified players or official subs.
          const useFinalsPhase = isInFinalsPhase(summary.startTime, league);
          if (useFinalsPhase) {
            const officialSubIds = new Set(
              (league.officialSubstitutes ?? []).map((id: any) => id.toString())
            );

            // Qualified = has at least one valid game before the finals cutoff
            const cutoff = league.phaseCutoffTimes?.[0];
            const qualifiedGames = await GameModel.find({
              league: league._id,
              isValid: true,
              startTime: { $lt: cutoff },
            })
              .select("results.userId")
              .lean<{ results: { userId: any }[] }[]>();

            const qualifiedPlayerIds = new Set<string>();
            for (const g of qualifiedGames) {
              for (const r of g.results ?? []) {
                qualifiedPlayerIds.add(r.userId.toString());
              }
            }

            const unqualifiedPlayers = playerInfos.filter(
              (p) =>
                !officialSubIds.has(p.dbUserId?.toString() ?? "") &&
                !qualifiedPlayerIds.has(p.dbUserId?.toString() ?? "")
            );
            isValid = unqualifiedPlayers.length === 0;
          } else {
            isValid = true;
          }
        } else {
          const dbUserIds = playerInfos.map((p) => p.dbUserId);

          // Official substitutes are valid regardless of team membership
          const officialSubIds = new Set(
            (league.officialSubstitutes ?? []).map((id: any) => id.toString())
          );

          const teamsInLeague = await TeamModel.find({
            leagueId: league._id,
            $or: [
              { "roster.members": { $in: dbUserIds } },
              { "roster.substitutes": { $in: dbUserIds } },
              { "finalsRoster.members": { $in: dbUserIds } },
              { "finalsRoster.substitutes": { $in: dbUserIds } },
            ],
          }).exec();

          const useFinalsPhase = isInFinalsPhase(summary.startTime, league);

          const playersNotInTeam = playerInfos.filter(
            (p) =>
              !officialSubIds.has(p.dbUserId?.toString() ?? "") &&
              !teamsInLeague.some((team) => {
                const roster = getEffectiveRoster(team, useFinalsPhase);
                return (
                  roster.members.some(
                    (m: any) => m.toString() === p.dbUserId?.toString()
                  ) ||
                  (roster.substitutes ?? []).some(
                    (s: any) => s.toString() === p.dbUserId?.toString()
                  )
                );
              })
          );
          isValid = playersNotInTeam.length === 0;
        }
      }

      const results = playerInfos
        .filter((p) => p.dbUserId)
        .map((p) => ({
          userId: p.dbUserId,
          score: p.score,
          place: p.place,
          nbChombo: 0,
        }));

      savedGame = await GameModel.create({
        gameId: summary.gameId,
        name: `${league.name} - ${summary.gameId}`,
        platform: summary.platform,
        rules: league.rulesConfig.gameRules,
        context: league.name,
        startTime: summary.startTime,
        endTime: summary.endTime,
        isValid,
        isPublished: false,
        results,
        log: summary.log,
        league: league._id,
      });

      hasNewData = true;
      console.log(`Game ${summary.gameId} saved for league ${league.name}`);
    }
  }

  // Invalidate caches now so the UI reflects newly discovered games
  // immediately, rather than waiting for all hydrations to finish.
  if (hasNewData) {
    emitLeagueUpdated(league._id.toString());
  }

  // --- Step 3: hydrate Game documents that still lack a GameRecord ----------
  // This includes games just created above AND leftover unprocessed games.
  // Each call does one getLog() round-trip.
  const gamesToHydrate = await GameModel.find({
    league: league._id,
    gameRecord: null,
    blockGameRecord: { $ne: true },
  }).lean<Game[]>();

  let hydratedCount = 0;
  for (const gameDoc of gamesToHydrate) {
    // Find matching summary if available (for nickname backfill)
    const matchingSummary =
      summaries.find((s) => s.gameId === gameDoc.gameId) ?? null;
    const ok = await hydrateGameRecord(
      gameDoc,
      league,
      connector,
      matchingSummary
    );
    if (ok) {
      hasNewData = true;
      hydratedCount++;
      // Flush cache every 10 hydrations so the UI stays reasonably fresh
      if (hydratedCount % 10 === 0) {
        emitLeagueUpdated(league._id.toString());
      }
    }
  }

  if (hasNewData) {
    emitLeagueUpdated(league._id.toString());
  }

  // --- Step 4: hydrate ReplayLog rows for games with a GameRecord -----------
  // Phase 4.5: parses the raw platform log a second time through the
  // per-platform `replayAdapter.ts` and upserts into `replaylogs`.
  // Capability-detected via `connector.getReplayLog`; connectors
  // that haven't shipped a replay adapter (e.g. Riichi City pending
  // step 7, IRL games) simply skip this pass. Re-parses when the
  // existing row is stale (`schemaVersion < REPLAY_LOG_SCHEMA_VERSION`)
  // or `Game.refetchReplayLog` is set.
  if (typeof connector.getReplayLog === "function") {
    const platform = pickReplaySource(league);
    if (platform) {
      const replayCandidates = await GameModel.find({
        league: league._id,
        gameRecord: { $ne: null },
        $or: [
          { replayLogRef: null },
          { replayLogRef: { $exists: false } },
          { refetchReplayLog: true },
        ],
      }).lean<Game[]>();

      for (const gameDoc of replayCandidates) {
        await hydrateReplayLog(gameDoc, connector, platform);
      }
    }
  }

  // --- Step 5: link freshly hydrated games to their scheduled tables --------
  // Populates SchedulingMessage.tables[].gameId (tolerant of undeclared subs)
  // so the bracket UI and the scheduling reconciler have a per-table source of
  // truth. Best-effort: never let a linking failure break hydration.
  try {
    await linkPlayedGamesToTables(league._id);
  } catch (error) {
    console.error(
      `hydrateLeagueGames: linkPlayedGamesToTables failed for ${league.name}:`,
      error
    );
  }
}

/**
 * Maps the league's platform identifier onto the `ReplayLog.source`
 * enum. Returns `null` for platforms that don't have a replay
 * source (notably IRL).
 */
function pickReplaySource(
  league: League
): "majsoul" | "tenhou" | "riichicity" | null {
  const platformName = league.platformConfig?.platformName;
  switch (platformName) {
    case "MAJSOUL":
      return "majsoul";
    case "TENHOU":
      return "tenhou";
    case "RIICHICITY":
      return "riichicity";
    default:
      return null;
  }
}

/**
 * Phase 4.5 step 8 — eager replay-log persistence. Mirrors the
 * in-app `archiveReplayLog` writer in `game-server/src/persist.ts`:
 * upserts by `(source, sourceGameId)` and links the row from
 * `Game.replayLogRef`. Skips when the existing row is at the
 * current schema version and no re-parse was requested.
 *
 * @returns `true` when a fresh ReplayLog was written (or refreshed).
 */
async function hydrateReplayLog(
  game: Game,
  connector: ILeagueTournamentConnector,
  source: "majsoul" | "tenhou" | "riichicity"
): Promise<boolean> {
  if (!game.gameId || typeof connector.getReplayLog !== "function") {
    return false;
  }

  // Short-circuit when the row is already up-to-date and no manual
  // refresh was requested.
  if (game.replayLogRef && !game.refetchReplayLog) {
    const existing = await ReplayLogModel.findById(game.replayLogRef)
      .select("schemaVersion")
      .lean<{ schemaVersion?: number } | null>();
    if (
      existing &&
      typeof existing.schemaVersion === "number" &&
      existing.schemaVersion >= REPLAY_LOG_SCHEMA_VERSION
    ) {
      return false;
    }
  }

  let replayLog;
  try {
    replayLog = await connector.getReplayLog(game.gameId);
  } catch (error) {
    console.error(
      `hydrateReplayLog: connector.getReplayLog threw for ${game.gameId}`,
      error
    );
    return false;
  }

  if (!replayLog) {
    return false;
  }

  try {
    const result = await ReplayLogModel.findOneAndUpdate(
      { source: replayLog.source, sourceGameId: replayLog.sourceGameId },
      {
        $set: {
          source: replayLog.source,
          sourceGameId: replayLog.sourceGameId,
          ruleSet: replayLog.ruleSet,
          ruleSetDetails: replayLog.ruleSetDetails,
          startedAt: replayLog.startedAt,
          endedAt: replayLog.endedAt,
          seats: replayLog.seats,
          events: replayLog.events,
          schemaVersion: replayLog.schemaVersion,
          parsedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    await GameModel.updateOne(
      { _id: game._id },
      {
        replayLogRef: result?._id,
        refetchReplayLog: false,
      }
    ).exec();

    // Belt-and-braces: the `source` enum on the model and our
    // `ReplaySource` union must stay in lockstep. Surface a clear
    // log entry if a future enum widen leaves a row without an id.
    if (!result?._id) {
      console.warn(
        `hydrateReplayLog: upsert for ${replayLog.source}/${replayLog.sourceGameId} returned no _id`
      );
    }
    void source;
    return true;
  } catch (error) {
    console.error(
      `hydrateReplayLog: failed to persist for ${game.gameId}`,
      error
    );
    return false;
  }
}

/**
 * Fetches the full game log, enriches per-user data, validates team
 * assignments, and saves the GameRecord linked to the Game document.
 *
 * @returns `true` when a new GameRecord was persisted.
 */
async function hydrateGameRecord(
  game: Game,
  league: League,
  connector: ILeagueTournamentConnector,
  summary: GameSummary | null
): Promise<boolean> {
  try {
    if (!game.gameId) {
      return false;
    }
    const recordData = await connector.getGameRecord(game.gameId);
    if (!recordData) {
      console.log(`No game record available for ${game.gameId}`);
      return false;
    }

    // Backfill nicknames from the summary onto the record data
    // (getGameRecord may not have access to player metadata)
    if (summary) {
      for (const userData of recordData.byUserData) {
        if (!userData.nickname) {
          const player = summary.players.find(
            (p) => p.platformUserId === userData.userId
          );
          if (player) {
            userData.nickname = player.nickname;
          }
        }
      }

      // Ensure endTime is set from the summary if missing
      if (!recordData.endTime && summary.endTime) {
        recordData.endTime = summary.endTime;
      }
    }

    const teamsInLeague = await TeamModel.find({
      leagueId: league._id,
    }).exec();

    const platform = game.platform as string;

    // Backfill game.startTime / endTime from the record if the Game was
    // created from a lightweight summary that didn't include timestamps.
    const gameTimeUpdate: Record<string, unknown> = {};
    if (
      !game.startTime ||
      new Date(game.startTime).getTime() === 0 ||
      new Date(game.startTime).getTime() <= 0
    ) {
      if (recordData.startTime) {
        gameTimeUpdate.startTime = recordData.startTime;
      }
    }
    if (!game.endTime && recordData.endTime) {
      gameTimeUpdate.endTime = recordData.endTime;
    }
    if (Object.keys(gameTimeUpdate).length > 0) {
      await GameModel.updateOne({ _id: game._id }, gameTimeUpdate).exec();
    }

    // Validate time window now that we have a real startTime.
    const realStartTime = (gameTimeUpdate.startTime as Date) ?? game.startTime;
    if (realStartTime && new Date(realStartTime).getTime() > 0) {
      if (new Date(realStartTime) < league.startTime) {
        return false;
      }
      if (league.endTime && new Date(realStartTime) >= league.endTime) {
        return false;
      }
    }

    // Backfill game.results from the record data.  The record now carries
    // final scores/places extracted from the GameEnd event, so we prefer
    // those over summary data (which may have placeholders).
    let gameResults: GameResult[] = (game.results ?? []) as GameResult[];
    let resultsPatched = false;
    for (const userData of recordData.byUserData) {
      const user = await resolveUser(userData.userId, platform);
      if (!user) {
        continue;
      }
      const uid = user._id.toString();
      const alreadyInResults = gameResults.some(
        (r) => r.userId?.toString() === uid
      );
      if (!alreadyInResults) {
        if (userData.score != null && userData.place != null) {
          gameResults.push({
            userId: user._id,
            score: userData.score,
            place: userData.place,
            nbChombo: 0,
          });
          resultsPatched = true;
        } else {
          // Try summary as fallback
          const summaryPlayer = summary?.players.find(
            (p) => p.platformUserId === userData.userId
          );
          if (summaryPlayer && summaryPlayer.score !== 0) {
            gameResults.push({
              userId: user._id,
              score: summaryPlayer.score,
              place: summaryPlayer.place,
              nbChombo: 0,
            });
            resultsPatched = true;
          } else {
            console.warn(
              `GameRecord for ${game.gameId}: player ${userData.userId} missing scores, needs re-fetch`
            );
            await GameModel.updateOne(
              { _id: game._id },
              { refetchGameRecord: true }
            ).exec();
            return false;
          }
        }
      } else if (userData.score != null && userData.place != null) {
        // Patch existing results that have placeholder scores (0)
        const idx = gameResults.findIndex((r) => r.userId?.toString() === uid);
        if (idx >= 0 && gameResults[idx].score === 0) {
          gameResults[idx].score = userData.score;
          gameResults[idx].place = userData.place;
          resultsPatched = true;
        }
      }
    }
    if (resultsPatched) {
      await GameModel.updateOne(
        { _id: game._id },
        { results: gameResults, isValid: true }
      ).exec();
    }

    const deltas = computePlayerDeltas(
      gameResults,
      league.rulesConfig.gameRules
    );

    const useFinalsPhase = isInFinalsPhase(
      realStartTime ?? game.startTime,
      league
    );

    for (const userData of recordData.byUserData) {
      const user = await resolveUser(userData.userId, platform);
      if (!user) {
        const msg = `GameRecord for ${game.gameId}: player ${userData.userId} not found in DB`;
        console.warn(msg);
        trackEvent({
          type: "error",
          method: "hydrateGameRecord",
          path: league.name,
          error: msg,
          meta: {
            gameId: game.gameId,
            platformUserId: userData.userId,
            platform,
            leagueId: league._id.toString(),
          },
        });
        await GameModel.updateOne(
          { _id: game._id },
          { refetchGameRecord: true }
        ).exec();
        return false;
      }

      (userData as UsersRounds).userDbId = user._id;

      // Backfill nickname from the DB user when no summary is available
      if (!userData.nickname) {
        if (platform === "riichiCity") {
          userData.nickname = user.riichiCityIdentity?.name ?? user.name ?? "";
        } else if (platform === "majsoul") {
          userData.nickname = user.majsoulIdentity?.name ?? user.name ?? "";
        } else {
          userData.nickname = user.name ?? "";
        }
      }

      const resultIndex = gameResults.findIndex(
        (r) => r.userId?.toString() === user._id.toString()
      );
      if (resultIndex >= 0) {
        userData.score = gameResults[resultIndex].score;
        userData.place = gameResults[resultIndex].place;
        userData.deltaPoints = deltas[resultIndex];
      }

      const team = teamsInLeague.find((tm) => {
        const roster = getEffectiveRoster(tm, useFinalsPhase);
        return (
          roster.members.some(
            (m: any) => m.toString() === user._id.toString()
          ) ||
          (roster.substitutes ?? []).some(
            (s: any) => s.toString() === user._id.toString()
          )
        );
      });
      if (team) {
        (userData as UsersRounds).teamDbId = team._id;
        userData.teamName = team.displayName;
      } else {
        // Check if the player is an official substitute
        const officialSubIdSet = new Set(
          (league.officialSubstitutes ?? []).map((id: any) => id.toString())
        );
        if (officialSubIdSet.has(user._id.toString())) {
          (userData as UsersRounds).isOfficialSubstitute = true;
        }
      }
    }

    // Team validation: in a team league, all resolved players must have a team
    // (official substitutes are exempt)
    if (league.rulesConfig.isTeamMode) {
      const officialSubIds = new Set(
        (league.officialSubstitutes ?? []).map((id: any) => id.toString())
      );
      const playersWithoutTeam = recordData.byUserData.filter(
        (ud) =>
          ud.userDbId &&
          !ud.teamDbId &&
          !officialSubIds.has(ud.userDbId?.toString() ?? "")
      );
      if (playersWithoutTeam.length > 0) {
        const names = playersWithoutTeam
          .map((p) => p.nickname || p.userId)
          .join(", ");
        console.warn(
          `GameRecord for ${game.gameId}: players missing team assignment: ${names}`
        );
        // Only send the message on the first failure to avoid spam on retries
        if (league.discordConfig?.resultChannel && !game.refetchGameRecord) {
          const warningPlatform = getLeaguePlatform(league);
          const userIds = playersWithoutTeam
            .map((p) => p.userDbId)
            .filter((id): id is NonNullable<typeof id> => Boolean(id));
          const users = await UserModel.find({
            _id: { $in: userIds },
          }).lean();
          const userById = new Map(users.map((u) => [u._id.toString(), u]));
          const discordNames = playersWithoutTeam
            .map((p) => {
              const user = userById.get(p.userDbId?.toString() ?? "");
              if (!user) {
                return p.nickname || p.userId;
              }
              const display = resolvePlayerDisplay(user, {
                platform: warningPlatform,
              });
              return display.line;
            })
            .join(", ");
          await sendChannelMessage(
            league.discordConfig?.resultChannel,
            `⚠️ Game \`${game.gameId}\` in **${league.name}**: game record not saved — the following players are not assigned to a team: ${discordNames}. The game will be retried automatically.`
          );
        }
        await GameModel.updateOne(
          { _id: game._id },
          { refetchGameRecord: true }
        ).exec();
        return false;
      }
    }

    const dbGameRecord = new GameRecordModel({ ...recordData });
    await dbGameRecord.save();
    await GameModel.updateOne(
      { _id: game._id },
      { gameRecord: dbGameRecord._id, refetchGameRecord: false }
    ).exec();

    console.log(
      `GameRecord for ${game.gameId} saved and linked (league ${league.name})`
    );
    return true;
  } catch (error) {
    console.error(`Error saving GameRecord for ${game.gameId}:`, error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveUser(platformUserId: string, platform: string) {
  switch (platform) {
    case "majsoul":
      return UserModel.findOne({
        "majsoulIdentity.userId": platformUserId,
      }).exec();
    case "riichiCity":
      return UserModel.findOne({
        "riichiCityIdentity.id": platformUserId,
      }).exec();
    case "tenhou":
      return UserModel.findOne({
        "tenhouIdentity.name": platformUserId,
      }).exec();
    default:
      return null;
  }
}

async function backfillPlatformIdentityNames(
  players: Array<{ platformUserId: string; nickname: string }>,
  platform: string
) {
  await Promise.all(
    players.map(async (player) => {
      if (!player.nickname) {
        return;
      }

      if (platform === "riichiCity") {
        await UserModel.updateOne(
          {
            "riichiCityIdentity.id": player.platformUserId,
            "riichiCityIdentity.name": { $ne: player.nickname },
          },
          {
            $set: { "riichiCityIdentity.name": player.nickname },
          }
        ).exec();
      } else if (platform === "majsoul") {
        await UserModel.updateOne(
          {
            "majsoulIdentity.userId": player.platformUserId,
            "majsoulIdentity.name": { $ne: player.nickname },
          },
          {
            $set: { "majsoulIdentity.name": player.nickname },
          }
        ).exec();
      } else if (platform === "tenhou") {
        // Tenhou identifies players by username, so platformUserId IS the
        // name.  Nothing to backfill — the name is the identity key.
      }
    })
  );
}
