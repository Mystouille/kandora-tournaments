import {
  type OngoingGame,
  OngoingGameStatus,
} from "./connectors/ILeagueTournamentConnector.server";

/** Discord button styles (REST API numeric values). */
const BUTTON_STYLE_PRIMARY = 1;
const BUTTON_STYLE_SECONDARY = 2;
const BUTTON_STYLE_DANGER = 4;
/** Discord component types. */
const COMPONENT_TYPE_ACTION_ROW = 1;
const COMPONENT_TYPE_BUTTON = 2;

/** customId prefix for ongoing-game action buttons. */
export const ONGOING_GAME_BUTTON_PREFIX = "ongoing-game";
/** customId prefix for the confirmation modal. */
export const ONGOING_GAME_CONFIRM_MODAL_PREFIX = "ongoing-game-confirm";

export type OngoingGameAction = "pause" | "resume" | "terminate";

export interface RenderedPlayer {
  accountId: string;
  /** Pre-formatted human label (mention or composite name + platform username). */
  displayLabel: string;
  /** Raw platform nickname (kept for diagnostics; not used for rendering). */
  nickname?: string;
  teamName?: string;
}

export interface ComposeOngoingGameMessageInput {
  leagueId: string;
  game: Pick<OngoingGame, "gameId" | "status" | "startTime"> & {
    players: RenderedPlayer[];
  };
  isTeamMode: boolean;
  supportsPause: boolean;
  supportsResume: boolean;
  supportsTerminate: boolean;
  /** When set, appended as a small Discord relative-timestamp footer. */
  lastUpdated?: Date;
}

export interface RenderedOngoingGameMessage {
  content: string;
  components: Record<string, unknown>[];
}

/**
 * Builds the customId for an ongoing-game action button.
 *
 * Format: `ongoing-game:<action>:<leagueId>:<gameId>`. The leagueId and gameId
 * are colon-free in practice (Mongo ObjectId hex / Majsoul UUID / RC roomId);
 * Tenhou's synthetic ids contain a colon (`lobbyId:table-N`) but the modal
 * handler reconstructs the gameId by re-joining everything past index 3.
 */
export function buildButtonCustomId(
  action: OngoingGameAction,
  leagueId: string,
  gameId: string
): string {
  return `${ONGOING_GAME_BUTTON_PREFIX}:${action}:${leagueId}:${gameId}`;
}

/**
 * Builds the customId for the confirmation modal opened by clicking a button.
 */
export function buildConfirmModalCustomId(
  action: OngoingGameAction,
  leagueId: string,
  gameId: string
): string {
  return `${ONGOING_GAME_CONFIRM_MODAL_PREFIX}:${action}:${leagueId}:${gameId}`;
}

/**
 * Parses an ongoing-game button or confirm-modal customId.
 * Returns null if the prefix doesn't match.
 */
export function parseOngoingGameCustomId(
  customId: string
): { action: OngoingGameAction; leagueId: string; gameId: string } | null {
  const parts = customId.split(":");
  if (parts.length < 4) {
    return null;
  }
  if (
    parts[0] !== ONGOING_GAME_BUTTON_PREFIX &&
    parts[0] !== ONGOING_GAME_CONFIRM_MODAL_PREFIX
  ) {
    return null;
  }
  const action = parts[1] as OngoingGameAction;
  if (action !== "pause" && action !== "resume" && action !== "terminate") {
    return null;
  }
  const leagueId = parts[2];
  // Re-join trailing parts to support gameIds containing colons (Tenhou).
  const gameId = parts.slice(3).join(":");
  if (!leagueId || !gameId) {
    return null;
  }
  return { action, leagueId, gameId };
}

function statusLabel(status: OngoingGameStatus): string {
  switch (status) {
    case OngoingGameStatus.Playing:
      return "▶️ Playing";
    case OngoingGameStatus.Paused:
      return "⏸ Paused";
    default:
      return "❓ Unknown";
  }
}

/**
 * Composes the Discord message payload (content + components) for one ongoing
 * game. Pure function — no I/O.
 */
export function composeOngoingGameMessage(
  input: ComposeOngoingGameMessageInput
): RenderedOngoingGameMessage {
  const { game, isTeamMode, leagueId } = input;

  const startLine = game.startTime
    ? `Started: <t:${Math.floor(game.startTime.getTime() / 1000)}:R>`
    : "Started: —";

  const playerLines = game.players.map((p) => {
    if (isTeamMode && p.teamName) {
      return `• ${p.displayLabel} — *${p.teamName}*`;
    }
    return `• ${p.displayLabel}`;
  });

  const content = [
    `**Game** \`${game.gameId}\``,
    startLine,
    `Status: ${statusLabel(game.status)}`,
    "",
    "Players:",
    ...(playerLines.length > 0 ? playerLines : ["• (no players)"]),
    ...(input.lastUpdated
      ? [
          "",
          `-# Last refreshed <t:${Math.floor(input.lastUpdated.getTime() / 1000)}:R>`,
        ]
      : []),
  ].join("\n");

  const buttons: Record<string, unknown>[] = [];
  if (game.status === OngoingGameStatus.Paused && input.supportsResume) {
    buttons.push({
      type: COMPONENT_TYPE_BUTTON,
      style: BUTTON_STYLE_PRIMARY,
      label: "Resume",
      custom_id: buildButtonCustomId("resume", leagueId, game.gameId),
    });
  } else if (game.status === OngoingGameStatus.Playing && input.supportsPause) {
    buttons.push({
      type: COMPONENT_TYPE_BUTTON,
      style: BUTTON_STYLE_SECONDARY,
      label: "Pause",
      custom_id: buildButtonCustomId("pause", leagueId, game.gameId),
    });
  }
  if (input.supportsTerminate) {
    buttons.push({
      type: COMPONENT_TYPE_BUTTON,
      style: BUTTON_STYLE_DANGER,
      label: "Terminate",
      custom_id: buildButtonCustomId("terminate", leagueId, game.gameId),
    });
  }

  const components =
    buttons.length > 0
      ? [{ type: COMPONENT_TYPE_ACTION_ROW, components: buttons }]
      : [];

  return { content, components };
}
