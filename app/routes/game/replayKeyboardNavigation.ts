import type { GameEvent, Seat } from "~/game/protocol/messages";

type ReplayKeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "defaultPrevented"
  | "isComposing"
>;

type ReplayKeyboardNavigation =
  { kind: "step"; delta: -1 | 1 } | { kind: "jump"; index: number };

export function replayRoundTargets(
  rounds: readonly number[],
  index: number
): { previous: number | null; next: number | null } {
  let previous: number | null = null;
  let next: number | null = null;
  for (const round of rounds) {
    if (round < index) {
      previous = round;
    } else if (round > index) {
      next = round;
      break;
    }
  }
  return { previous, next };
}

export function resolveReplayKeyboardNavigation(
  event: ReplayKeyEvent,
  options: {
    events: readonly GameEvent[];
    rounds: readonly number[];
    bounds: { min: number; max: number };
    index: number;
    focusSeat: Seat;
  }
): ReplayKeyboardNavigation | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.metaKey ||
    (event.ctrlKey && event.shiftKey) ||
    (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
  ) {
    return null;
  }

  const delta = event.key === "ArrowRight" ? 1 : -1;
  const { events, rounds, bounds, index, focusSeat } = options;
  if (event.ctrlKey) {
    const targets = replayRoundTargets(rounds, index);
    const target = delta === 1 ? targets.next : targets.previous;
    return target === null ? null : { kind: "jump", index: target };
  }
  if (event.shiftKey) {
    for (
      let cursor = index + delta;
      cursor >= bounds.min && cursor <= bounds.max;
      cursor += delta
    ) {
      const candidate = events[cursor];
      if (candidate?.type === "discard" && candidate.seat === focusSeat) {
        return { kind: "jump", index: cursor };
      }
    }
    return null;
  }

  const target = index + delta;
  return target < bounds.min || target > bounds.max
    ? null
    : { kind: "step", delta };
}
