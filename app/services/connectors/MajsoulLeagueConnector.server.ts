import { MahjongSoulConnector } from "~/api/majsoul/data/MajsoulConnector";
import { parseMajsoulReplay } from "~/api/majsoul/replayAdapter";
import { buildGameRecordFromReplay } from "~/api/replayToGameRecord";
import type {
  ILeagueTournamentConnector,
  LeagueTournamentConnectorOptions,
  TournamentLobbyStatus,
  OngoingGame,
  PlayerLobbyEntry,
  TeamEntry,
  TeamConfig,
  PlayerConfig,
} from "./ILeagueTournamentConnector.server";
import { OngoingGameStatus } from "./ILeagueTournamentConnector.server";
import type { GameSummary, GameSummaryPlayer } from "~/types/GameSummary";
import type { GameRecordData } from "~/api/majsoul/types/gameRecordData";
import type { ReplayLog } from "~/game/replay/types";

/** Tag value written to a contest game's `remark` to mark it as paused. */
const MAJSOUL_PAUSED_TAG = "PAUSED";

export class MajsoulLeagueConnector implements ILeagueTournamentConnector {
  private static readonly GLOBAL_KEY = "__MajsoulLeagueConnector__";

  static get instance(): MajsoulLeagueConnector {
    if (!(globalThis as any)[MajsoulLeagueConnector.GLOBAL_KEY]) {
      (globalThis as any)[MajsoulLeagueConnector.GLOBAL_KEY] =
        new MajsoulLeagueConnector();
    }
    return (globalThis as any)[MajsoulLeagueConnector.GLOBAL_KEY];
  }

  /** MahjongSoulConnector must be initialised via serverInit.server.ts before use. */
  private get connector() {
    return MahjongSoulConnector.instance;
  }

  async getGameSummaries(
    tournamentId: string | number,
    options?: LeagueTournamentConnectorOptions
  ): Promise<GameSummary[]> {
    void options;

    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;

    const games = await this.connector.getAllContestGameRecords({
      contestId: id,
    });

    return games
      .filter((game) => !!game.uuid && !!game.accounts && !!game.result)
      .map((game) => {
        const sortedByScore = [...game.result!.players].sort(
          (a, b) => b.part_point_1 - a.part_point_1
        );

        const players: GameSummaryPlayer[] = (game.accounts ?? []).map(
          (account) => {
            const resultRow = game.result!.players.find(
              (r) => r.seat === account.seat
            );
            const score = resultRow?.part_point_1 ?? 0;
            const place =
              sortedByScore.findIndex((r) => r.seat === account.seat) + 1;

            return {
              platformUserId: account.account_id?.toString() ?? "",
              nickname: account.nickname ?? "Unknown",
              score,
              place,
              seat: account.seat ?? 0,
            };
          }
        );

        return {
          gameId: game.uuid!,
          platform: "majsoul" as const,
          startTime: game.start_time
            ? new Date(game.start_time * 1000)
            : new Date(),
          endTime: game.end_time ? new Date(game.end_time * 1000) : undefined,
          log: `https://mahjongsoul.game.yo-star.com/?paipu=${game.uuid}`,
          players,
        };
      });
  }

  async getGameRecord(gameId: string): Promise<GameRecordData | null> {
    try {
      const raw = await this.connector.getContestGameRecord(gameId);
      if (!raw) {
        return null;
      }

      const replay = parseMajsoulReplay(raw);

      // seat index → platform account id / nickname from the record head.
      const seatToUserId: string[] = [];
      const seatToNickname: string[] = [];
      for (const account of raw.head?.accounts ?? []) {
        const seat = account.seat ?? 0;
        seatToUserId[seat] = account.account_id?.toString() ?? "";
        seatToNickname[seat] = account.nickname ?? "";
      }
      for (let s = 0; s < replay.seats.length; s++) {
        if (seatToUserId[s] === undefined) {
          seatToUserId[s] = "";
        }
        if (seatToNickname[s] === undefined) {
          seatToNickname[s] = replay.seats[s]?.displayName ?? "";
        }
      }

      return buildGameRecordFromReplay({
        gameId: raw.head?.uuid ?? gameId,
        startTime: new Date((raw.head?.start_time ?? 0) * 1000),
        endTime: new Date((raw.head?.end_time ?? 0) * 1000),
        events: replay.events,
        seats: replay.seats,
        seatToUserId,
        seatToNickname,
      });
    } catch (error) {
      console.error(
        `MajsoulLeagueConnector: failed to parse game ${gameId}`,
        error
      );
      return null;
    }
  }

