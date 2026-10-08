import { describe, expect, it } from "vitest";
import {
  MobileLobbyResponseSchema,
  roomAction,
  roomOccupancy,
  type MobileLobbyRoom,
} from "./MobileLobby";

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

  it("offers reconnect for the authenticated user's playing room", () => {
    expect(roomAction(room("playing"), "room-1")).toBe("reconnect");
    expect(roomAction(room("playing"), "room-2")).toBe("watch");
    expect(roomAction(room("waiting"), "room-1")).toBeNull();
  });

  it("counts occupied human and bot seats", () => {
    expect(roomOccupancy(room("waiting"))).toBe("2/4");
  });

  it("uses explicit three-player capacity and does not offer a fourth place", () => {
    const sanma: MobileLobbyRoom = {
      ...room("waiting"),
      playerCount: 3,
      sanmaType: "kansai",
      seats: [
        { name: "East", isBot: false },
        { name: "South", isBot: true },
        null,
      ],
    };
    expect(roomOccupancy(sanma)).toBe("2/3");
    expect(roomAction(sanma)).toBe("join");
    sanma.seats[2] = { name: "West", isBot: false };
    expect(roomOccupancy(sanma)).toBe("3/3");
    expect(roomAction(sanma)).toBeNull();
  });

  it("keeps partial legacy listings four-player", () => {
    expect(
      roomOccupancy({
        ...room("waiting"),
        seats: [{ name: "East", isBot: false }],
      })
    ).toBe("1/4");
  });
});

describe("mobile lobby monitored-game response", () => {
  const game = {
    watchId: "WATCH123",
    leagueName: "TNT LEAGUE V",
    startTime: null,
    players: [
      { seat: 0, displayName: "East" },
      { seat: 1, displayName: "South" },
    ],
  };

  it("accepts monitored Tenhou games with no native rooms or relay match ID", () => {
    const data = MobileLobbyResponseSchema.parse({
      presets: [],
      rooms: [],
      tenhouLiveGames: [game],
    });

    expect(data.tenhouLiveGames).toEqual([game]);
    expect(data.rooms).toEqual([]);
  });

  it("preserves native rooms alongside monitored tournament games", () => {
    const data = MobileLobbyResponseSchema.parse({
      presets: [],
      rooms: [room("playing")],
      tenhouLiveGames: [game],
    });

    expect(data.rooms).toEqual([room("playing")]);
    expect(data.tenhouLiveGames).toEqual([game]);
  });

  it("keeps older web deployments compatible with native rooms", () => {
    const data = MobileLobbyResponseSchema.parse({
      presets: [],
      rooms: [room("waiting")],
    });

    expect(data.tenhouLiveGames).toEqual([]);
    expect(data.rooms).toEqual([room("waiting")]);
  });

  it("rejects unusable watch targets instead of offering a broken Watch action", () => {
    expect(() =>
      MobileLobbyResponseSchema.parse({
        presets: [],
        rooms: [],
        tenhouLiveGames: [{ ...game, watchId: "" }],
      })
    ).toThrow();
  });

  it.each(["online", "kansai"] as const)(
    "does not strip %s sanma or Duplicate room metadata",
    (sanmaType) => {
      const sanma = {
        ...room("waiting"),
        playerCount: 3,
        sanmaType,
        mode: { type: "duplicate", seed: "Board", generationVersion: 1 },
        seats: [null, null, null],
      };
      const data = MobileLobbyResponseSchema.parse({
        presets: [],
        rooms: [sanma],
      });
      expect(data.rooms).toEqual([sanma]);
      expect(roomOccupancy(data.rooms[0])).toBe("0/3");
    }
  );
});
