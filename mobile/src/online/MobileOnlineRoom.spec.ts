import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { seatValues } from "~/game/rules/seats";
import { INITIAL_ONLINE_MATCH_STATE } from "./OnlineMatchController";
import { MobileOnlineRoom } from "./MobileOnlineRoom";

describe("mobile online waiting room", () => {
  it.each(["online", "kansai"] as const)(
    "renders exactly three %s seats with Duplicate metadata",
    (sanmaType) => {
      const html = renderToStaticMarkup(
        createElement(MobileOnlineRoom, {
          state: {
            ...INITIAL_ONLINE_MATCH_STATE,
            status: "waiting",
            matchId: "three",
            mode: "player",
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
          },
          onBack: vi.fn(),
          onReconnect: vi.fn(),
          onTakeover: vi.fn(),
          onReadyChange: vi.fn(),
          onAddBot: vi.fn(),
          onKick: vi.fn(),
          onStart: vi.fn(),
        })
      );
      expect(html.match(/class="online-seat-icon"/g)).toHaveLength(3);
      expect(html).toContain("East");
      expect(html).toContain("South");
      expect(html).toContain("West");
      expect(html).not.toContain("North");
      expect(html).toContain(
        `Sanma · ${sanmaType === "online" ? "Online" : "Kansai"}`
      );
      expect(html).toContain("Duplicate · Board");
    }
  );
});