  async getReplayLog(gameId: string): Promise<ReplayLog | null> {
    // Lazy auth: the on-demand `/review` path can fire before the
    // league worker has had a chance to call `init()` on a fresh
    // boot, so we make sure the lobby session is alive before
    // dispatching the RPC.
    await this.connector.ensureInitialized();
    // Majsoul reports a stale / expired lobby session as a generic
    // "couldn't find game (code 1004)" error rather than a typed
    // auth failure, so we can't distinguish the two from the error
    // alone. On first failure, force a full re-init of the lobby
    // connection (matching what a process restart does) and retry
    // once; if the second attempt still fails, surface the error.
    let raw;
    try {
      raw = await this.connector.getContestGameRecord(gameId);
    } catch (firstError) {
      console.warn(
        `[majsoul] getReplayLog failed for ${gameId}, forcing reinit and retrying once:`,
        firstError instanceof Error ? firstError.message : firstError
      );
      await this.connector.init();
      raw = await this.connector.getContestGameRecord(gameId);
    }
    if (!raw) {
      return null;
    }
    return parseMajsoulReplay(raw);
  }

  async getTournamentLobbyStatus(
    tournamentId: string | number
  ): Promise<TournamentLobbyStatus | undefined> {
    const contestApi = this.connector.contestApi;
    const id = tournamentId.toString();
    const numericId =
      typeof tournamentId === "number"
        ? tournamentId
        : parseInt(tournamentId, 10);

    const [readyPlayers, runningGames, online] = await Promise.all([
      contestApi.fetchPlayerReadyList(id),
      contestApi.fetchRunningGameList(id),
      this.connector.fetchOnlinePlayerCount(numericId),
    ]);

    const inGame = runningGames.reduce(
      (count, game) =>
        count + game.players.filter((p) => p.account_id !== 0).length,
      0
    );

    return {
      online,
      ready: readyPlayers.length,
      inGame,
    };
  }

  async getPlayerLobbyEntries(
    tournamentId: string | number,
    options?: { seasonId?: string }
  ): Promise<PlayerLobbyEntry[]> {
    const contestApi = this.connector.contestApi;
    const id = tournamentId.toString();
    const seasonId = options?.seasonId;

    const [readyPlayers, runningGames, gamePlans] = await Promise.all([
      contestApi.fetchPlayerReadyList(id, seasonId),
      contestApi.fetchRunningGameList(id, seasonId),
      contestApi.fetchContestGamePlanList(id, seasonId),
    ]);

    const entryMap = new Map<number, PlayerLobbyEntry>();

    // Players in scheduled (not-yet-started) game plans → "ready"
    for (const plan of gamePlans) {
      for (const account of plan.accounts) {
        entryMap.set(account.account_id, {
          platformAccountId: account.account_id,
          status: "ready",
        });
      }
    }

    // Players in the ready list → "online"
    for (const player of readyPlayers) {
      entryMap.set(player.account_id, {
        platformAccountId: player.account_id,
        status: "online",
      });
    }

    // Players in running games → "in-game" (highest priority)
    for (const game of runningGames) {
      for (const player of game.players) {
        if (player.account_id !== 0) {
          entryMap.set(player.account_id, {
            platformAccountId: player.account_id,
            status: "in-game",
          });
        }
      }
    }

    return [...entryMap.values()];
  }

