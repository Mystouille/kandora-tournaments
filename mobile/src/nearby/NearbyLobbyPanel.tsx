import {
  Bot,
  Check,
  LoaderCircle,
  LogOut,
  Play,
  RadioTower,
  Search,
  Smartphone,
  User,
  X,
} from "lucide-react";
import type { LocalMatchControllerState } from "../local/LocalMatchController";
import type {
  NearbyIdentity,
  NearbyMatchControllerState,
} from "./NearbyMatchController";

interface NearbyLobbyPanelProps {
  state: NearbyMatchControllerState;
  localState: LocalMatchControllerState;
  identity: NearbyIdentity;
  busy: boolean;
  onDisplayNameChange: (displayName: string) => void;
  onPlaySolo: () => void;
  onHost: () => void;
  onDiscover: () => void;
  onResumeHost: () => void;
  onConnect: (endpointId: string) => void;
  onConfirmPairing: (endpointId: string) => void;
  onRejectPairing: (endpointId: string) => void;
  onStartMatch: () => void;
  onLeave: () => void;
}

export function NearbyLobbyPanel({
  state,
  localState,
  identity,
  busy,
  onDisplayNameChange,
  onPlaySolo,
  onHost,
  onDiscover,
  onResumeHost,
  onConnect,
  onConfirmPairing,
  onRejectPairing,
  onStartMatch,
  onLeave,
}: NearbyLobbyPanelProps) {
  const pairing = state.pairings[0];
  const room = state.roomState;

  if (state.role === "host" && state.status === "paused") {
    return (
      <aside className="nearby-panel" aria-label="Saved Nearby table">
        <div className="nearby-panel-heading">
          <RadioTower aria-hidden="true" />
          <div>
            <strong>Table saved</strong>
            <span>Host is paused</span>
          </div>
        </div>
        <div className="nearby-panel-actions">
          <button type="button" className="icon-button" onClick={onLeave}>
            <X aria-hidden="true" />
            <span className="sr-only">Close saved table</span>
          </button>
          <button
            type="button"
            className="command-button"
            disabled={busy}
            onClick={onResumeHost}
          >
            <Play aria-hidden="true" />
            <span>Resume host</span>
          </button>
        </div>
      </aside>
    );
  }

  if (pairing !== undefined) {
    return (
      <aside className="nearby-panel nearby-verification" aria-live="polite">
        <div className="nearby-panel-heading">
          <Smartphone aria-hidden="true" />
          <div>
            <strong>Verify device</strong>
            <span>{pairing.endpointName}</span>
          </div>
        </div>
        <output className="verification-code" aria-label="Pairing code">
          {pairing.authenticationDigits}
        </output>
        <div className="nearby-panel-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Reject pairing"
            title="Reject pairing"
            onClick={() => onRejectPairing(pairing.endpointId)}
          >
            <X aria-hidden="true" />
          </button>
          <button
            type="button"
            className="command-button command-button-confirm"
            onClick={() => onConfirmPairing(pairing.endpointId)}
          >
            <Check aria-hidden="true" />
            <span>Codes match</span>
          </button>
        </div>
      </aside>
    );
  }

  if (room !== null && room.status === "waiting") {
    const humanCount = room.seats.filter(
      (seat) => seat.occupant.kind === "human"
    ).length;
    return (
      <aside className="nearby-panel" aria-label="Nearby lobby">
        <div className="nearby-panel-heading">
          <RadioTower aria-hidden="true" />
          <div>
            <strong>{state.role === "host" ? "Your table" : "Nearby table"}</strong>
            <span>{humanCount} of 4 players</span>
          </div>
        </div>
        <ol className="nearby-seat-list">
          {room.seats.map(({ seat, occupant }) => (
            <li key={seat}>
              {occupant.kind === "bot" ? (
                <Bot aria-hidden="true" />
              ) : (
                <User aria-hidden="true" />
              )}
              <span>
                {occupant.kind === "empty"
                  ? "Open seat"
                  : occupant.displayName}
              </span>
              {occupant.kind === "human" && (
                <i className={occupant.connected ? "online" : undefined} />
              )}
            </li>
          ))}
        </ol>
        <div className="nearby-panel-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Leave Nearby table"
            title="Leave Nearby table"
            onClick={onLeave}
          >
            <LogOut aria-hidden="true" />
          </button>
          {state.role === "host" ? (
            <button
              type="button"
              className="command-button"
              disabled={busy}
              onClick={onStartMatch}
            >
              <Play aria-hidden="true" />
              <span>Start with {4 - humanCount} bots</span>
            </button>
          ) : (
            <span className="nearby-waiting-label">Waiting for host</span>
          )}
        </div>
      </aside>
    );
  }

  if (state.role === "guest") {
    const connecting =
      state.status === "connecting" || state.status === "pairing";
    return (
      <aside className="nearby-panel" aria-label="Find Nearby table">
        <div className="nearby-panel-heading">
          {connecting ? (
            <LoaderCircle aria-hidden="true" className="spin" />
          ) : (
            <Search aria-hidden="true" />
          )}
          <div>
            <strong>{connecting ? "Connecting" : "Tables nearby"}</strong>
            <span>
              {state.error ??
                (state.discovered.length === 0
                  ? "Searching"
                  : `${state.discovered.length} found`)}
            </span>
          </div>
        </div>
        <div className="nearby-endpoint-list">
          {state.discovered.map((endpoint) => (
            <button
              key={endpoint.endpointId}
              type="button"
              disabled={connecting}
              onClick={() => onConnect(endpoint.endpointId)}
            >
              <Smartphone aria-hidden="true" />
              <span>{endpoint.endpointName}</span>
            </button>
          ))}
        </div>
        <div className="nearby-panel-actions">
          <button type="button" className="icon-button" onClick={onLeave}>
            <X aria-hidden="true" />
            <span className="sr-only">Stop searching</span>
          </button>
          {state.status === "disconnected" && (
            <button
              type="button"
              className="command-button"
              onClick={onDiscover}
            >
              <Search aria-hidden="true" />
              <span>Search again</span>
            </button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="nearby-panel" aria-label="Local play setup">
      <div className="nearby-panel-heading">
        <RadioTower aria-hidden="true" />
        <div>
          <strong>Play nearby</strong>
          <span>
            {state.error ??
              (state.available ? "Choose a table" : "Native app required")}
          </span>
        </div>
      </div>
      <label className="nearby-name-field">
        <span>Player name</span>
        <input
          type="text"
          maxLength={40}
          value={identity.displayName}
          disabled={busy}
          onChange={(event) => onDisplayNameChange(event.target.value)}
        />
      </label>
      <div className="nearby-choice-grid">
        <button
          type="button"
          disabled={busy}
          onClick={onPlaySolo}
        >
          <Play aria-hidden="true" />
          <span>
            {localState.status === "paused" ? "Resume solo" : "Solo"}
          </span>
        </button>
        <button
          type="button"
          disabled={busy || !state.available || identity.displayName.trim() === ""}
          onClick={onHost}
        >
          <RadioTower aria-hidden="true" />
          <span>Host</span>
        </button>
        <button
          type="button"
          disabled={busy || !state.available || identity.displayName.trim() === ""}
          onClick={onDiscover}
        >
          <Search aria-hidden="true" />
          <span>Join</span>
        </button>
      </div>
    </aside>
  );
}