import { createRoot } from "react-dom/client";
import { seatValues } from "../../../app/game/rules/seats";
import { MobileGameMenu } from "../../../mobile/src/game/MobileGameMenu";
import { NearbyLobbyPanel } from "../../../mobile/src/nearby/NearbyLobbyPanel";
import { INITIAL_NEARBY_MATCH_STATE } from "../../../mobile/src/nearby/NearbyMatchController";
import { MobileLobby } from "../../../mobile/src/online/MobileLobby";
import { MobileOnlineRoom } from "../../../mobile/src/online/MobileOnlineRoom";
import { INITIAL_ONLINE_MATCH_STATE } from "../../../mobile/src/online/OnlineMatchController";
import { ResumeActiveGameModal } from "../../../mobile/src/online/ResumeActiveGameModal";
import { MobileReplayNavigationMenu } from "../../../mobile/src/replays/MobileReplayViewer";
import { MobileReplays } from "../../../mobile/src/replays/MobileReplays";
import "../../../mobile/src/mobile.css";

const noop = (): void => undefined;

function Harness() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (mode === "lobby") {
    return (
      <MobileLobby
        webAppBaseUrl={window.location.origin}
        activeMatchId={null}
        onBack={noop}
        onCreateGame={noop}
        onJoinGame={noop}
        onReconnectGame={noop}
        onWatchGame={noop}
        onWatchTenhouGame={noop}
      />
    );
  }
  if (mode === "online-room") {
    return (
      <MobileOnlineRoom
        state={{
          ...INITIAL_ONLINE_MATCH_STATE,
          status: "waiting",
          matchId: "mobile-responsive-room",
          mode: "player",
          roomState: {
            type: "room_state",
            matchId: "mobile-responsive-room",
            status: "waiting",
            mySeat: 0,
            hostSeat: 0,
            canStart: true,
            seats: seatValues(4, (seat) => ({
              seat,
              occupant: {
                kind: "human" as const,
                userId: `user-${seat}`,
                displayName: `Player ${seat + 1}`,
                connected: true,
              },
              ready: true,
            })),
          },
        }}
        onBack={noop}
        onReconnect={noop}
        onTakeover={noop}
        onReadyChange={noop}
        onAddBot={noop}
        onKick={noop}
        onStart={noop}
      />
    );
  }
  if (mode === "nearby") {
    return (
      <main className="mobile-shell mobile-shell-nearby">
        <header className="shell-topbar">
          <button type="button" className="shell-icon-button">
            Back
          </button>
          <div>
            <strong>Nearby</strong>
            <span>Solo play</span>
          </div>
        </header>
        <section className="shell-nearby-content">
          <NearbyLobbyPanel
            state={INITIAL_NEARBY_MATCH_STATE}
            localState={{ status: "idle", matchId: null, error: null }}
            identity={{ deviceId: "fixture", displayName: "Player" }}
            busy={false}
            onDisplayNameChange={noop}
            onPlaySolo={noop}
            onHost={noop}
            onDiscover={noop}
            onResumeHost={noop}
            onConnect={noop}
            onReadyChange={noop}
            onAddBot={noop}
            onKick={noop}
            onStartMatch={noop}
            onLeave={noop}
          />
        </section>
      </main>
    );
  }
  if (mode === "replays") {
    return (
      <MobileReplays
        replayStore={null}
        storageState="memory"
        webAppBaseUrl={null}
        authSession={null}
        authPending={false}
        onBack={noop}
        onSignIn={noop}
        onUnauthorized={noop}
        onOpenReplay={noop}
      />
    );
  }
  if (mode === "game-menu") {
    return (
      <main className="mobile-game-view">
        <MobileGameMenu
          expanded
          flags={{
            autoDiscard: false,
            autoWin: false,
            autoSort: false,
            noCall: false,
            compactLayout: false,
          }}
          handTop={null}
          onExpandedChange={noop}
          onLeftChange={noop}
          onToggle={noop}
        />
      </main>
    );
  }
  if (mode === "replay-menu") {
    return (
      <main className="mobile-game-view">
        <MobileReplayNavigationMenu
          expanded
          handTop={null}
          events={[]}
          seatNames={["East", "South", "West", "North"]}
          index={-1}
          focusSeat={0}
          rounds={[]}
          bounds={{ min: -1, max: -1 }}
          commentIndices={[]}
          onExpandedChange={noop}
          onFocusSeatChange={noop}
          onGoTo={noop}
          onStep={noop}
        />
      </main>
    );
  }
  if (mode === "resume-modal") {
    return (
      <ResumeActiveGameModal
        activeMatch={{
          matchId: "active-mobile-responsive-room",
          status: "playing",
          connected: true,
        }}
        busy={false}
        onResume={noop}
        onDecline={noop}
      />
    );
  }
  throw new Error(`Unknown mobile UI fixture: ${mode}`);
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Mobile responsive harness root is missing.");
}
createRoot(root).render(<Harness />);