  async setUsersInTeams(
    tournamentId: string | number,
    teams: TeamEntry[],
    options?: { seasonId?: string }
  ): Promise<void> {
    const contestApi = this.connector.contestApi;
    const id = tournamentId.toString();
    const seasonId = options?.seasonId;

    // Resolve friend IDs to real account IDs + nicknames. We only call
    // the WebSocket lookup for members that don't already provide a
    // resolved account ID — for users in our DB the account ID is
    // already stored alongside the friend ID, so the caller can pass it
    // through and skip the (slow, sequential) RPC roundtrip.
    const resolvedMap = new Map<
      number,
      { accountId: number; nickname: string }
    >();
    for (const team of teams) {
      for (const member of team.members) {
        if (resolvedMap.has(member.accountId)) {
          continue;
        }
        if (member.resolvedAccountId !== undefined) {
          resolvedMap.set(member.accountId, {
            accountId: member.resolvedAccountId,
            nickname: member.nickname,
          });
          continue;
        }
        const info = await this.connector.getUserInfoFromFriendId(
          member.accountId.toString()
        );
        if (info.accountId !== undefined && info.nickname) {
          resolvedMap.set(member.accountId, {
            accountId: info.accountId,
            nickname: info.nickname,
          });
        }
      }
    }

    const buildPayload = (
      members: TeamEntry["members"]
    ): Array<{ account_id: number; nickname: string }> =>
      members
        .map((m) => {
          const resolved = resolvedMap.get(m.accountId);
          if (!resolved) {
            return null;
          }
          return {
            account_id: resolved.accountId,
            nickname: resolved.nickname,
          };
        })
        .filter((x): x is { account_id: number; nickname: string } => !!x);

    // Diff against the platform's current state so we only touch the
    // teams that actually changed. The Majsoul API has no per-member
    // remove call, so when a team's roster differs we still have to
    // clean+re-add — but unchanged teams (same name, same member set)
    // are skipped entirely.
    const existingTeams = await contestApi.fetchTeamList(id, seasonId);
    const existingByName = new Map(existingTeams.map((t) => [t.name, t]));
    const desiredNames = new Set(teams.map((t) => t.name));

    // Pre-fetch the member list for every existing team that we'll need
    // to compare against, in parallel. This is the dominant cost on
    // saves that only touch one or two teams: fetchTeamMembers is a
    // WebSocket roundtrip and doing it sequentially over ~12 teams adds
    // up to tens of seconds.
    const teamsNeedingMemberFetch = teams
      .map((t) => existingByName.get(t.name))
      .filter((e): e is NonNullable<typeof e> => !!e);
    const memberLists = await Promise.all(
      teamsNeedingMemberFetch.map((e) =>
        contestApi.fetchTeamMembers(id, e.team_id, seasonId)
      )
    );
    const membersByTeamId = new Map(
      teamsNeedingMemberFetch.map((e, i) => [e.team_id, memberLists[i]])
    );

    // Delete platform teams that no longer exist on our side.
    for (const existing of existingTeams) {
      if (!desiredNames.has(existing.name)) {
        await contestApi.cleanTeamMembers(id, existing.team_id);
        await contestApi.deleteTeam(id, existing.team_id);
      }
    }

    // Update or create each desired team.
    const teamsToCreate: TeamEntry[] = [];
    for (const team of teams) {
      const existing = existingByName.get(team.name);
      const desiredPayload = buildPayload(team.members);
      const desiredAccountIds = new Set(
        desiredPayload.map((p) => p.account_id)
      );

      if (!existing) {
        teamsToCreate.push(team);
        continue;
      }

      const currentMembers = membersByTeamId.get(existing.team_id) ?? [];
      const currentAccountIds = new Set(
        currentMembers.map((m) => m.account_id)
      );
      const sameMembers =
        currentAccountIds.size === desiredAccountIds.size &&
        [...currentAccountIds].every((aid) => desiredAccountIds.has(aid));

      if (sameMembers) {
        continue;
      }

      // Member set differs — clean and re-add. Majsoul has no per-member
      // remove endpoint, so this is the minimum work the API allows.
      await contestApi.cleanTeamMembers(id, existing.team_id);
      if (desiredPayload.length > 0) {
        const errors = await contestApi.addTeamMembers(
          id,
          existing.team_id,
          desiredPayload
        );
        if (errors.length > 0) {
          console.warn(
            `[Majsoul] addTeamMembers errors for team "${existing.name}":`,
            errors
          );
        }
      }
    }

    if (teamsToCreate.length === 0) {
      return;
    }

    const created = await contestApi.createTeamBatch(
      id,
      teamsToCreate.map((t) => ({ name: t.name })),
      seasonId
    );
    for (const [i, createdTeam] of created.entries()) {
      const desiredPayload = buildPayload(teamsToCreate[i].members);
      if (desiredPayload.length === 0) {
        continue;
      }
      const errors = await contestApi.addTeamMembers(
        id,
        createdTeam.team_id,
        desiredPayload
      );
      if (errors.length > 0) {
        console.warn(
          `[Majsoul] addTeamMembers errors for team "${createdTeam.team_name}":`,
          errors
        );
      }
    }
  }

  async getTeamsConfig(
    tournamentId: string | number,
    options?: { seasonId?: string }
  ): Promise<TeamConfig[]> {
    const contestApi = this.connector.contestApi;
    const id = tournamentId.toString();
    const seasonId = options?.seasonId;

    const teams = await contestApi.fetchTeamList(id, seasonId);

    const result: TeamConfig[] = [];
    for (const team of teams) {
      const members = await contestApi.fetchTeamMembers(
        id,
        team.team_id,
        seasonId
      );
      result.push({
        name: team.name,
        members: members.map((m) => ({
          accountId: m.account_id,
          nickname: m.nickname,
        })),
      });
    }

    return result;
  }

  async getPlayersConfig(
    tournamentId: string | number,
    options?: { seasonId?: string }
  ): Promise<PlayerConfig[]> {
    const contestApi = this.connector.contestApi;
    const id = tournamentId.toString();
    const seasonId = options?.seasonId;

    // The season player list is the contest's registered roster.
    const players = await contestApi.fetchSeasonPlayerList(id, seasonId);
    return players.map((p) => ({
      accountId: p.account_id,
      nickname: p.nickname,
    }));
  }

