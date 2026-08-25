import {
  ArrowLeft,
  Bot,
  Check,
  Crown,
  LoaderCircle,
  Play,
  RefreshCw,
  User,
  UserMinus,
  Wifi,
} from "lucide-react";
import type { Seat } from "~/game/protocol/messages";
import type { OnlineMatchControllerState } from "./OnlineMatchController";

const SEAT_LABELS = ["East", "South", "West", "North"] as const;

interface MobileOnlineRoomProps {
  state: OnlineMatchControllerState;
  onBack: () => void;
  onReconnect: () => void;
  onReadyChange: (ready: boolean) => void;
  onAddBot: () => void;
  onKick: (seat: Seat) => void;
  onStart: () => void;
}

export function MobileOnlineRoom({
  state,
  onBack,
  onReconnect,
  onReadyChange,
  onAddBot,
  onKick,
  onStart,
}: MobileOnlineRoomProps) {
  const room = state.roomState;
  const isHost =
    room !== null && room.mySeat !== null && room.mySeat === room.hostSeat;
  const ownSeat =
    room?.mySeat === null || room?.mySeat === undefined
      ? null
      : room.seats[room.mySeat];
  const hasEmptySeat = room?.seats.some(
    ({ occupant }) => occupant.kind === "empty"
  );

  return (
    <main className="mobile-shell mobile-online-room">
      <header className="shell-topbar">
        <button
          type="button"
          className="shell-icon-button"
          aria-label="Leave online table"
          title="Leave online table"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div>
          <strong>{room === null ? "Opening table" : "Waiting room"}</strong>
          <span>{state.matchId ?? "Creating online game"}</span>
        </div>
        <div className={`online-room-connection online-room-${state.status}`}>
          {state.status === "creating" || state.status === "connecting" ? (
            <LoaderCircle aria-hidden="true" className="spin" />
          ) : (
            <Wifi aria-hidden="true" />
          )}
          <span>{state.status}</span>
        </div>
      </header>

      {room === null ? (
        <section className="online-room-opening" aria-live="polite">
          {state.status === "error" ? (
            <>
              <strong>Could not open this table</strong>
              <span>{state.error ?? "The online game is unavailable."}</span>
              {state.matchId !== null && (
                <button
                  type="button"
                  className="command-button"
                  onClick={onReconnect}
                >
                  <RefreshCw aria-hidden="true" />
                  <span>Reconnect</span>
                </button>
              )}
            </>
          ) : (
            <>
              <LoaderCircle aria-hidden="true" className="spin" />
              <strong>
                {state.status === "creating"
                  ? "Creating room"
                  : "Connecting to game server"}
              </strong>
            </>
          )}
        </section>
      ) : (
        <section className="online-waiting-layout">
          <ol className="online-seat-grid" aria-label="Players">
            {room.seats.map(({ seat, occupant, ready }) => {
              const occupied = occupant.kind !== "empty";
              const seatIsHost = seat === room.hostSeat;
              return (
                <li key={seat} className={occupied ? "occupied" : "empty"}>
                  <div className="online-seat-icon">
                    {occupant.kind === "bot" ? (
                      <Bot aria-hidden="true" />
                    ) : (
                      <User aria-hidden="true" />
                    )}
                  </div>
                  <div className="online-seat-copy">
                    <span>{SEAT_LABELS[seat]}</span>
                    <strong>
                      {occupied ? occupant.displayName : "Open seat"}
                    </strong>
                    {occupied && (
                      <small className={ready ? "ready" : undefined}>
                        {ready ? "Ready" : "Not ready"}
                      </small>
                    )}
                  </div>
                  {seatIsHost && (
                    <Crown
                      aria-label="Room host"
                      className="online-host-mark"
                    />
                  )}
                  {isHost &&
                    occupied &&
                    seat !== room.mySeat && (
                      <button
                        type="button"
                        className="online-seat-kick"
                        aria-label={`Remove ${occupant.displayName}`}
                        title={`Remove ${occupant.displayName}`}
                        onClick={() => onKick(seat)}
                      >
                        <UserMinus aria-hidden="true" />
                      </button>
                    )}
                </li>
              );
            })}
          </ol>

          <aside className="online-room-controls" aria-label="Room controls">
            <div>
              <span>Your seat</span>
              <strong>
                {room.mySeat === null
                  ? "Spectator"
                  : SEAT_LABELS[room.mySeat]}
              </strong>
              {state.error !== null && <small>{state.error}</small>}
            </div>
            {room.mySeat !== null && (
              <button
                type="button"
                className="command-button online-ready-button"
                aria-pressed={ownSeat?.ready ?? false}
                onClick={() => onReadyChange(!(ownSeat?.ready ?? false))}
              >
                <Check aria-hidden="true" />
                <span>{ownSeat?.ready ? "Ready" : "Ready up"}</span>
              </button>
            )}
            {isHost && (
              <>
                <button
                  type="button"
                  className="command-button"
                  disabled={!hasEmptySeat}
                  onClick={onAddBot}
                >
                  <Bot aria-hidden="true" />
                  <span>Add bot</span>
                </button>
                <button
                  type="button"
                  className="command-button online-start-button"
                  disabled={!room.canStart}
                  onClick={onStart}
                >
                  <Play aria-hidden="true" />
                  <span>Start game</span>
                </button>
              </>
            )}
            {!isHost && room.mySeat !== null && (
              <span className="online-host-wait">Waiting for host</span>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}