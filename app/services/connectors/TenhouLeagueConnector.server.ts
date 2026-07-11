import { TenhouService } from "~/api/tenhou/TenhouService.server";
import { parseTenhouLobbyLog } from "~/api/tenhou/parseTenhouLobbyLog";
import { parseTenhouXmlReplay } from "~/api/tenhou/replayAdapter";
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
import type { GameSummary } from "~/types/GameSummary";
import type { GameRecordData } from "~/api/majsoul/types/gameRecordData";
import type { ReplayLog } from "~/game/replay/types";

export class TenhouLeagueConnector implements ILeagueTournamentConnector {
  private static readonly GLOBAL_KEY = "__TenhouLeagueConnector__";

  static get instance(): TenhouLeagueConnector {
    if (!(globalThis as any)[TenhouLeagueConnector.GLOBAL_KEY]) {
      (globalThis as any)[TenhouLeagueConnector.GLOBAL_KEY] =
        new TenhouLeagueConnector();
    }
    return (globalThis as any)[TenhouLeagueConnector.GLOBAL_KEY];
  }

  get service(): TenhouService {
    return TenhouService.instance;
  }

  private constructor() {}

  // ---------------------------------------------------------------------------
  // Required methods
  // ---------------------------------------------------------------------------

  async getGameSummaries(
    tournamentId: string | number,
    options?: LeagueTournamentConnectorOptions
  ): Promise<GameSummary[]> {
    const lobbyId = String(tournamentId);
    const rawText = await this.service.fetchLobbyGameList(lobbyId);
    return parseTenhouLobbyLog(rawText, options?.knownGameIds);
  }

  async getGameRecord(gameId: string): Promise<GameRecordData | null> {
    const rawXml = await this.service.fetchGameLog(gameId);
    if (!rawXml) {
      return null;
    }
    const replay = parseTenhouXmlReplay(rawXml, gameId);
    // Tenhou identifies players by name; the replay seats carry the same
    // names the stats path used as `userId`.
    const seatToUserId: string[] = [];
    const seatToNickname: string[] = [];
    for (const seat of replay.seats) {
      seatToUserId[seat.seat] = seat.displayName;
      seatToNickname[seat.seat] = seat.displayName;
    }
    return buildGameRecordFromReplay({
      gameId,
      startTime: new Date(replay.startedAt),
      endTime: new Date(replay.endedAt),
      events: replay.events,
      seats: replay.seats,
      seatToUserId,
      seatToNickname,
    });
  }

