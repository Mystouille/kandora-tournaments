import { describe, expect, it } from "vitest";
import type { GameEvent, Seat } from "~/game/protocol/messages";
import {
  replayRoundTargets,
  resolveReplayKeyboardNavigation,
} from "./replayKeyboardNavigation";

type ReplayKeyEvent = Parameters<typeof resolveReplayKeyboardNavigation>[0];

function keyEvent(
  key: string,
  overrides: Partial<ReplayKeyEvent> = {}
): ReplayKeyEvent {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    ...overrides,
  };
}

const handStart: GameEvent = {
  type: "hand_start",
  round: 0,
  dealer: 0,
  scores: [25000, 25000, 25000, 25000],
  doraIndicators: [],
};
const events: GameEvent[] = [
  { type: "match_start", ruleSet: "tenhou", seats: [] },
  handStart,
  { type: "draw", seat: 0, tile: "1m", wallRemaining: 69 },
  { type: "discard", seat: 0, tile: "1m", tsumogiri: true },
  { type: "draw", seat: 1, tile: "2m", wallRemaining: 68 },
  { type: "discard", seat: 1, tile: "2m", tsumogiri: true },
  { type: "hand_end", reason: "exhaustive_draw" },
  { ...handStart, round: 1 },
  { type: "draw", seat: 0, tile: "3m", wallRemaining: 69 },
  { type: "discard", seat: 0, tile: "3m", tsumogiri: true },
  { type: "hand_end", reason: "exhaustive_draw" },
  { ...handStart, round: 2 },
  { type: "draw", seat: 2, tile: "4m", wallRemaining: 69 },
  { type: "discard", seat: 2, tile: "4m", tsumogiri: true },
];
const rounds = [1, 7, 11];
const bounds = { min: -1, max: events.length - 1 };

function navigate(key: ReplayKeyEvent, index: number, focusSeat: Seat = 0) {
  return resolveReplayKeyboardNavigation(key, {
    events,
    rounds,
    bounds,
    index,
    focusSeat,
  });
}

describe("replayRoundTargets", () => {
  it.each([
    [-1, null, 1],
    [0, null, 1],
    [1, null, 7],
    [2, 1, 7],
    [7, 1, 11],
    [9, 7, 11],
    [11, 7, null],
    [13, 11, null],
  ] as const)("resolves round starts at index %s", (index, previous, next) => {
    expect(replayRoundTargets(rounds, index)).toEqual({ previous, next });
  });

  it("has no destinations without round starts", () => {
    expect(replayRoundTargets([], 0)).toEqual({
      previous: null,
      next: null,
    });
  });
});

describe("resolveReplayKeyboardNavigation", () => {
  it.each([
    ["ArrowRight", -1, 1],
    ["ArrowRight", 3, 1],
    ["ArrowLeft", 3, -1],
    ["ArrowLeft", 0, -1],
  ] as const)("steps %s from %s", (key, index, delta) => {
    expect(navigate(keyEvent(key), index)).toEqual({ kind: "step", delta });
  });

  it("does not step past either end", () => {
    expect(navigate(keyEvent("ArrowLeft"), bounds.min)).toBeNull();
    expect(navigate(keyEvent("ArrowRight"), bounds.max)).toBeNull();
  });

  it("jumps to the focused player's discard, not their draw", () => {
    expect(navigate(keyEvent("ArrowRight", { shiftKey: true }), 1)).toEqual({
      kind: "jump",
      index: 3,
    });
    expect(navigate(keyEvent("ArrowRight", { shiftKey: true }), 1, 1)).toEqual({
      kind: "jump",
      index: 5,
    });
  });

  it("crosses rounds and skips the current discard in either direction", () => {
    expect(navigate(keyEvent("ArrowRight", { shiftKey: true }), 3)).toEqual({
      kind: "jump",
      index: 9,
    });
    expect(navigate(keyEvent("ArrowLeft", { shiftKey: true }), 9)).toEqual({
      kind: "jump",
      index: 3,
    });
  });

  it("keeps adjacent discard jumps distinct from audible event steps", () => {
    expect(navigate(keyEvent("ArrowRight", { shiftKey: true }), 2)).toEqual({
      kind: "jump",
      index: 3,
    });
    expect(navigate(keyEvent("ArrowRight"), 2)).toEqual({
      kind: "step",
      delta: 1,
    });
  });

  it("finds focused discards from the pre-event view and final event", () => {
    expect(navigate(keyEvent("ArrowRight", { shiftKey: true }), -1)).toEqual({
      kind: "jump",
      index: 3,
    });
    expect(
      navigate(keyEvent("ArrowLeft", { shiftKey: true }), bounds.max)
    ).toEqual({ kind: "jump", index: 9 });
  });

  it("does not substitute round ends or replay bounds for absent discards", () => {
    expect(navigate(keyEvent("ArrowLeft", { shiftKey: true }), 3)).toBeNull();
    expect(navigate(keyEvent("ArrowRight", { shiftKey: true }), 9)).toBeNull();
    expect(
      navigate(keyEvent("ArrowRight", { shiftKey: true }), -1, 3)
    ).toBeNull();
  });

  it.each([
    ["ArrowRight", -1, 1],
    ["ArrowRight", 1, 7],
    ["ArrowRight", 5, 7],
    ["ArrowLeft", 5, 1],
    ["ArrowLeft", 7, 1],
    ["ArrowLeft", 9, 7],
    ["ArrowLeft", 13, 11],
  ] as const)(
    "jumps to a round start with Ctrl+%s from %s",
    (key, index, target) => {
      expect(navigate(keyEvent(key, { ctrlKey: true }), index)).toEqual({
        kind: "jump",
        index: target,
      });
    }
  );

  it("does not wrap when a round start is unavailable", () => {
    expect(navigate(keyEvent("ArrowLeft", { ctrlKey: true }), -1)).toBeNull();
    expect(navigate(keyEvent("ArrowLeft", { ctrlKey: true }), 1)).toBeNull();
    expect(navigate(keyEvent("ArrowRight", { ctrlKey: true }), 11)).toBeNull();
  });

  it.each([
    { altKey: true },
    { metaKey: true },
    { ctrlKey: true, shiftKey: true },
    { ctrlKey: true, altKey: true },
    { shiftKey: true, metaKey: true },
    { isComposing: true },
    { defaultPrevented: true },
    { key: "ArrowUp" },
    { key: " " },
  ])("ignores unsupported or handled keyboard events: %o", (overrides) => {
    expect(navigate(keyEvent("ArrowRight", overrides), 4)).toBeNull();
  });

  it("has no destinations in an empty replay", () => {
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      for (const modifiers of [{}, { shiftKey: true }, { ctrlKey: true }]) {
        expect(
          resolveReplayKeyboardNavigation(keyEvent(key, modifiers), {
            events: [],
            rounds: [],
            bounds: { min: -1, max: -1 },
            index: -1,
            focusSeat: 0,
          })
        ).toBeNull();
      }
    }
  });
});
