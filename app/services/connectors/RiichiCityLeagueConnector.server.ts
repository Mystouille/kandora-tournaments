import { RiichiCityConnector } from "~/api/riichiCity/data/RiichiCityConnector";
import type { RiichiCityService } from "~/services/RiichiCityService.server";
import { RiichiCityRoomStatus } from "~/services/RiichiCityService.server";
import { parseRiichiCityReplay } from "~/api/riichiCity/replayAdapter";
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
import {
  EventType,
  type GameData,
  type LogListData,
} from "~/services/riichiCityModels";
import { LeagueModel } from "~/db/League";
import type { League } from "~/db/League";

export class RiichiCityLeagueConnector implements ILeagueTournamentConnector {
  private static readonly GLOBAL_KEY = "__RiichiCityLeagueConnector__";

  static get instance(): RiichiCityLeagueConnector {
    if (!(globalThis as any)[RiichiCityLeagueConnector.GLOBAL_KEY]) {
      (globalThis as any)[RiichiCityLeagueConnector.GLOBAL_KEY] =
        new RiichiCityLeagueConnector();
    }
    return (globalThis as any)[RiichiCityLeagueConnector.GLOBAL_KEY];
  }

  /** The underlying Riichi City API service (delegates to RiichiCityConnector singleton). */
  get service(): RiichiCityService {
    return RiichiCityConnector.instance.service;
  }

  private constructor() {}

  /**
   * Validates that the bot can access the given tournament and resolves
   * its internal tournament ID. Does not require a League document.
   */
  async resolveInternalTournamentIdRaw(tournamentId: number): Promise<string> {
    return this.service.resolveInternalTournamentId(tournamentId);
  }

  async resolveOptions(
    league: League
  ): Promise<{ internalTournamentId?: string } | undefined> {
    const id = await this.ensureInternalTournamentId(league);
    return id ? { internalTournamentId: id } : undefined;
  }

  /**
   * Resolves and caches the Riichi City internal tournament ID on the League
   * document so that subsequent calls skip the API lookup.
   */
  private async ensureInternalTournamentId(
    league: League
  ): Promise<string | undefined> {
    if (league.platformConfig.internalTournamentId) {
      return league.platformConfig.internalTournamentId;
    }

    if (!league.platformConfig.tournamentId) {
      return undefined;
    }

    const parsedTournamentId = parseInt(league.platformConfig.tournamentId, 10);
    if (Number.isNaN(parsedTournamentId)) {
      console.warn(
        `RiichiCityLeagueConnector.ensureInternalTournamentId: league ${league.name} has invalid tournamentId ${league.platformConfig.tournamentId}`
      );
      return undefined;
    }

    try {
      const internalTournamentId =
        await this.service.resolveInternalTournamentId(parsedTournamentId);

      await LeagueModel.updateOne(
        { _id: league._id },
        {
          $set: { "platformConfig.internalTournamentId": internalTournamentId },
        }
      ).exec();

      league.platformConfig.internalTournamentId = internalTournamentId;
      return internalTournamentId;
    } catch (error) {
      console.error(
        `RiichiCityLeagueConnector.ensureInternalTournamentId: failed for league ${league.name}`,
        error
      );
      return undefined;
    }
  }

  async getGameSummaries(
    tournamentId: string | number,
    options?: LeagueTournamentConnectorOptions
  ): Promise<GameSummary[]> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;
    const classifyID =
      options?.internalTournamentId ??
      (await this.service.resolveInternalTournamentId(id));
    const knownGameIds = options?.knownGameIds;

    const PAGE_SIZE = 20;
    const summaries: GameSummary[] = [];
    let currentSkip = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const payload = await this.service.readPaiPuList({
        classifyID,
        skip: currentSkip,
        limit: PAGE_SIZE,
      });

      const page = payload.data ?? [];
      const relevantMetas = page.filter(
        (entry: LogListData) => entry.isClear === false
      );

