import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import {
  composeRoundMessage,
  type ResolvedRound,
  type ResolvedSeat,
  type PlayerReadyMap,
  type TableRender,
} from "./schedulingMessageService.server";

const oid = (hex: string) => new mongoose.Types.ObjectId(hex.padStart(24, "0"));

const seat = (overrides: Partial<ResolvedSeat> = {}): ResolvedSeat => ({
  teamIndex: 1,
  playerIndex: 1,
  userId: oid("11"),
  teamName: "Team A",
  userName: "Alice",
  discordId: null,
  platformName: "alice_ms",
  platformAccountId: "1001",
  substituteType: null,
  ...overrides,
});

describe("composeRoundMessage", () => {
  it("renders the team - player (platform) line format", () => {
    const resolved: ResolvedRound = [[seat()]];

    const msg = composeRoundMessage("qf", 0, 3, resolved, "upcoming");

    expect(msg).toContain("**QF — Round 1/3** ⏳ Waiting for players");
    expect(msg).toContain("__Table 1__");
    expect(msg).toContain("Team A - **Alice** (*alice_ms*)");
  });

  it("uses a Discord mention when available, bold name otherwise", () => {
    const resolved: ResolvedRound = [
      [
        seat({ discordId: "123" }),
        seat({ discordId: null, userName: "Bob", platformName: "bob_ms" }),
      ],
    ];

    const msg = composeRoundMessage("qf", 0, 1, resolved, "upcoming");

    expect(msg).toContain("Team A - <@123> (*alice_ms*)");
    expect(msg).toContain("Team A - **Bob** (*bob_ms*)");
  });

  it("keeps the substitute emoji after the platform username", () => {
    const resolved: ResolvedRound = [
      [
        seat({ substituteType: "official" }),
        seat({
          substituteType: "team",
          userName: "Bob",
          platformName: "bob_ms",
        }),
      ],
    ];

    const msg = composeRoundMessage("qf", 0, 1, resolved, "in_progress");

    expect(msg).toContain("(*alice_ms*) 🆘");
    expect(msg).toContain("(*bob_ms*) 👥");
  });

  it("shows live ready icons from the readyMap", () => {
    const resolved: ResolvedRound = [[seat({ platformAccountId: "1001" })]];
    const readyMap: PlayerReadyMap = { "1001": "ready" };

    const msg = composeRoundMessage(
      "qf",
      0,
      1,
      resolved,
      "in_progress",
      readyMap
    );

    expect(msg).toContain("✅ Team A - **Alice**");
  });

  it("marks a finished table with a checkmark and per-player deltas on the left", () => {
    const resolved: ResolvedRound = [
      [
        seat({ userId: oid("11"), userName: "Alice" }),
        seat({
          userId: oid("22"),
          userName: "Bob",
          teamName: "Team B",
          platformName: "bob_ms",
        }),
      ],
    ];
    const tableRenders: TableRender[] = [
      {
        state: "finished",
        deltaByUserId: new Map([
          [oid("11").toString(), 45],
          [oid("22").toString(), -15],
        ]),
      },
    ];

    const msg = composeRoundMessage(
      "qf",
      0,
      1,
      resolved,
      "completed",
      undefined,
      tableRenders
    );

    expect(msg).toContain("__Table 1__ ✅");
    expect(msg).toContain("`+45.0` Team A - **Alice** (*alice_ms*)");
    expect(msg).toContain("`-15.0` Team B - **Bob** (*bob_ms*)");
  });

  it("pads deltas so scores align and a missing score is an em dash", () => {
    const resolved: ResolvedRound = [
      [
        seat({ userId: oid("11") }),
        seat({ userId: oid("22") }),
        seat({ userId: oid("33") }),
      ],
    ];
    const tableRenders: TableRender[] = [
      {
        state: "finished",
        deltaByUserId: new Map([
          [oid("11").toString(), 5],
          [oid("22").toString(), -15],
          // oid("33") has no delta — renders as a padded em dash.
        ]),
      },
    ];

    const msg = composeRoundMessage(
      "qf",
      0,
      1,
      resolved,
      "completed",
      undefined,
      tableRenders
    );

    // Width is 5 ("-15.0"); shorter entries are right-aligned within backticks.
    expect(msg).toContain("` +5.0`");
    expect(msg).toContain("`-15.0`");
    expect(msg).toContain("`    —`");
  });

  it("renders the waiting-for-log state with a header label and hourglasses", () => {
    const resolved: ResolvedRound = [
      [
        seat({ userId: oid("11") }),
        seat({ userId: oid("22"), userName: "Bob" }),
      ],
    ];
    const tableRenders: TableRender[] = [{ state: "waiting-log" }];
    const readyMap: PlayerReadyMap = { "1001": "ready" };

    const msg = composeRoundMessage(
      "qf",
      0,
      1,
      resolved,
      "in_progress",
      readyMap,
      tableRenders
    );

    expect(msg).toContain("__Table 1__ — waiting for game log");
    expect(msg).toContain("⌛ Team A - **Alice**");
    // The lobby ready icon is suppressed while waiting for the log.
    expect(msg).not.toContain("✅ Team A");
  });

  it("aligns per-table render states to tables by index", () => {
    const resolved: ResolvedRound = [
      [seat({ userId: oid("11") })],
      [seat({ userId: oid("22") })],
      [seat({ userId: oid("33"), platformAccountId: "3003" })],
    ];
    const tableRenders: TableRender[] = [
      {
        state: "finished",
        deltaByUserId: new Map([[oid("11").toString(), 12]]),
      },
      { state: "waiting-log" },
      { state: "live" },
    ];
    const readyMap: PlayerReadyMap = { "3003": "in-game" };

    const msg = composeRoundMessage(
      "sf",
      1,
      2,
      resolved,
      "in_progress",
      readyMap,
      tableRenders
    );

    expect(msg).toContain("**SF — Round 2/2** ▶️ In Progress");
    expect(msg).toContain("__Table 1__ ✅");
    expect(msg).toContain("`+12.0`");
    expect(msg).toContain("__Table 2__ — waiting for game log");
    expect(msg).toContain("⌛ Team A");
    expect(msg).toContain("🎮 Team A");
  });
});
