import { describe, expect, it } from "vitest";
import {
  replayTapEventOffset,
  SPECTATE_SWIPE_PERCENT_PER_EVENT,
  spectateSwipeEventDelta,
} from "./spectateSwipe";

describe("mobile replay swipe", () => {
  it("uses the same event count for the same screen percentage", () => {
    expect(SPECTATE_SWIPE_PERCENT_PER_EVENT).toBe(1.25);
    expect(spectateSwipeEventDelta(90, 10, 360)).toBe(20);
    expect(spectateSwipeEventDelta(180, 10, 720)).toBe(20);
  });

  it("moves right forward and left backward", () => {
    expect(spectateSwipeEventDelta(72, 4, 360)).toBe(16);
    expect(spectateSwipeEventDelta(-72, 4, 360)).toBe(-16);
  });

  it("ignores sub-step and vertical-dominant gestures", () => {
    expect(spectateSwipeEventDelta(4, 2, 360)).toBe(0);
    expect(spectateSwipeEventDelta(72, 80, 360)).toBe(0);
  });

  it("caps a gesture at one screen of event steps", () => {
    expect(spectateSwipeEventDelta(2_000, 0, 500)).toBe(80);
    expect(spectateSwipeEventDelta(-2_000, 0, 500)).toBe(-80);
  });

  it("steps backward on the left half and forward on the right half", () => {
    expect(replayTapEventOffset(99, 200)).toBe(-1);
    expect(replayTapEventOffset(100, 200)).toBe(1);
    expect(replayTapEventOffset(150, 200)).toBe(1);
    expect(replayTapEventOffset(50, 0)).toBe(0);
  });
});
