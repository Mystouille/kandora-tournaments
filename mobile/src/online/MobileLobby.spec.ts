import { describe, expect, it } from "vitest";
import { roomAction, roomOccupancy, type MobileLobbyRoom } from "./MobileLobby";

function room(status: MobileLobbyRoom["status"]): MobileLobbyRoom {
  return {
    matchId: "room-1",
    status,
    presetId: "m-league",
    buuMode: false,
    seats: [
      { name: "Alice", isBot: false },
      null,
      { name: "South", isBot: true },
      null,
    ],
  };
}

describe("mobile online lobby room policy", () => {
  it("joins waiting rooms and watches playing rooms", () => {
    expect(roomAction(room("waiting"))).toBe("join");
    expect(roomAction(room("playing"))).toBe("watch");
    expect(roomAction(room("finished"))).toBeNull();
  });

  it("counts occupied human and bot seats", () => {
    expect(roomOccupancy(room("waiting"))).toBe("2/4");
  });
});
