import {
  ArrowLeft,
  Eye,
  LoaderCircle,
  Plus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { webAppPath } from "../shell";

const LobbyPresetSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
});

const LobbyRoomSchema = z.object({
  matchId: z.string(),
  status: z.enum(["waiting", "playing", "finished"]),
  presetId: z.string().optional(),
  buuMode: z.boolean(),
  seats: z.array(
    z
      .object({ name: z.string().nullable(), isBot: z.boolean() })
      .nullable()
  ),
});

const MobileLobbyResponseSchema = z.object({
  presets: z.array(LobbyPresetSchema),
  rooms: z.array(LobbyRoomSchema),
});

export type MobileLobbyPreset = z.infer<typeof LobbyPresetSchema>;
export type MobileLobbyRoom = z.infer<typeof LobbyRoomSchema>;

export function roomOccupancy(room: MobileLobbyRoom): string {
  const occupied = room.seats.filter((seat) => seat !== null).length;
  return `${occupied}/4`;
}

export function roomAction(room: MobileLobbyRoom): "join" | "watch" | null {
  if (room.status === "waiting") {
    return "join";
  }
  if (room.status === "playing") {
    return "watch";
  }
  return null;
}

interface MobileLobbyProps {
  webAppBaseUrl: string;
  onBack: () => void;
  onOpenWeb: (url: string) => Promise<void>;
}

export function MobileLobby({
  webAppBaseUrl,
  onBack,
  onOpenWeb,
}: MobileLobbyProps) {
  const [presets, setPresets] = useState<MobileLobbyPreset[]>([]);
  const [rooms, setRooms] = useState<MobileLobbyRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("m-league");

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
      setSelectedPreset((current) =>
        data.presets.some((preset) => preset.id === current)
          ? current
          : (data.presets[0]?.id ?? current)
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
    const action = roomAction(room);
    if (action === null) {
      return;
    }
    const path =
      action === "join"
        ? `/game/${encodeURIComponent(room.matchId)}`
        : `/spectate/${encodeURIComponent(room.matchId)}`;
    void onOpenWeb(webAppPath(webAppBaseUrl, path));
  };

  const createGame = (): void => {
    setCreateOpen(false);
    void onOpenWeb(
      webAppPath(
        webAppBaseUrl,
        `/mobile/game/create?preset=${encodeURIComponent(selectedPreset)}`
      )
    );
  };

  const presetNames = new Map(
    presets.map((preset) => [preset.id, preset.displayName])
  );

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
          disabled={presets.length === 0}
          onClick={() => setCreateOpen(true)}
        >
          <Plus aria-hidden="true" />
          <span>Create a game</span>
        </button>

        <section className="available-games" aria-labelledby="available-games-title">
          <div className="online-section-heading">
            <div>
              <h2 id="available-games-title">Available games</h2>
              <span>{rooms.length} open table{rooms.length === 1 ? "" : "s"}</span>
            </div>
          </div>

          {loading && rooms.length === 0 ? (
            <div className="lobby-empty" aria-live="polite">
              <LoaderCircle aria-hidden="true" className="spin" />
              <span>Loading games</span>
            </div>
          ) : error !== null && rooms.length === 0 ? (
            <div className="lobby-empty lobby-error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          ) : rooms.length === 0 ? (
            <div className="lobby-empty">
              <span>No games available.</span>
            </div>
          ) : (
            <ul className="online-room-list">
              {rooms.map((room) => {
                const action = roomAction(room);
                return (
                  <li key={room.matchId}>
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
                        <span className={`room-state room-state-${room.status}`}>
                          {room.status}
                        </span>
                      </div>
                      <span>
                        {roomOccupancy(room)} · {room.matchId}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="room-action-button"
                      disabled={action === null}
                      onClick={() => openRoom(room)}
                    >
                      {action === "watch" ? "Watch" : "Join"}
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
            <div className="rule-options" role="radiogroup" aria-label="Rules">
              {presets.map((preset) => (
                <label key={preset.id}>
                  <input
                    type="radio"
                    name="mobile-rule-preset"
                    value={preset.id}
                    checked={selectedPreset === preset.id}
                    onChange={() => setSelectedPreset(preset.id)}
                  />
                  <span>
                    <strong>{preset.displayName}</strong>
                    {preset.description && <small>{preset.description}</small>}
                  </span>
                </label>
              ))}
            </div>
            <footer>
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
                onClick={createGame}
              >
                Create game
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