      for (const meta of relevantMetas) {
        // Skip games we already fully processed
        if (knownGameIds?.has(meta.paiPuId)) {
          continue;
        }

        // Build lightweight summaries from listing metadata only — no getLog()
        // call here.  Scores/places are filled in later by hydrateGameRecord()
        // which calls getGameRecord() (single getLog round-trip).
        const players: GameSummaryPlayer[] = meta.players.map((p, seat) => ({
          platformUserId: p.userId.toString(),
          nickname: p.nickname,
          score: p.pointNum ?? 0,
          place: 0,
          seat,
        }));

        summaries.push({
          gameId: meta.paiPuId,
          platform: "riichiCity" as const,
          startTime: new Date(0), // real time set by hydrateGameRecord
          endTime: undefined,
          players,
        });
      }

      if (page.length < PAGE_SIZE) {
        break;
      }
      currentSkip += PAGE_SIZE;
    }

    return summaries;
  }

  async getGameRecord(gameId: string): Promise<GameRecordData | null> {
    try {
      const game = await this.service.getLog(gameId);

      // Use the same seat ordering the replay adapter uses so the projected
      // round events line up with `seatToUserId`.
      const { seatToUserId, seatToNickname } = deriveSeatOrder(game);

      const startTime = deriveStartTime(game);
      const endTime = new Date(game.nowTime * 1000);

      const replay = parseRiichiCityReplay(game, seatToUserId, seatToNickname);

      return buildGameRecordFromReplay({
        gameId: game.keyValue,
        startTime,
        endTime,
        events: replay.events,
        seats: replay.seats,
        seatToUserId,
        seatToNickname,
      });
    } catch (error) {
      console.error(
        `RiichiCityLeagueConnector: failed to parse game ${gameId}`,
        error
      );
      return null;
    }
  }

  async getReplayLog(gameId: string): Promise<ReplayLog | null> {
    try {
      const game = await this.service.getLog(gameId);
      const { seatToUserId, seatToNickname } = deriveSeatOrder(game);
      return parseRiichiCityReplay(game, seatToUserId, seatToNickname);
    } catch (error) {
      console.error(
        `RiichiCityLeagueConnector: failed to parse replay log ${gameId}`,
        error
      );
      return null;
    }
  }

  /**
   * Variant of getGameRecord that also accepts the seat metadata from
   * getAllTournamentGamesWithMeta, giving accurate nicknames.
   */
  async getGameRecordWithMeta(
    game: GameData,
    seatToUserId: string[],
    seatToNickname: string[]
  ): Promise<GameRecordData | null> {
    try {
      const startTime = deriveStartTime(game);
      const endTime = new Date(game.nowTime * 1000);

      const replay = parseRiichiCityReplay(game, seatToUserId, seatToNickname);

      return buildGameRecordFromReplay({
        gameId: game.keyValue,
        startTime,
        endTime,
        events: replay.events,
        seats: replay.seats,
        seatToUserId,
        seatToNickname,
      });
    } catch (error) {
      console.error(
        `RiichiCityLeagueConnector: failed to parse game ${game.keyValue}`,
        error
      );
      return null;
    }
  }

  async getTournamentLobbyStatus(
    tournamentId: string | number
  ): Promise<TournamentLobbyStatus | undefined> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;
    return this.service.getPlayerStatusCounts(id);
  }

  async getPlayerLobbyEntries(
    tournamentId: string | number
  ): Promise<PlayerLobbyEntry[]> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;
    const response = await this.service.getPlayersStatus(id);
    const { PlayerStatus } = await import("~/services/riichiCityModels");
    return (response.data ?? []).map((p) => ({
      platformAccountId: p.userID,
      status:
        p.status === PlayerStatus.InGame
          ? ("in-game" as const)
          : p.status === PlayerStatus.Ready
            ? ("ready" as const)
            : p.status === PlayerStatus.Online
              ? ("online" as const)
              : ("offline" as const),
    }));
  }

  async setUsersInTeams(
    tournamentId: string | number,
    teams: TeamEntry[]
  ): Promise<void> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;

    // Drop teams that have no members with a platform account — RC rejects
    // the whole batch with "internal fail" (code 2) if any team has an
    // empty userList.
    teams = teams.filter((t) => t.members.some((m) => m.accountId));

    // RiichiCity rejects empty / duplicate team names and team names
    // longer than 20 chars (causes the opaque "self name mash" / code 210
    // error). Validate empties up front; long names are truncated when
    // sent to RC (kept full in our DB), and a numeric suffix is appended
    // if truncation produces a collision.
    const RC_TEAM_NAME_MAX = 20;
    const seenUsers = new Set<number>();
    const usedRcNames = new Set<string>();
    const rcNameByOriginal = new Map<string, string>();
    const buildRcName = (original: string): string => {
      const trimmed = original.trim();
      if (trimmed.length <= RC_TEAM_NAME_MAX && !usedRcNames.has(trimmed)) {
        usedRcNames.add(trimmed);
        return trimmed;
      }
      const base = trimmed.slice(0, RC_TEAM_NAME_MAX).trimEnd();
      if (!usedRcNames.has(base)) {
        usedRcNames.add(base);
        return base;
      }
      // Collision: append " #N" to a shortened prefix until unique. The
      // suffix itself takes characters, and the longer N gets, the more
      // characters it takes — recompute the budget on every iteration.
      for (let n = 2; n < 1000; n++) {
        const suffix = ` #${n}`;
        const budget = RC_TEAM_NAME_MAX - suffix.length;
        const candidate = trimmed.slice(0, budget).trimEnd() + suffix;
        if (!usedRcNames.has(candidate)) {
          usedRcNames.add(candidate);
          return candidate;
        }
      }
      throw new Error(
        `Could not generate a unique RiichiCity team name for "${original}"`
      );
    };
    for (const t of teams) {
      const name = t.name?.trim() ?? "";
      if (!name) {
        throw new Error(
          "RiichiCity team name cannot be empty (one or more rows were imported without a team)"
        );
      }
      rcNameByOriginal.set(name, buildRcName(name));
      for (const m of t.members) {
        if (seenUsers.has(m.accountId)) {
          throw new Error(
            `RiichiCity user ${m.accountId} is assigned to more than one team`
          );
        }
        seenUsers.add(m.accountId);
      }
    }

    // Register all users into the tournament first
    const allUserIds = teams.flatMap((t) => t.members.map((m) => m.accountId));
    if (allUserIds.length > 0) {
      await this.service.manageSelfUsers(id, allUserIds);
    }

    // Resolve real nicknames via getUserBrief
    const nicknameMap = new Map<number, string>();
    for (const userId of allUserIds) {
      if (nicknameMap.has(userId)) {
        continue;
      }
      const resp = await this.service.getUserBrief(userId);
      const resolvedName = resp.data?.nickname ?? resp.data?.name;
      if (resolvedName) {
        nicknameMap.set(userId, resolvedName);
      }
    }

    await this.service.resetSelfTeamConfig(id);
    const teamList = teams.map((t) => ({
      name: rcNameByOriginal.get(t.name.trim()) ?? t.name.trim(),
      userList: t.members
        .filter((m) => m.accountId)
        .map((m) => ({
          userID: m.accountId,
          identity: 1,
          nickname: nicknameMap.get(m.accountId) ?? m.nickname,
        })),
    }));
    try {
      // `addSelfTeamConfig` replaces the entire team config on every call
      // (the same endpoint, with an empty body, is used by
      // `resetSelfTeamConfig`). Send the full list in a single request so
      // every team is registered.
      await this.service.addSelfTeamConfig(id, teamList);
    } catch (err) {
      // For large payloads RiichiCity sometimes returns code 2
      // ("internal fail") even though the teams were persisted. The
      // server is eventually-consistent: an immediate readback can still
      // show the post-reset (empty) state for a short while, so retry the
      // verification a few times before reporting any discrepancy.
      const expectedNames = new Set(teamList.map((t) => t.name));
      const expectedMembers = new Map(
        teamList.map((t) => [t.name, new Set(t.userList.map((u) => u.userID))])
      );
      const computeDiff = (
        persisted: Awaited<ReturnType<typeof this.service.readSelfTeamConfig>>
      ) => {
        const persistedNames = new Set(persisted.map((t) => t.name));
        const missing = [...expectedNames].filter(
          (n) => !persistedNames.has(n)
        );
        const extra = [...persistedNames].filter((n) => !expectedNames.has(n));
        const memberMismatches: string[] = [];
        for (const t of persisted) {
          const exp = expectedMembers.get(t.name);
          if (!exp) {
            continue;
          }
          const got = new Set(t.userList.map((u) => u.userID));
          const missingMembers = [...exp].filter((u) => !got.has(u));
          const extraMembers = [...got].filter((u) => !exp.has(u));
          if (missingMembers.length > 0 || extraMembers.length > 0) {
            const parts: string[] = [];
            if (missingMembers.length > 0) {
              parts.push(`missing ${missingMembers.join(", ")}`);
            }
            if (extraMembers.length > 0) {
              parts.push(`unexpected ${extraMembers.join(", ")}`);
            }
            memberMismatches.push(`${t.name} [${parts.join("; ")}]`);
          }
        }
        return { missing, extra, memberMismatches };
      };

      const MAX_ATTEMPTS = 6;
      const RETRY_DELAY_MS = 500;
      let lastDiff: ReturnType<typeof computeDiff> | null = null;
      let lastVerifyError: unknown = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
        try {
          const persisted = await this.service.readSelfTeamConfig(id);
          lastDiff = computeDiff(persisted);
          if (
            lastDiff.missing.length === 0 &&
            lastDiff.extra.length === 0 &&
            lastDiff.memberMismatches.length === 0
          ) {
            return;
          }
        } catch (verifyErr) {
          lastVerifyError = verifyErr;
        }
      }

      if (!lastDiff) {
        if (lastVerifyError instanceof Error) {
          throw lastVerifyError;
        }
        throw err;
      }
      const diffParts: string[] = [];
      if (lastDiff.missing.length > 0) {
        diffParts.push(`missing teams: ${lastDiff.missing.join(", ")}`);
      }
      if (lastDiff.extra.length > 0) {
        diffParts.push(`unexpected teams: ${lastDiff.extra.join(", ")}`);
      }
      if (lastDiff.memberMismatches.length > 0) {
        diffParts.push(
          `roster mismatch: ${lastDiff.memberMismatches.join(" | ")}`
        );
      }
      throw new Error(
        `${(err as Error).message} -- discrepancies: ${diffParts.join("; ")}`
      );
    }
  }

  async getTeamsConfig(tournamentId: string | number): Promise<TeamConfig[]> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;

    const teams = await this.service.readSelfTeamConfig(id);

    return teams.map((t) => ({
      name: t.name,
      members: t.userList.map((u) => ({
        accountId: u.userID,
        nickname: u.nickname,
      })),
    }));
  }

  async getPlayersConfig(
    tournamentId: string | number
  ): Promise<PlayerConfig[]> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;

    // selfIdentityInfo returns the tournament's enrolled roster. identity 3
    // marks organisers/staff (e.g. the admin account), so we keep only
    // competitors and de-duplicate by userID.
    const response = await this.service.getSelfIdentityInfo(id);
    const seen = new Set<number>();
    const players: PlayerConfig[] = [];
    for (const p of response.data ?? []) {
      if (p.identity === 3 || seen.has(p.userID)) {
        continue;
      }
      seen.add(p.userID);
      players.push({ accountId: p.userID, nickname: p.nickname });
    }
    return players;
  }

  async startGame(
    tournamentId: string | number,
    playerAccountIds: number[]
  ): Promise<boolean> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;

    return this.service.startGame(id, playerAccountIds);
  }

  async getOngoingGames(tournamentId: string | number): Promise<OngoingGame[]> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;

    const classifyID = await this.resolveInternalTournamentIdRaw(id);
    const response = await this.service.readOnlineRoom(classifyID);

    return (response.data ?? [])
      .filter((room) => !room.isEnd)
      .map((room) => ({
        gameId: room.roomId,
        tableId: room.roomId,
        players: room.players
          .filter((p) => p.robotLevel === 0)
          .map((p) => ({
            accountId: p.userId,
            nickname: p.nickname,
            seat: p.position,
          })),
        status: room.isPause
          ? OngoingGameStatus.Paused
          : OngoingGameStatus.Playing,
        startTime: room.startTime ? new Date(room.startTime * 1000) : undefined,
      }));
  }

  async addPlayersToTournament(
    tournamentId: string | number,
    players: Array<{ accountId: number; nickname: string }>
  ): Promise<{ success: number[]; failed: number[] }> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;

    const userIds = players.map((p) => p.accountId);
    await this.service.manageSelfUsers(id, userIds);

    return { success: userIds, failed: [] };
  }

  /**
   * Pauses a live room. Idempotent: returns true on RC code 0.
   * The gameId is the RC roomId; tournamentId is the RC matchID.
   *
   * RC's `controlSelfRoom` returns immediately, but `readOnlineRoom.isPause`
   * lags by 1–5 seconds. We poll until the new state is observable so that
   * downstream UI refreshes see the updated value.
   */
  async pauseGame(
    gameId: string,
    tournamentId: string | number
  ): Promise<boolean> {
    const ok = await this.controlRoom(
      gameId,
      tournamentId,
      RiichiCityRoomStatus.Pause
    );
    if (ok) {
      await this.waitForRoomPauseState(tournamentId, gameId, true);
    }
    return ok;
  }

  async resumeGame(
    gameId: string,
    tournamentId: string | number
  ): Promise<boolean> {
    const ok = await this.controlRoom(
      gameId,
      tournamentId,
      RiichiCityRoomStatus.Resume
    );
    if (ok) {
      await this.waitForRoomPauseState(tournamentId, gameId, false);
    }
    return ok;
  }

  /**
   * Terminates a live room (destructive). Idempotent: returns true on RC code 0.
   * The gameId is the RC roomId; tournamentId is the RC matchID.
   */
  async terminateGame(
    gameId: string,
    tournamentId: string | number
  ): Promise<boolean> {
    return this.controlRoom(
      gameId,
      tournamentId,
      RiichiCityRoomStatus.Terminate
    );
  }

  private async controlRoom(
    roomId: string,
    tournamentId: string | number,
    type: RiichiCityRoomStatus
  ): Promise<boolean> {
    const matchID =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;
    if (Number.isNaN(matchID)) {
      throw new Error(
        `RiichiCity: invalid tournamentId for controlRoom: ${tournamentId}`
      );
    }
    const response = await this.service.controlSelfRoom(matchID, roomId, type);
    return response.code === 0;
  }

  /**
   * Polls `readOnlineRoom` until the room's `isPause` flag matches the
   * expected value, or the timeout elapses. RC's lobby service accepts
   * pause/resume commands faster than its room/record service propagates
   * them; without this wait, an immediate refresh would still see the
   * stale state. Best-effort: silently returns on timeout so the caller
   * can proceed.
   */
  private async waitForRoomPauseState(
    tournamentId: string | number,
    roomId: string,
    expectedIsPause: boolean,
    timeoutMs = 8_000,
    pollIntervalMs = 500
  ): Promise<void> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;
    let classifyID: string;
    try {
      classifyID = await this.resolveInternalTournamentIdRaw(id);
    } catch {
      return;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const resp = await this.service.readOnlineRoom(classifyID);
        const room = (resp.data ?? []).find((r) => r.roomId === roomId);
        if (!room) {
          // Room is gone (e.g. finished); nothing to wait for.
          return;
        }
        if (room.isPause === expectedIsPause) {
          return;
        }
      } catch {
        // Transient read failure; keep polling until deadline.
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Saves a pre-defined set of table pairings on the Riichi City tournament
   * via `/lobbys/addSelfTableConfig` so admins can launch the tables from
   * within the Riichi City client. Acts as a fallback when the bot's own
   * launch flow is not used or fails.
   */
  async saveTablePairings(
    tournamentId: string | number,
    name: string,
    tables: Array<{ userID: number; nickname: string }[]>
  ): Promise<void> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;
    if (Number.isNaN(id)) {
      throw new Error(
        `RiichiCityLeagueConnector.saveTablePairings: invalid tournamentId ${tournamentId}`
      );
    }

    const response = await this.service.addSelfTableConfig(id, name, tables);
    if (response.code !== 0) {
      throw new Error(
        `RiichiCity addSelfTableConfig failed (code ${response.code}): ${response.message ?? "unknown"}`
      );
    }
  }

  /**
   * Deletes every saved self-table-config on a Riichi City tournament.
   * RC caps a tournament at 5 saved configs, so callers should clear before
   * pushing a fresh batch from `saveTablePairings`.
   */
  async clearTablePairings(tournamentId: string | number): Promise<number> {
    const id =
      typeof tournamentId === "string"
        ? parseInt(tournamentId, 10)
        : tournamentId;
    if (Number.isNaN(id)) {
      throw new Error(
        `RiichiCityLeagueConnector.clearTablePairings: invalid tournamentId ${tournamentId}`
      );
    }

    const list = await this.service.listSelfTableConfigs(id);
    if (list.code !== 0) {
      throw new Error(
        `RiichiCity selfTableConfigList failed (code ${list.code}): ${list.message ?? "unknown"}`
      );
    }

    let deleted = 0;
    for (const existing of list.data ?? []) {
      if (!existing?.configID) {
        continue;
      }
      const del = await this.service.delSelfTableConfig(id, existing.configID);
      if (del.code !== 0) {
        throw new Error(
          `RiichiCity delSelfTableConfig failed (code ${del.code}) for configID ${existing.configID}: ${del.message ?? "unknown"}`
        );
      }
      deleted += 1;
    }
    return deleted;
  }
}

