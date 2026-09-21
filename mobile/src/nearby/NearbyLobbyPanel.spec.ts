import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_NEARBY_MATCH_STATE } from "./NearbyMatchController";
import { NearbyLobbyPanel } from "./NearbyLobbyPanel";

describe("Nearby lobby panel", () => {
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