  async getReplayLog(gameId: string): Promise<ReplayLog | null> {
    try {
      const rawXml = await this.service.fetchGameLog(gameId);
      if (!rawXml) {
        return null;
      }
      return parseTenhouXmlReplay(rawXml, gameId);
    } catch (error) {
      console.error(
        `TenhouLeagueConnector: failed to parse replay log ${gameId}`,
        error
      );
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Optional methods — lobby / status
  // ---------------------------------------------------------------------------

  async getTournamentLobbyStatus(
    tournamentId: string | number
  ): Promise<TournamentLobbyStatus | undefined> {
    const { idle, playing } = await this.service.fetchLobbyPlayers(
      String(tournamentId)
    );
    return {
      online: idle.length,
      ready: idle.length,
      inGame: playing.length,
    };
  }

  async getPlayerLobbyEntries(
    tournamentId: string | number,
    _options?: { seasonId?: string }
  ): Promise<PlayerLobbyEntry[]> {
    const { idle, playing } = await this.service.fetchLobbyPlayers(
      String(tournamentId)
    );
    const entries: PlayerLobbyEntry[] = [];
    for (const name of idle) {
      entries.push({ platformAccountId: name, status: "online" });
    }
    for (const name of playing) {
      entries.push({ platformAccountId: name, status: "in-game" });
    }
    return entries;
  }

  /**
   * Tenhou does not expose live game UUIDs (those are only generated when the
   * log is written), nor a paused state — so each ongoing "game" is reported
   * with a synthetic id derived from the lobby id and table index. Status is
   * always reported as `Playing`: if Tenhou lists a table in its `playing`
   * set, the game is by definition ongoing (Tenhou exposes no pause state and
   * no admin pause/resume/terminate controls).
   */
  async getOngoingGames(tournamentId: string | number): Promise<OngoingGame[]> {
    const lobbyId = String(tournamentId);
    const { playing } = await this.service.fetchLobbyPlayers(lobbyId);
    if (playing.length === 0) {
      return [];
    }
    const games: OngoingGame[] = [];
    for (let i = 0; i + 3 < playing.length; i += 4) {
      const tableIdx = Math.floor(i / 4);
      games.push({
        gameId: `${lobbyId}:table-${tableIdx}`,
        tableId: `table-${tableIdx}`,
        players: playing.slice(i, i + 4).map((name, seat) => ({
          accountId: name,
          nickname: name,
          seat,
        })),
        status: OngoingGameStatus.Playing,
      });
    }
    return games;
  }

  // ---------------------------------------------------------------------------
  // Optional methods — team & game management (not supported by Tenhou)
  // ---------------------------------------------------------------------------

  async setUsersInTeams(
    _tournamentId: string | number,
    _teams: TeamEntry[],
    _options?: { seasonId?: string }
  ): Promise<void> {
    // Tenhou does not support programmatic team management
  }

  async getTeamsConfig(
    _tournamentId: string | number,
    _options?: { seasonId?: string }
  ): Promise<TeamConfig[]> {
    // Tenhou does not expose team configuration
    return [];
  }

  async getPlayersConfig(
    tournamentId: string | number
  ): Promise<PlayerConfig[]> {
    // The tournament config's comma-separated MEMBER field holds the list
    // of registered players (by Tenhou username).
    const config = await this.service.fetchTournamentConfig(
      String(tournamentId)
    );
    const members = config.MEMBER
      ? config.MEMBER.split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
      : [];
    return members.map((name) => ({ accountId: name, nickname: name }));
  }

  async startGame(
    tournamentId: string | number,
    playerAccountIds: (number | string)[],
    _options?: {
      seasonId?: number;
      gameStartTime?: number;
      initPoints?: number[];
      shuffleSeats?: boolean;
    }
  ): Promise<boolean> {
    const playerNames = playerAccountIds.map(String);
    const { ok, missingPlayers } = await this.service.startLobbyGame(
      String(tournamentId),
      playerNames
    );
    if (!ok) {
      console.warn(
        `[Tenhou] startGame: players not found: ${missingPlayers.join(", ")}`
      );
    }
    return ok;
  }

  async addPlayersToTournament(
    tournamentId: string | number,
    players: Array<{ accountId: number | string; nickname: string }>,
    _options?: { seasonId?: number }
  ): Promise<{ success: (number | string)[]; failed: (number | string)[] }> {
    const lobbyId = String(tournamentId);

    // 1. Fetch current tournament config (includes EDITAUTH + current members)
    const config = await this.service.fetchTournamentConfig(lobbyId);

    // 2. Parse existing members from the comma-separated MEMBER field
    const existingMembers = config.MEMBER
      ? config.MEMBER.split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
      : [];

    const existingSet = new Set(existingMembers);

    // 3. Add new players (by username / nickname), skip duplicates
    const newNames = players
      .map((p) => String(p.accountId))
      .filter((name) => !existingSet.has(name));

    if (newNames.length === 0) {
      // All players already registered
      return {
        success: players.map((p) => p.accountId),
        failed: [],
      };
    }

    const updatedMembers = [...existingMembers, ...newNames];

    // 4. Push the updated member list
    await this.service.updateTournamentMembers(lobbyId, config, updatedMembers);

    return {
      success: players.map((p) => p.accountId),
      failed: [],
    };
  }
}
