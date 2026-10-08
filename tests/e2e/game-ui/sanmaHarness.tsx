import { useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "react-router";
import GameSpectateRoute from "../../../app/game/routes/spectate";
import ReplayRoute from "../../../app/routes/game/replay";
import { MobileReplayViewer } from "../../../mobile/src/replays/MobileReplayViewer";
import {
  GameSetupControls,
  buildGameSetup,
  initialGameSetupSelection,
} from "../../../app/game/components/GameSetupControls";
import { LocaleProvider } from "../../../app/contexts/LocaleContext";
import { ThemeProvider } from "../../../app/contexts/ThemeContext";
import { TelemetryProvider } from "../../../app/contexts/TelemetryContext";
import { useMatchStore } from "../../../app/game/client/store";
import "./responsiveHarness.css";
import "../../../mobile/src/mobile.css";

declare global {
  interface Window {
    __sanmaReplay?: ComponentProps<typeof ReplayRoute>["loaderData"];
  }
}

function Setup() {
  const [selection, setSelection] = useState(initialGameSetupSelection);
  const [error, setError] = useState<string | null>(null);
  return (
    <main style={{ padding: 24, maxWidth: 480 }}>
      <h1>Sanma acceptance fixture</h1>
      <GameSetupControls value={selection} onChange={setSelection} />
      <button
        type="button"
        onClick={() => {
          void (async () => {
            try {
              const setup = buildGameSetup("m-league", selection);
              const response = await fetch("/api/game/rooms", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(setup),
              });
              if (!response.ok) {
                throw new Error(`Creation failed: ${response.status}`);
              }
              window.location.assign("/sanma/spectate");
            } catch (reason) {
              setError(
                reason instanceof Error ? reason.message : String(reason)
              );
            }
          })();
        }}
      >
        Create table
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

function Evidence() {
  const state = useMatchStore();
  return (
    <output
      data-testid="sanma-state"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        zIndex: 100,
        fontSize: 10,
      }}
    >
      {JSON.stringify({
        playerCount: state.playerCount,
        handCount: state.hands.length,
        dealer: state.dealer,
        nukiCount: state.nukiTiles?.flat().length ?? 0,
      })}
    </output>
  );
}

function Harness() {
  const { mode } = useParams();
  if (mode === "setup") {
    return <Setup />;
  }
  if (mode === "spectate") {
    return (
      <>
        <GameSpectateRoute
          loaderData={{
            matchId: "browser-sanma",
            flag: { gameEnabled: true },
            tenhouRelay: true,
          }}
        />
        <Evidence />
      </>
    );
  }
  const data = window.__sanmaReplay;
  if (!data) {
    throw new Error("The authoritative replay fixture is missing");
  }
  if (mode === "replay") {
    return <ReplayRoute loaderData={data} />;
  }
  if (mode === "mobile") {
    return (
      <MobileReplayViewer
        log={data.log}
        seatEnrichment={[null, null, null]}
        review={null}
        loading={false}
        error={null}
        initialLocation={{ event: data.log.events.length - 1, seat: 0 }}
        onClose={() => undefined}
        onRetry={() => undefined}
      />
    );
  }
  throw new Error(`Unknown sanma fixture: ${mode}`);
}

const router = createBrowserRouter([
  {
    element: (
      <LocaleProvider initialLocale="en">
        <ThemeProvider>
          <TelemetryProvider>
            <Outlet />
          </TelemetryProvider>
        </ThemeProvider>
      </LocaleProvider>
    ),
    children: [{ path: "/sanma/:mode", element: <Harness /> }],
  },
]);
const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing sanma fixture root");
}
createRoot(root).render(<RouterProvider router={router} />);
