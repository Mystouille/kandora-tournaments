import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, useParams } from "react-router";
import LobbyRoute from "../../../app/game/routes/lobby";
import type { GameSetup } from "../../../app/game/rules/gameSetup";
import { listSelectablePresets } from "../../../app/game/rules/presets";
import { MobileLobby } from "../../../mobile/src/online/MobileLobby";
import { NearbyLobbyPanel } from "../../../mobile/src/nearby/NearbyLobbyPanel";
import { INITIAL_NEARBY_MATCH_STATE } from "../../../mobile/src/nearby/NearbyMatchController";
import "./responsiveHarness.css";

if (!window.location.pathname.endsWith("/web")) {
  await import("../../../mobile/src/mobile.css");
}

function Harness() {
  const { surface } = useParams();
  const [created, setCreated] = useState<GameSetup | null>(null);
  if (surface === "web") {
    return <LobbyRoute />;
  }
  return (
    <>
      {surface === "mobile" ? (
        <MobileLobby
          webAppBaseUrl={window.location.origin}
          activeMatchId={null}
          onBack={() => {}}
          onCreateGame={setCreated}
          onJoinGame={() => {}}
          onReconnectGame={() => {}}
          onWatchGame={() => {}}
          onWatchTenhouGame={() => {}}
        />
      ) : (
        <div className="mobile-shell" style={{ overflowY: "auto" }}>
          <NearbyLobbyPanel
            state={{ ...INITIAL_NEARBY_MATCH_STATE, available: true }}
            localState={{ status: "idle", matchId: null, error: null }}
            identity={{ deviceId: "lobby-test-host", displayName: "Host" }}
            busy={new URLSearchParams(window.location.search).has("busy")}
            onDisplayNameChange={() => {}}
            onPlaySolo={(setup) => {
              if (setup) {
                setCreated(setup);
              }
            }}
            onHost={setCreated}
            onDiscover={() => {}}
            onResumeHost={() => {}}
            onConnect={() => {}}
            onReadyChange={() => {}}
            onAddBot={() => {}}
            onKick={() => {}}
            onStartMatch={() => {}}
            onLeave={() => {}}
          />
        </div>
      )}
      {created && (
        <output
          data-testid="created-setup"
          style={{ position: "fixed", bottom: 0, left: 0 }}
        >
          {JSON.stringify(created)}
        </output>
      )}
    </>
  );
}

const router = createBrowserRouter([
  {
    path: "/lobby-setup/:surface",
    loader: () => ({
      flag: { gameEnabled: true },
      presets: listSelectablePresets(),
      tenhouLiveGames: [],
      gameLogs: [],
    }),
    element: <Harness />,
  },
]);
const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing lobby setup fixture root");
}
createRoot(root).render(<RouterProvider router={router} />);
