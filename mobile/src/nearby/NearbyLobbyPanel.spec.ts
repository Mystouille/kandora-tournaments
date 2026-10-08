import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_NEARBY_MATCH_STATE } from "./NearbyMatchController";
import { NearbyLobbyPanel } from "./NearbyLobbyPanel";
import { seatValues } from "~/game/rules/seats";

function props(): ComponentProps<typeof NearbyLobbyPanel> {
  return {
    state: INITIAL_NEARBY_MATCH_STATE,
    localState: { status: "idle", matchId: null, error: null },
    identity: { deviceId: "mobile:host", displayName: "Host" },
    busy: false,
    onDisplayNameChange: vi.fn(),
    onPlaySolo: vi.fn(),
    onHost: vi.fn(),
    onDiscover: vi.fn(),
    onResumeHost: vi.fn(),
    onConnect: vi.fn(),
    onReadyChange: vi.fn(),
    onAddBot: vi.fn(),
    onKick: vi.fn(),
    onStartMatch: vi.fn(),
    onLeave: vi.fn(),
  };
}

describe("Nearby lobby panel", () => {
  it("offers the shared pre-start settings for both local and Nearby, keeping Tenhou selected", () => {
    const html = renderToStaticMarkup(createElement(NearbyLobbyPanel, props()));
    expect(html).toContain("Rules for a new table");
    expect(html).toContain('value="tenhou-hanchan" selected=""');
    expect(html).toContain("3-player");
    expect(html).toContain("Duplicate mode");
    expect(html).toContain(">Solo</span>");
    expect(html).toContain(">Host</span>");
    expect(html).not.toContain('name="sanmaType"');
  });

  it.each(["online", "kansai"] as const)(
    "shows only three places and the %s variant",
    (sanmaType) => {
      const config = props();
      config.state = {
        ...INITIAL_NEARBY_MATCH_STATE,
        role: "host",
        status: "lobby",
        roomState: {
          type: "room_state",
          matchId: "three",
          status: "waiting",
          playerCount: 3,
          sanmaType,
          mode: { type: "duplicate", seed: "Board", generationVersion: 1 },
          mySeat: 0,
          hostSeat: 0,
          canStart: false,
          seats: seatValues(3, (seat) => ({
            seat,
            occupant: { kind: "empty" as const },
            ready: false,
          })),
        },
      };
      const html = renderToStaticMarkup(
        createElement(NearbyLobbyPanel, config)
      );
      expect(html).toContain("0 of 3 players");
      expect(html).toContain(
        `Sanma · ${sanmaType === "online" ? "Online" : "Kansai"}`
      );
      expect(html).toContain("Duplicate · Board");
      expect(html.match(/<li>/g)).toHaveLength(3);
      expect(html).not.toContain("of 4 players");
    }
  );

  it("makes clear that resuming uses the saved setup", () => {
    const config = props();
    config.localState = { status: "paused", matchId: "saved", error: null };
    const html = renderToStaticMarkup(createElement(NearbyLobbyPanel, config));
    expect(html).toContain("Resume solo");
    expect(html).toContain("saved table");
  });

  it("shows connection progress without a verification-code step", () => {
    const html = renderToStaticMarkup(
      createElement(NearbyLobbyPanel, {
        state: {
          ...INITIAL_NEARBY_MATCH_STATE,
          role: "guest",
          status: "connecting",
          discovered: [
            { endpointId: "host-endpoint", endpointName: "Host's table" },
          ],
        },
        localState: { status: "idle", matchId: null, error: null },
        identity: { deviceId: "mobile:guest", displayName: "Guest" },
        busy: false,
        onDisplayNameChange: vi.fn(),
        onPlaySolo: vi.fn(),
        onHost: vi.fn(),
        onDiscover: vi.fn(),
        onResumeHost: vi.fn(),
        onConnect: vi.fn(),
        onReadyChange: vi.fn(),
        onAddBot: vi.fn(),
        onKick: vi.fn(),
        onStartMatch: vi.fn(),
        onLeave: vi.fn(),
      })
    );

    expect(html).toContain("Connecting");
    expect(html).not.toContain("Verify device");
    expect(html).not.toContain("Pairing code");
    expect(html).not.toContain("Codes match");
  });
});
