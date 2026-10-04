import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "react-router";
import GameMatchRoute from "../../../app/game/routes/match";
import GameSpectateRoute from "../../../app/game/routes/spectate";
import ReplayRoute from "../../../app/routes/game/replay";
import { LocaleProvider } from "../../../app/contexts/LocaleContext";
import { ThemeProvider } from "../../../app/contexts/ThemeContext";
import { TelemetryProvider } from "../../../app/contexts/TelemetryContext";
import { WebTableTopControls } from "../../../app/game/client/WebTableTopControls";
import { ViewerList } from "../../../app/game/components/ViewerList";
import { ClockQualityNotice } from "../../../app/game/components/ClockQualityNotice";
import {
  fixtureMatchId,
  fixtureReplayData,
  fixtureViewers,
} from "./responsiveFixture";
import "./responsiveHarness.css";

function Harness() {
  const { mode } = useParams();
  if (mode === "match") {
    return (
      <GameMatchRoute
        loaderData={{ matchId: fixtureMatchId, flag: { gameEnabled: true } }}
      />
    );
  }
  if (mode === "spectate") {
    return (
      <GameSpectateRoute
        loaderData={{
          matchId: fixtureMatchId,
          flag: { gameEnabled: true },
          tenhouRelay: true,
        }}
      />
    );
  }
  if (mode === "replay") {
    return <ReplayRoute loaderData={fixtureReplayData} />;
  }
  if (mode === "unscaled") {
    return (
      <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
        <WebTableTopControls
          compactLayout={false}
          onCompactLayoutChange={() => {}}
          onQuit={() => {}}
          quitLabel="Quit fixture"
        />
        <ClockQualityNotice clockEpoch="unscaled-fixture" />
        <div style={{ position: "absolute", top: 64 }}>
          <ViewerList viewers={fixtureViewers} expanded onToggle={() => {}} />
        </div>
      </div>
    );
  }
  throw new Error(`Unknown responsive game UI fixture: ${mode}`);
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
    children: [{ path: "/ui/:mode", element: <Harness /> }],
  },
]);

const root = document.getElementById("root");
if (!root) {
  throw new Error("Responsive game UI harness root is missing.");
}
createRoot(root).render(<RouterProvider router={router} />);