function deriveStartTime(game: GameData): Date {
  const firstEvent = game.handRecord[0]?.handEventRecord[0];
  if (firstEvent?.startTime) {
    return new Date(firstEvent.startTime);
  }
  return new Date(game.nowTime * 1000);
}

/**
 * Reconstructs seat order from the order of `StartingHand` events
 * in the first round, then hydrates each seat's nickname from the
 * per-round `players` snapshot (keyed by `userId`). `players` is
 * carried inline on every `RoundData` returned by `getLog`, so
 * nicknames are available without a second round-trip.
 */
function deriveSeatOrder(game: GameData): {
  seatToUserId: string[];
  seatToNickname: string[];
} {
  const seatToUserId: string[] = [];
  const seatToNickname: string[] = [];
  const round0 = game.handRecord[0];
  if (!round0) {
    return { seatToUserId, seatToNickname };
  }

  const nicknameByUserId = new Map<string, string>();
  for (const p of round0.players ?? []) {
    nicknameByUserId.set(p.userId.toString(), p.nickname);
  }

  for (const event of round0.handEventRecord) {
    if (event.eventType === EventType.StartingHand) {
      const uid = event.userId.toString();
      if (!seatToUserId.includes(uid)) {
        seatToUserId.push(uid);
        seatToNickname.push(nicknameByUserId.get(uid) ?? "");
      }
    }
  }
  return { seatToUserId, seatToNickname };
}
