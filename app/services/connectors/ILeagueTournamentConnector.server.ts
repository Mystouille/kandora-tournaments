import type { GameSummary } from "~/types/GameSummary";
import type { GameRecordData } from "~/api/majsoul/types/gameRecordData";
import type { League } from "~/db/League";
import type { ReplayLog } from "~/game/replay/types";

export interface TournamentLobbyStatus {
  online?: number;
  ready: number;
  inGame: number;
}

/** Per-player status entry from the tournament lobby. */
export interface PlayerLobbyEntry {
  platformAccountId: number | string;
  status: "online" | "ready" | "in-game" | "offline";
}

export interface TeamEntry {
  name: string;
  members: Array<{
    accountId: number;
    nickname: string;
    /**
     * Optional pre-resolved platform account ID. On Majsoul, `accountId`
     * is historically a friend ID and the connector resolves it to a real
     * account ID via a WebSocket roundtrip per member; when this field is
     * provided the connector can skip that lookup entirely.
     */
    resolvedAccountId?: number;
  }>;
}

export interface TeamConfig {
  name: string;
  members: Array<{ accountId: number; nickname: string }>;
}

/** A single player registered in an individual (non-team) tournament. */
export interface PlayerConfig {
  accountId: number | string;
  nickname: string;
}

export interface LeagueTournamentConnectorOptions {
  internalTournamentId?: string | number;
  /** Game IDs already fully processed (have a GameRecord). Connectors may
   *  skip expensive log fetches for these. */
  knownGameIds?: Set<string>;
}

/**
 * Platform-agnostic interface for fetching game data from a tournament.
 * Implement for each platform (Mahjong Soul, Riichi City, …).
 */
export interface ILeagueTournamentConnector {
  /**
   * Optional hook called before getGameSummaries to resolve any
   * platform-specific options (e.g. internal tournament IDs).
   */
  resolveOptions?(
    league: League
  ): Promise<LeagueTournamentConnectorOptions | undefined>;

  /**
   * Returns a lightweight summary for every finished game in the tournament.
   * Used to create / validate Game documents.
   */
  getGameSummaries(
    tournamentId: string | number,
    options?: LeagueTournamentConnectorOptions
  ): Promise<GameSummary[]>;

  /**
   * Returns the full per-round statistical data for a single game.
   * Returns null when the log is unavailable or parsing fails.
   * Used to create GameRecord documents.
   */
  getGameRecord(gameId: string): Promise<GameRecordData | null>;

  /**
   * Phase 4.5: returns the cross-platform `ReplayLog` for a single
   * game by fetching the raw platform log and piping it through
   * `app/api/<platform>/replayAdapter.ts`. Returns `null` when the
   * raw log is unavailable or parsing fails. Optional capability:
   * connectors that don't support replays (e.g. IRL adapters)
   * simply omit it.
   */
  getReplayLog?(gameId: string): Promise<ReplayLog | null>;

  /**
   * Returns a snapshot of how many players are online, ready, or in-game
   * in the tournament lobby.  Returns undefined when the platform does
   * not support this query.
   */
  getTournamentLobbyStatus?(
    tournamentId: string | number,
    options?: { tenhouBotId?: string }
  ): Promise<TournamentLobbyStatus | undefined>;

  /**
   * Returns per-player lobby status for the tournament.
   * Used by the scheduling worker to show ready indicators.
   */
  getPlayerLobbyEntries?(
    tournamentId: string | number,
    options?: { seasonId?: string }
  ): Promise<PlayerLobbyEntry[]>;

  /**
   * Sets the full team configuration for a tournament (teams + members).
   * On platforms that require multiple calls (e.g. Majsoul), this
   * orchestrates create-teams then add-members sequentially.
   */
  setUsersInTeams?(
    tournamentId: string | number,
    teams: TeamEntry[],
    options?: { seasonId?: string }
  ): Promise<void>;

  /**
   * Fetches the current team configuration (teams + members)
   * from the platform.
   */
  getTeamsConfig?(
    tournamentId: string | number,
    options?: { seasonId?: string }
  ): Promise<TeamConfig[]>;

  /**
   * Fetches the flat list of individual players registered in a
   * (non-team) tournament from the platform. Used by the roster import
   * for individual-mode leagues, where players are not grouped into
   * teams. Returns undefined/omitted when the platform cannot list the
   * tournament's individual players.
   */
  getPlayersConfig?(
    tournamentId: string | number,
    options?: { seasonId?: string }
  ): Promise<PlayerConfig[]>;

  /**
   * Schedule / start a game table in the platform's tournament.
   * Returns true if the game was successfully scheduled.
   */
  startGame?(
    tournamentId: string | number,
    playerAccountIds: (number | string)[],
    options?: {
      seasonId?: number;
      gameStartTime?: number;
      initPoints?: number[];
      shuffleSeats?: boolean;
    }
  ): Promise<boolean>;

  /**
   * Registers players into the tournament on the platform so they can
   * join the lobby and be seated in games.
   */
  addPlayersToTournament?(
    tournamentId: string | number,
    players: Array<{ accountId: number | string; nickname: string }>,
    options?: { seasonId?: number }
  ): Promise<{
    success: (number | string)[];
    failed: (number | string)[];
  }>;

  /**
   * Returns the list of currently ongoing (not-yet-finished) games in the
   * tournament, including their playing/paused status.
   * Returns undefined when the platform does not support live game listing.
   */
  getOngoingGames?(
    tournamentId: string | number
  ): Promise<OngoingGame[] | undefined>;

  /**
   * Pauses an ongoing game on the platform. Idempotent: returns true if the
   * game is (or was already) paused. The gameId is the platform-native
   * identifier (e.g. Majsoul game UUID, Riichi City roomId). The
   * tournamentId provides the lobby/contest context some platforms require
   * (e.g. Riichi City needs the matchID alongside the roomID).
   * Capability detection: check `typeof connector.pauseGame === "function"`.
   */
  pauseGame?(gameId: string, tournamentId: string | number): Promise<boolean>;

  /**
   * Resumes a paused game on the platform. Idempotent: returns true if the
   * game is (or was already) playing.
   * Capability detection: check `typeof connector.resumeGame === "function"`.
   */
  resumeGame?(gameId: string, tournamentId: string | number): Promise<boolean>;

  /**
   * Terminates an ongoing game on the platform (destructive). Returns true on
   * success. The gameId / tournamentId conventions match {@link pauseGame}.
   * Capability detection: check `typeof connector.terminateGame === "function"`.
   */
  terminateGame?(
    gameId: string,
    tournamentId: string | number
  ): Promise<boolean>;
}

/** A currently-in-progress game on the platform, with playing/paused status. */
export interface OngoingGame {
  /** Platform-native game identifier (raw, no platform prefix). */
  gameId: string;
  /** Optional table/lobby identifier when distinct from gameId. */
  tableId?: string | number;
  players: Array<{
    accountId: number | string;
    nickname?: string;
    seat?: number;
  }>;
  status: OngoingGameStatus;
  startTime?: Date;
  pausedAt?: Date;
}

// OngoingGameStatus now lives in the kandora-core schema package (app/db) so the
// OngoingGameMessage model can reference it without depending on this connector.
import { OngoingGameStatus } from "~/db/types/ongoing-game-status";
export { OngoingGameStatus };
