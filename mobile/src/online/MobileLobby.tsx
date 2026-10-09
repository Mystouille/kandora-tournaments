import { ArrowLeft, Eye, LoaderCircle, Plus, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { SpectatorDelaySelect } from "~/game/components/SpectatorDelaySelect";
import {
  buildGameSetup,
  DEFAULT_GAME_SETUP_PRESET_ID,
  GameSetupControls,
  gameVariantLabel,
  initialGameSetupSelection,
} from "~/game/components/GameSetupControls";
import { GameVariantMetadata } from "~/game/protocol/seat";
import { MatchModeConfigSchema } from "~/game/protocol/matchMode";
import type { GameSetup } from "~/game/rules/gameSetup";
import {
  SpectatorDelayMsSchema,
  spectatorDelayLabel,
  type SpectatorDelayMs,
} from "~/game/protocol/spectatorDelay";
import { webAppPath } from "../shell";

const LobbyPresetSchema = z.object({
  id: z.string(),
  rulesFamily: z.enum(["riichi", "mcr"]).default("riichi"),
  displayName: z.string(),
  description: z.string().optional(),
});

const LobbyRoomSchema = z.object({
  matchId: z.string(),
  status: z.enum(["waiting", "playing", "finished"]),
  presetId: z.string().optional(),
  ...GameVariantMetadata,
  mode: MatchModeConfigSchema.optional(),
  buuMode: z.boolean(),
  spectatorDelayMs: SpectatorDelayMsSchema.optional(),
  seats: z.array(
    z.object({ name: z.string().nullable(), isBot: z.boolean() }).nullable()
  ),
});

const TenhouLiveGameSchema = z.object({
  watchId: z.string().min(1),
  leagueName: z.string(),
  startTime: z.number().nullable(),
  players: z.array(
    z.object({
      seat: z.number().int().min(0).max(3),
      displayName: z.string(),
    })
  ),
});

export const MobileLobbyResponseSchema = z.object({
  presets: z.array(LobbyPresetSchema),
  rooms: z.array(LobbyRoomSchema),
  // Older web deployments still return only native rooms.
  tenhouLiveGames: z.array(TenhouLiveGameSchema).default([]),
});

export type MobileLobbyPreset = z.infer<typeof LobbyPresetSchema>;
export type MobileLobbyRoom = z.infer<typeof LobbyRoomSchema>;
type TenhouLiveGame = z.infer<typeof TenhouLiveGameSchema>;

export function roomOccupancy(room: MobileLobbyRoom): string {
  const capacity = room.playerCount ?? 4;
  const occupied = room.seats
    .slice(0, capacity)
    .filter((seat) => seat !== null).length;
  return `${occupied}/${capacity}`;
}

export function roomAction(
  room: MobileLobbyRoom,
  activeMatchId: string | null = null
): "join" | "watch" | "reconnect" | null {
  if (room.status === "waiting") {
    const capacity = room.playerCount ?? 4;
    const occupied = room.seats
      .slice(0, capacity)
      .filter((seat) => seat !== null).length;
    return activeMatchId === null && occupied < capacity ? "join" : null;
  }
  if (room.status === "playing") {
    return room.matchId === activeMatchId ? "reconnect" : "watch";
  }
  return null;
}

interface MobileLobbyProps {
  webAppBaseUrl: string;
  onBack: () => void;
  onCreateGame: (setup: GameSetup) => void;
  onJoinGame: (matchId: string) => void;
  onReconnectGame: (matchId: string) => void;
  onWatchGame: (matchId: string) => void;
  onWatchTenhouGame: (watchId: string) => void;
  activeMatchId: string | null;
}

export function MobileLobby({
  webAppBaseUrl,
  onBack,
  onCreateGame,
  onJoinGame,
  onReconnectGame,
  onWatchGame,
  onWatchTenhouGame,
  activeMatchId,
}: MobileLobbyProps) {
  const [presets, setPresets] = useState<MobileLobbyPreset[]>([]);
  const [rooms, setRooms] = useState<MobileLobbyRoom[]>([]);
  const [tenhouLiveGames, setTenhouLiveGames] = useState<TenhouLiveGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(
    DEFAULT_GAME_SETUP_PRESET_ID
  );
  const [setupSelection, setSetupSelection] = useState(
    initialGameSetupSelection
  );
  const [spectatorDelayMs, setSpectatorDelayMs] = useState<SpectatorDelayMs>(0);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const response = await fetch(
        webAppPath(webAppBaseUrl, "/api/mobile/lobby"),
        { headers: { accept: "application/json" }, cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error(`Lobby unavailable (${response.status})`);
      }
      const data = MobileLobbyResponseSchema.parse(await response.json());
      setPresets(data.presets);
      setRooms(data.rooms.filter((room) => room.status !== "finished"));
      setTenhouLiveGames(data.tenhouLiveGames);
      const riichiPresets = data.presets.filter(
        (preset) => preset.rulesFamily === "riichi"
      );
      setSelectedPreset((current) =>
        riichiPresets.some((preset) => preset.id === current)
          ? current
          : (riichiPresets.find(
              (preset) => preset.id === DEFAULT_GAME_SETUP_PRESET_ID
            )?.id ??
            riichiPresets[0]?.id ??
            current)
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lobby unavailable");
    } finally {
      setLoading(false);
    }
  }, [webAppBaseUrl]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const openRoom = (room: MobileLobbyRoom): void => {
    const action = roomAction(room, activeMatchId);
    if (action === null) {
      return;
    }
    if (action === "reconnect") {
      onReconnectGame(room.matchId);
    } else if (action === "join") {
      onJoinGame(room.matchId);
    } else {
      onWatchGame(room.matchId);
    }
  };

  const createGame = (): void => {
    if (activeMatchId !== null) {
      return;
    }
    try {
      const setup = buildGameSetup(
        selectedPreset,
        setupSelection,
        spectatorDelayMs
      );
      setError(null);
      setCreateOpen(false);
      onCreateGame(setup);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid game setup");
    }
  };

  const presetNames = new Map(
    presets.map((preset) => [preset.id, preset.displayName])
  );
  const gameCount = rooms.length + tenhouLiveGames.length;

  return (
    <main className="mobile-shell mobile-online-lobby">
      <header className="shell-topbar">
        <button
          type="button"
          className="shell-icon-button"
          aria-label="Back to home"
          title="Back to home"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div>
          <strong>Lobby</strong>
          <span>Online tables</span>
        </div>
      </header>

      <section className="online-lobby-content">
        <button
          type="button"
          className="create-game-button"
          disabled={presets.length === 0 || activeMatchId !== null}
          onClick={() => setCreateOpen(true)}
        >
          <Plus aria-hidden="true" />
          <span>Create a game</span>
        </button>

        <section
          className="available-games"
          aria-labelledby="available-games-title"
        >
          <div className="online-section-heading">
            <div>
              <h2 id="available-games-title">Available games</h2>
              <span>
                {gameCount} open table{gameCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {error !== null && (
            <div className="lobby-empty lobby-error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          )}
          {loading && gameCount === 0 ? (
            <div className="lobby-empty" aria-live="polite">
              <LoaderCircle aria-hidden="true" className="spin" />
              <span>Loading games</span>
            </div>
          ) : gameCount === 0 ? (
            error === null && (
              <div className="lobby-empty">
                <span>No games available.</span>
              </div>
            )
          ) : (
            <ul className="online-room-list">
              {tenhouLiveGames.map((game) => (
                <li key={`tenhou:${game.watchId}`}>
                  <div className="room-status-icon">
                    <Eye aria-hidden="true" />
                  </div>
                  <div className="room-copy">
                    <div>
                      <strong>{game.leagueName}</strong>
                      <span className="room-state room-state-playing">
                        Live
                      </span>
                    </div>
                    <span
                      title={game.players
                        .map((player) => player.displayName)
                        .join(" · ")}
                    >
                      Tenhou ·{" "}
                      {game.players
                        .map((player) => player.displayName)
                        .join(" · ")}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="room-action-button"
                    aria-label={`Watch ${game.leagueName} on Tenhou`}
                    onClick={() => onWatchTenhouGame(game.watchId)}
                  >
                    Watch
                  </button>
                </li>
              ))}
              {rooms.map((room) => {
                const action = roomAction(room, activeMatchId);
                return (
                  <li
                    key={room.matchId}
                    className={
                      action === "reconnect" ? "active-player-room" : undefined
                    }
                  >
                    <div className="room-status-icon">
                      {action === "watch" ? (
                        <Eye aria-hidden="true" />
                      ) : (
                        <Users aria-hidden="true" />
                      )}
                    </div>
                    <div className="room-copy">
                      <div>
                        <strong>
                          {presetNames.get(room.presetId ?? "") ??
                            room.presetId ??
                            "Mahjong"}
                        </strong>
                        <span
                          className={`room-state room-state-${room.status}`}
                        >
                          {room.status}
                        </span>
                      </div>
                      <span>
                        {roomOccupancy(room)} · {room.matchId}
                        {gameVariantLabel(room) &&
                          ` · ${gameVariantLabel(room)}`}
                        {room.mode?.type === "duplicate" &&
                          ` · Duplicate · ${room.mode.seed}`}
                        {" · "}Spectators:{" "}
                        {spectatorDelayLabel(room.spectatorDelayMs ?? 0)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="room-action-button"
                      disabled={action === null}
                      onClick={() => openRoom(room)}
                    >
                      {action === "watch"
                        ? "Watch"
                        : action === "reconnect"
                          ? "Reconnect"
                          : action === "join"
                            ? "Join"
                            : activeMatchId === null &&
                                room.status === "waiting"
                              ? "Room full"
                              : "Unavailable"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </section>

      {createOpen && (
        <div className="rule-modal-backdrop" role="presentation">
          <section
            className="rule-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rule-modal-title"
          >
            <header>
              <div>
                <h2 id="rule-modal-title">Create a game</h2>
                <span>Select the rules for this table.</span>
              </div>
              <button
                type="button"
                className="shell-icon-button"
                aria-label="Close rule selection"
                title="Close rule selection"
                onClick={() => setCreateOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="rule-modal-scroll">
              <GameSetupControls
                value={setupSelection}
                onChange={setSetupSelection}
                presets={presets}
                preset={selectedPreset}
                onPresetChange={setSelectedPreset}
                disabled={activeMatchId !== null}
                mobile
              />
              {error !== null && (
                <p role="alert" className="lobby-error">
                  {error}
                </p>
              )}
            </div>
            <footer className="create-game-footer">
              <label className="mobile-spectator-delay">
                <span>Spectator delay</span>
                <SpectatorDelaySelect
                  value={spectatorDelayMs}
                  onChange={setSpectatorDelayMs}
                  disabled={activeMatchId !== null}
                />
              </label>
              <div className="create-game-footer-actions">
                <button
                  type="button"
                  className="home-secondary-action"
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="home-primary-action create-confirm-button"
                  disabled={activeMatchId !== null}
                  onClick={createGame}
                >
                  Create game
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
