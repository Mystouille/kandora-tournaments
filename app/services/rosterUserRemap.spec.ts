import { describe, expect, it } from "vitest";
import {
  RosterUserRemapError,
  selectExistingRosterUser,
  selectRosterIdentityOwner,
  remapScheduledGameUsers,
  remapRosterUsers,
} from "./rosterUserRemap";

const source = "64b000000000000000000001";
const target = "64b000000000000000000002";

describe("remapRosterUsers", () => {
  it("replaces a team roster user while preserving their role", () => {
    const result = remapRosterUsers(
      [
        {
          teamId: "team-1",
          simpleName: "One",
          displayName: "One",
          players: [
            { userId: source, isCaptain: true, isSubstitute: false },
          ],
        },
      ],
      [],
      new Map([[source, target]])
    );

    expect(result.teams[0].players).toEqual([
      { userId: target, isCaptain: true, isSubstitute: false },
    ]);
  });

  it("deduplicates source and target within one team", () => {
    const result = remapRosterUsers(
      [
        {
          teamId: "team-1",
          simpleName: "One",
          displayName: "One",
          players: [
            { userId: target, isCaptain: false, isSubstitute: true },
            { userId: source, isCaptain: true, isSubstitute: false },
          ],
        },
      ],
      [],
      new Map([[source, target]])
    );

    expect(result.teams[0].players).toEqual([
      { userId: target, isCaptain: true, isSubstitute: false },
    ]);
  });

  it("rejects a canonical user assigned to different teams", () => {
    expect(() =>
      remapRosterUsers(
        [
          {
            teamId: "team-1",
            simpleName: "One",
            displayName: "One",
            players: [
              { userId: source, isCaptain: true, isSubstitute: false },
            ],
          },
          {
            teamId: "team-2",
            simpleName: "Two",
            displayName: "Two",
            players: [
              { userId: target, isCaptain: true, isSubstitute: false },
            ],
          },
        ],
        [],
        new Map([[source, target]])
      )
    ).toThrowError(RosterUserRemapError);
  });

  it("deduplicates individual roster entries", () => {
    const result = remapRosterUsers(
      [],
      [
        { userId: source, isCaptain: false, isSubstitute: false },
        { userId: target, isCaptain: false, isSubstitute: false },
      ],
      new Map([[source, target]])
    );

    expect(result.players).toEqual([
      { userId: target, isCaptain: false, isSubstitute: false },
    ]);
  });

  it("remaps individual scheduled-game slots", () => {
    const [game] = remapScheduledGameUsers(
      [
        {
          id: "game-1",
          scheduledAt: "2026-08-20T19:00:00.000Z",
          slots: [
            { seatIndex: 0, participantId: source },
            { seatIndex: 1, participantId: "other" },
          ],
        },
      ],
      new Map([[source, target]])
    );

    expect(game.slots[0].participantId).toBe(target);
  });

  it("rejects duplicate or simultaneous scheduled assignments after remap", () => {
    expect(() =>
      remapScheduledGameUsers(
        [
          {
            id: "game-1",
            scheduledAt: "2026-08-20T19:00:00.000Z",
            slots: [
              { seatIndex: 0, participantId: source },
              { seatIndex: 1, participantId: target },
            ],
          },
        ],
        new Map([[source, target]])
      )
    ).toThrowError(RosterUserRemapError);

    expect(() =>
      remapScheduledGameUsers(
        [
          {
            id: "game-1",
            scheduledAt: "2026-08-20T19:00:00.000Z",
            slots: [{ seatIndex: 0, participantId: source }],
          },
          {
            id: "game-2",
            scheduledAt: "2026-08-20T19:00:00.000Z",
            slots: [{ seatIndex: 0, participantId: target }],
          },
        ],
        new Map([[source, target]])
      )
    ).toThrowError(RosterUserRemapError);
  });
});

describe("selectExistingRosterUser", () => {
  it("prefers the sole registered account over placeholder duplicates", () => {
    expect(
      selectExistingRosterUser([
        { id: "placeholder", name: "Benoit", isRegistered: false },
        { id: "registered", name: "Benoît", isRegistered: true },
      ])
    ).toEqual({ id: "registered", name: "Benoît", isRegistered: true });
  });

  it("rejects multiple registered owners or multiple placeholders", () => {
    expect(() =>
      selectExistingRosterUser([
        { id: "one", name: "One", isRegistered: true },
        { id: "two", name: "Two", isRegistered: true },
      ])
    ).toThrowError(RosterUserRemapError);
    expect(() =>
      selectExistingRosterUser([
        { id: "one", name: "One", isRegistered: false },
        { id: "two", name: "Two", isRegistered: false },
      ])
    ).toThrowError(RosterUserRemapError);
  });
});

describe("selectRosterIdentityOwner", () => {
  it("keeps a registered current user instead of reusing a placeholder", () => {
    expect(
      selectRosterIdentityOwner(
        { id: "current", name: "Current", isRegistered: true },
        [{ id: "placeholder", name: "Placeholder", isRegistered: false }]
      )
    ).toBeNull();
  });

  it("reuses a registered existing user for a placeholder current user", () => {
    expect(
      selectRosterIdentityOwner(
        { id: "current", name: "Current", isRegistered: false },
        [{ id: "registered", name: "Registered", isRegistered: true }]
      )
    ).toEqual({ id: "registered", name: "Registered", isRegistered: true });
  });

  it("rejects two registered owners", () => {
    expect(() =>
      selectRosterIdentityOwner(
        { id: "current", name: "Current", isRegistered: true },
        [{ id: "registered", name: "Registered", isRegistered: true }]
      )
    ).toThrowError(RosterUserRemapError);
  });
});