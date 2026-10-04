import type { ComponentProps } from "react";
import type ReplayRoute from "../../../app/routes/game/replay";
import type {
  GameEvent,
  RoomState,
  SnapshotState,
  ViewerPresence,
} from "../../../app/game/protocol/messages";
import {
  REPLAY_LOG_SCHEMA_VERSION,
  type ReplayLog,
} from "../../../app/game/replay/types";

export const fixtureMatchId = "browser-ui-long-match-identifier";
export const fixtureSeats = [0, 1, 2, 3] as const;
export const fixtureNames = [
  "A player with a deliberately long display name",
  "South player",
  "West player",
  "North player",
];
const hands = fixtureSeats.map(() => [
  "1m",
  "2m",
  "3m",
  "4m",
  "5m",
  "6m",
  "7m",
  "8m",
  "9m",
  "1p",
  "2p",
  "3p",
  "4p",
]);

export const fixtureEvents: GameEvent[] = [
  {
    type: "match_start",
    ruleSet: "tenhou",
    seats: fixtureSeats.map((seat) => ({
      seat,
      userId: `player-${seat}`,
      displayName: fixtureNames[seat],
    })),
  },
  {
    type: "hand_start",
    round: 0,
    roundWind: "E",
    roundNumber: 1,
    dealer: 0,
    scores: [25000, 25000, 25000, 25000],
    doraIndicators: ["2z"],
    startingHands: hands,
  },
  ...fixtureSeats.flatMap<GameEvent>((seat) => [
    { type: "draw", seat, tile: "8p", wallRemaining: 69 - seat },
    {
      type: "discard",
      seat,
      tile: "8p",
      tsumogiri: true,
      discardSource: "draw",
    },
  ]),
];

export const fixtureViewers: ViewerPresence[] = Array.from(
  { length: 30 },
  (_, index) => ({
    userId: `viewer-${index}`,
    displayName: `Viewer ${index} with a very long display name`,
    role: "spectator",
    delayMs: index % 2 === 0 ? 0 : 300_000,
  })
);

export function fixtureSnapshot(spectating: boolean): SnapshotState {
  return {
    mySeat: spectating ? null : 0,
    hands,
    discards: [[], [], [], []],
    melds: [[], [], [], []],
    wallRemaining: 70,
    doraIndicators: ["2z"],
    turn: 0,
    dealer: 0,
    roundWind: "E",
    roundNumber: 1,
    honba: 0,
    riichiSticks: 0,
    scores: [25000, 25000, 25000, 25000],
    riichiDeclared: [false, false, false, false],
    lastDiscard: null,
    phase: "awaiting_draw",
    seatNames: fixtureNames,
  };
}

export function fixtureRoom(spectating: boolean): RoomState {
  return {
    type: "room_state",
    matchId: fixtureMatchId,
    status: "playing",
    mySeat: spectating ? null : 0,
    hostSeat: 0,
    canStart: false,
    seats: fixtureSeats.map((seat) => ({
      seat,
      ready: true,
      occupant: {
        kind: "human",
        userId: `player-${seat}`,
        displayName: fixtureNames[seat],
        connected: true,
      },
    })),
  };
}

const log = {
  source: "tenhou",
  sourceGameId: fixtureMatchId,
  ruleSet: "tenhou",
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_600_000,
  schemaVersion: REPLAY_LOG_SCHEMA_VERSION,
  seats: fixtureSeats.map((seat) => ({
    seat,
    displayName: fixtureNames[seat],
    finalScore: 25000,
    place: 1,
  })),
  events: fixtureEvents,
} satisfies ReplayLog;

export const fixtureReplayData: ComponentProps<
  typeof ReplayRoute
>["loaderData"] = {
  log,
  waitsByIndex: fixtureEvents.map(() => []),
  review: null,
  currentUserId: "browser-reviewer",
  currentUserName: "Browser reviewer",
  seatEnrichment: [null, null, null, null],
};
