import { describe, expect, it } from "vitest";
import { parseTenhouWatchGames } from "./TenhouService.server";

describe("parseTenhouWatchGames", () => {
  // Real captured `cmd_get_wg.cgi` body (one ongoing game, 4 seated players).
  const LIVE_SAMPLE =
    'sw([\r\n"4332F684,8,03:00,9,SjNmZjN6,0,1500.00,QmVub2l0,13,1777.85,ZXdlbWF4,11,1662.15,VXJpZWw=,10,1589.11"\r\n]);';

  it("extracts the watch-id and base64 seat-ordered players", () => {
    const games = parseTenhouWatchGames(LIVE_SAMPLE);
    expect(games).toHaveLength(1);
    expect(games[0].watchId).toBe("4332F684");
    expect(games[0].players).toEqual(["J3ff3z", "Benoit", "ewemax", "Uriel"]);
    expect(games[0].ratings).toEqual([1500, 1777.85, 1662.15, 1589.11]);
  });

  it("parses multiple ongoing games", () => {
    const raw =
      'sw([\n"4332F684,8,03:00,9,SjNmZjN6,0,1500.00,QmVub2l0,13,1777.85,ZXdlbWF4,11,1662.15,VXJpZWw=,10,1589.11",\n"A1B2C3D4,1,00:30,2,SjNmZjN6,0,1500.00,QmVub2l0,13,1777.85,ZXdlbWF4,11,1662.15,VXJpZWw=,10,1589.11"\n]);';
    const games = parseTenhouWatchGames(raw);
    expect(games.map((g) => g.watchId)).toEqual(["4332F684", "A1B2C3D4"]);
  });

  it("returns [] for empty / no-game / malformed responses", () => {
    expect(parseTenhouWatchGames("sw([]);")).toEqual([]);
    expect(parseTenhouWatchGames("")).toEqual([]);
    expect(parseTenhouWatchGames("garbage")).toEqual([]);
    expect(parseTenhouWatchGames('sw(["too,few,fields"]);')).toEqual([]);
  });
});