  async startGame(
    tournamentId: string | number,
    playerAccountIds: number[],
    options?: {
      seasonId?: number;
      gameStartTime?: number;
      initPoints?: number[];
      shuffleSeats?: boolean;
    }
  ): Promise<boolean> {
    const contestApi = this.connector.contestApi;
    const id = tournamentId.toString();
    const seasonId = options?.seasonId ?? 1;
    const gameStartTime =
      options?.gameStartTime ?? Math.floor(Date.now() / 1000);

    await contestApi.createGamePlan({
      contestId: id,
      seasonId,
      accountIds: playerAccountIds,
      initPoints: options?.initPoints,
      gameStartTime,
      shuffleSeats: options?.shuffleSeats,
    });

    return true;
  }

  /**
   * Lists ongoing games in a Majsoul contest. Status is derived from the
   * game's `remark` (tag): the connector tags games with {@link MAJSOUL_PAUSED_TAG}
   * via {@link pauseGame} so {@link fetchRunningGameList} can surface the
   * paused state on the next poll.
   */
  async getOngoingGames(
    tournamentId: string | number,
    options?: { seasonId?: string }
  ): Promise<OngoingGame[]> {
    const contestApi = this.connector.contestApi;
    const id = tournamentId.toString();
    const seasonId = options?.seasonId;

    const runningGames = await contestApi.fetchRunningGameList(id, seasonId);

    return runningGames.map((game) => ({
      gameId: game.game_uuid,
      tableId: game.game_uuid,
      players: game.players
        .filter((p) => p.account_id !== 0)
        .map((p) => ({
          accountId: p.account_id,
          nickname: p.nickname,
        })),
      status:
        game.tag === MAJSOUL_PAUSED_TAG
          ? OngoingGameStatus.Paused
          : OngoingGameStatus.Playing,
      startTime: game.start_time ? new Date(game.start_time * 1000) : undefined,
    }));
  }

  async addPlayersToTournament(
    tournamentId: string | number,
    players: Array<{ accountId: number; nickname: string }>,
    options?: { seasonId?: number }
  ): Promise<{ success: number[]; failed: number[] }> {
    const contestApi = this.connector.contestApi;
    const id = tournamentId.toString();
    const seasonId = options?.seasonId ?? 1;

    const resolvedPlayers: Array<{ account_id: number; nickname: string }> = [];
    for (const player of players) {
      const info = await this.connector.getUserInfoFromFriendId(
        player.accountId.toString()
      );
      resolvedPlayers.push({
        account_id: info.accountId ?? player.accountId,
        nickname: info.nickname ?? player.nickname,
      });
    }

    return contestApi.addPlayersToTournament(id, seasonId, resolvedPlayers);
  }

  /**
   * Pauses a running contest game. Tags the game with {@link MAJSOUL_PAUSED_TAG}
   * first (so the paused state is observable via {@link getOngoingGames}), then
   * issues the actual pause. If the pause fails, the tag is rolled back and the
   * original error is rethrown.
   */
  async pauseGame(
    gameId: string,
    tournamentId: string | number
  ): Promise<boolean> {
    const id = tournamentId.toString();
    const contestApi = this.connector.contestApi;

    await contestApi.updateContestGameRemark(id, gameId, MAJSOUL_PAUSED_TAG);
    try {
      await contestApi.pauseContestGame(id, gameId);
    } catch (error) {
      try {
        await contestApi.updateContestGameRemark(id, gameId, "");
      } catch (rollbackError) {
        console.warn(
          `Majsoul pauseGame: failed to roll back remark on ${gameId}:`,
          rollbackError
        );
      }
      throw error;
    }
    return true;
  }

  /**
   * Resumes a paused contest game. Clears the {@link MAJSOUL_PAUSED_TAG} tag
   * first, then issues the actual resume. If the resume fails, the tag is
   * restored and the original error is rethrown.
   */
  async resumeGame(
    gameId: string,
    tournamentId: string | number
  ): Promise<boolean> {
    const id = tournamentId.toString();
    const contestApi = this.connector.contestApi;

    await contestApi.updateContestGameRemark(id, gameId, "");
    try {
      await contestApi.resumeContestGame(id, gameId);
    } catch (error) {
      try {
        await contestApi.updateContestGameRemark(
          id,
          gameId,
          MAJSOUL_PAUSED_TAG
        );
      } catch (rollbackError) {
        console.warn(
          `Majsoul resumeGame: failed to roll back remark on ${gameId}:`,
          rollbackError
        );
      }
      throw error;
    }
    return true;
  }

  /**
   * Terminates a running contest game (destructive). Returns true on success.
   */
  async terminateGame(
    gameId: string,
    tournamentId: string | number
  ): Promise<boolean> {
    const id = tournamentId.toString();
    await this.connector.contestApi.terminateContestGame(id, gameId);
    return true;
  }
}
