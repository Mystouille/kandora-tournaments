import { describe, expect, it } from "vitest";
import {
  ScheduleValidationError,
  resolveSchedulePhases,
  validateScheduledGames,
  type ScheduledGameInput,
} from "./scheduleService.server";

const participants = [
  "64b000000000000000000001",
  "64b000000000000000000002",
  "64b000000000000000000003",
  "64b000000000000000000004",
  "64b000000000000000000005",
];

const context = {
  leagueStartTime: new Date("2026-08-01T00:00:00.000Z"),
  leagueEndTime: new Date("2026-09-01T00:00:00.000Z"),
  validPhaseIds: new Set<string | null>(["regular", "finals"]),
  validParticipantIds: new Set(participants),
};

function game(
  overrides: Partial<ScheduledGameInput> = {}
): ScheduledGameInput {
  return {
    phaseId: "regular",
    scheduledAt: "2026-08-20T18:00:00.000Z",
    slots: [
      { seatIndex: 3, participantId: participants[3] },
      { seatIndex: 0, participantId: participants[0] },
      { seatIndex: 2, participantId: null },
      { seatIndex: 1, participantId: participants[1] },
    ],
    ...overrides,
  };
}

describe("validateScheduledGames", () => {
  it("accepts TBD slots and normalizes seat order", () => {
    const [normalized] = validateScheduledGames([game()], context);

    expect(normalized.slots.map((slot) => slot.seatIndex)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(normalized.slots[2].participantId).toBeNull();
    expect(normalized.scheduledAt).toEqual(
      new Date("2026-08-20T18:00:00.000Z")
    );
  });

  it("rejects invalid phases and dates outside the tournament", () => {
    expect(() =>
      validateScheduledGames([game({ phaseId: "unknown" })], context)
    ).toThrowError(ScheduleValidationError);
    expect(() =>
      validateScheduledGames(
        [game({ scheduledAt: "2026-10-01T18:00:00.000Z" })],
        context
      )
    ).toThrowError(ScheduleValidationError);
  });

  it("rejects malformed seats and unknown participants", () => {
    expect(() =>
      validateScheduledGames(
        [
          game({
            slots: [
              { seatIndex: 0, participantId: participants[0] },
              { seatIndex: 0, participantId: participants[1] },
              { seatIndex: 2, participantId: participants[2] },
              { seatIndex: 3, participantId: participants[3] },
            ],
          }),
        ],
        context
      )
    ).toThrowError(ScheduleValidationError);
    expect(() =>
      validateScheduledGames(
        [
          game({
            slots: [
              { seatIndex: 0, participantId: participants[0] },
              {
                seatIndex: 1,
                participantId: "64b000000000000000000099",
              },
              { seatIndex: 2, participantId: null },
              { seatIndex: 3, participantId: null },
            ],
          }),
        ],
        context
      )
    ).toThrowError(ScheduleValidationError);
  });

  it("rejects duplicate participants within a game", () => {
    expect(() =>
      validateScheduledGames(
        [
          game({
            slots: [
              { seatIndex: 0, participantId: participants[0] },
              { seatIndex: 1, participantId: participants[0] },
              { seatIndex: 2, participantId: null },
              { seatIndex: 3, participantId: null },
            ],
          }),
        ],
        context
      )
    ).toThrowError(ScheduleValidationError);
  });

  it("rejects a participant assigned to simultaneous games", () => {
    expect(() =>
      validateScheduledGames(
        [
          game(),
          game({
            slots: [
              { seatIndex: 0, participantId: participants[0] },
              { seatIndex: 1, participantId: participants[4] },
              { seatIndex: 2, participantId: null },
              { seatIndex: 3, participantId: null },
            ],
          }),
        ],
        context
      )
    ).toThrowError(ScheduleValidationError);
  });
});

describe("resolveSchedulePhases", () => {
  it("uses one synthetic tournament phase without a league type config", () => {
    expect(resolveSchedulePhases(null)).toEqual([
      { id: null, kind: "tournament" },
    ]);
  });

  it("preserves configured phase order", () => {
    expect(
      resolveSchedulePhases({
        displayName: "League with finals",
        isTeamMode: false,
        regularPhase: { id: "regular", scoring: { type: "cumulative" } },
        finalPhase: {
          id: "finals",
          scoring: { type: "bracket-delta" },
          scoreCarryOver: { num: 0, den: 1 },
          stages: [],
        },
      })
    ).toEqual([
      { id: "regular", kind: "regular" },
      { id: "finals", kind: "final" },
    ]);
  });
});