import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLocation: () => ({ pathname: "/statistics", search: "?tab=games" }),
  };
});

vi.mock("../../contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: { statistics: { bracketWatchReplay: "Watch replay" } },
  }),
}));

vi.mock("../../contexts/TelemetryContext", () => ({
  useTelemetry: () => ({ track: mocks.track }),
}));

import { WatchLiveButton } from "./WatchLiveButton";
import { WatchReplayButton } from "./WatchReplayButton";

describe("statistics App Links", () => {
  it("renders replay navigation as an anchor with its return path", () => {
    const markup = renderToStaticMarkup(
      createElement(WatchReplayButton, { gameId: "game/1" })
    );

    expect(markup).toContain(
      'href="/watch/replay/game%2F1?from=%2Fstatistics%3Ftab%3Dgames"'
    );
  });

  it("renders live spectating as an anchor without a delay parameter", () => {
    const markup = renderToStaticMarkup(
      createElement(WatchLiveButton, {
        watchId: "WATCH/123",
        leagueSlug: "league/one",
      })
    );

    expect(markup).toContain(
      'href="/watch/live/WATCH%2F123?returnTo=%2Fonline-tournaments%2Fleague%252Fone%2Fstatistics"'
    );
    expect(markup).not.toContain("delay=");
  });
});