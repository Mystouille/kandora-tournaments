import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import {
  buildPersistedTables,
  reprojectTables,
  type PersistedTable,
} from "./persistedTables";

const oid = (hex: string) => new mongoose.Types.ObjectId(hex.padStart(24, "0"));

describe("buildPersistedTables", () => {
  it("maps resolved seats to userId/teamId, marking substitutes", () => {
    const participants = [{ id: oid("a1") }, { id: oid("a2") }];
    const resolved = [
      [
        { teamIndex: 1, userId: oid("11"), substituteType: null },
        { teamIndex: 2, userId: oid("22"), substituteType: "team" as const },
      ],
    ];

    const tables = buildPersistedTables(resolved, participants);

    expect(tables).toHaveLength(1);
    expect(tables[0].tableIndex).toBe(0);
    expect(tables[0].gameId).toBeNull();
    expect(tables[0].wasInGame).toBe(false);
    expect(tables[0].seats[0]).toMatchObject({
      seatIndex: 0,
      isSub: false,
      subType: null,
    });
    expect(tables[0].seats[0].teamId?.toString()).toBe(oid("a1").toString());
    expect(tables[0].seats[1]).toMatchObject({ isSub: true, subType: "team" });
  });

  it("uses the participant id as the seat's teamId (individual mode)", () => {
    const participants = [{ id: oid("a1") }];
    const resolved = [
      [{ teamIndex: 1, userId: oid("11"), substituteType: null }],
    ];

    const tables = buildPersistedTables(resolved, participants);

    expect(tables[0].seats[0].teamId?.toString()).toBe(oid("a1").toString());
  });
});

describe("reprojectTables", () => {
  const seat = (seatIndex: number, userHex: string) => ({
    seatIndex,
    teamId: null,
    userId: oid(userHex),
    isSub: false,
    subType: null,
  });

  it("adopts fresh seating wholesale when nothing is persisted yet", () => {
    const fresh: PersistedTable[] = [
      { tableIndex: 0, gameId: null, wasInGame: false, seats: [seat(0, "11")] },
    ];

    const { tables, changed } = reprojectTables(undefined, fresh);

    expect(changed).toBe(true);
    expect(tables).toBe(fresh);
  });

  it("freezes a linked (played) table and ignores fresh seat changes", () => {
    const existing: PersistedTable[] = [
      { tableIndex: 0, gameId: "G1", wasInGame: true, seats: [seat(0, "11")] },
    ];
    // Fresh seating tries to change the occupant of the already-played table.
    const fresh: PersistedTable[] = [
      { tableIndex: 0, gameId: null, wasInGame: false, seats: [seat(0, "99")] },
    ];

    const { tables, changed } = reprojectTables(existing, fresh);

    expect(changed).toBe(false);
    expect(tables[0].gameId).toBe("G1");
    expect(tables[0].wasInGame).toBe(true);
    expect(tables[0].seats[0].userId.toString()).toBe(oid("11").toString());
  });

  it("adopts fresh seating for an unlinked table when occupants change", () => {
    const existing: PersistedTable[] = [
      { tableIndex: 0, gameId: null, wasInGame: false, seats: [seat(0, "11")] },
    ];
    const fresh: PersistedTable[] = [
      { tableIndex: 0, gameId: null, wasInGame: false, seats: [seat(0, "22")] },
    ];

    const { tables, changed } = reprojectTables(existing, fresh);

    expect(changed).toBe(true);
    expect(tables[0].seats[0].userId.toString()).toBe(oid("22").toString());
  });

  it("reports no change when unlinked seating is identical", () => {
    const existing: PersistedTable[] = [
      { tableIndex: 0, gameId: null, wasInGame: false, seats: [seat(0, "11")] },
    ];
    const fresh: PersistedTable[] = [
      { tableIndex: 0, gameId: null, wasInGame: false, seats: [seat(0, "11")] },
    ];

    const { changed } = reprojectTables(existing, fresh);

    expect(changed).toBe(false);
  });

  it("preserves a latched wasInGame flag on an unlinked table", () => {
    // The table was seen in-game in a prior cycle (wasInGame true) but isn't
    // linked yet; a fresh projection (wasInGame false) must not reset it.
    const existing: PersistedTable[] = [
      { tableIndex: 0, gameId: null, wasInGame: true, seats: [seat(0, "11")] },
    ];
    const fresh: PersistedTable[] = [
      { tableIndex: 0, gameId: null, wasInGame: false, seats: [seat(0, "11")] },
    ];

    const { tables, changed } = reprojectTables(existing, fresh);

    expect(changed).toBe(false);
    expect(tables[0].wasInGame).toBe(true);
  });
});
