import { describe, expect, it } from "vitest";
import { parseTenhouLobbyLog } from "./parseTenhouLobbyLog";

describe("parseTenhouLobbyLog", () => {
  it("parses completed games whose rule type is 0009", () => {
    const raw = [
      "[2026/08/10 04:07:31] lobby=11017&type=0009&dan=11,0,7,5&rate=1662.15,1500.00,1598.60,1557.11&wg=167fafe2&log=2026081004gm-0009-11017-9b9f92d7&cmd=<CHAT text=\"#START East South West North\"/>",
      "[2026/08/10 04:38:26] lobby=11017&cmd=<CHAT text=\"#END North(+92.6) West(-0.9) East(-30.7) South(-61.0) \" />",
      "[2026/08/10 04:38:29] lobby=11017&type=0009&un=East,South,West,North&sc=-30.7,-61.0,-0.9,92.6&chip=",
    ].join("\r\n");

    const games = parseTenhouLobbyLog(raw);

    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      gameId: "2026081004gm-0009-11017-9b9f92d7",
      platform: "tenhou",
      startTime: new Date("2026-08-09T19:07:31.000Z"),
      endTime: new Date("2026-08-09T19:38:29.000Z"),
      players: [
        { nickname: "East", score: -30.7, place: 3, seat: 0 },
        { nickname: "South", score: -61, place: 4, seat: 1 },
        { nickname: "West", score: -0.9, place: 2, seat: 2 },
        { nickname: "North", score: 92.6, place: 1, seat: 3 },
      ],
    });
  });
});