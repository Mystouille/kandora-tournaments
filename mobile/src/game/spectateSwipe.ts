import { useEffect, useEffectEvent, type RefObject } from "react";

export const SPECTATE_SWIPE_PERCENT_PER_EVENT = 1.25;

export function spectateSwipeEventDelta(
  deltaX: number,
  deltaY: number,
  viewportWidth: number
): number {
  if (
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0 ||
    Math.abs(deltaX) <= Math.abs(deltaY)
  ) {
    return 0;
  }

  const screenPercent = Math.max(
    -100,
    Math.min(100, (deltaX / viewportWidth) * 100)
  );
  return Math.trunc(screenPercent / SPECTATE_SWIPE_PERCENT_PER_EVENT);
}

export function replayTapEventOffset(
  clientX: number,
  viewportWidth: number
): -1 | 0 | 1 {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0
  ) {
    return 0;
  }
  return clientX < viewportWidth / 2 ? -1 : 1;
}

interface ReplaySwipeNavigationOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  enabled?: boolean;
  onGestureStart: () => void;
  onEventOffset: (eventOffset: number) => void;
}

export function useReplaySwipeNavigation({
  containerRef,
  enabled = true,
  onGestureStart,
  onEventOffset,
}: ReplaySwipeNavigationOptions): void {
  const beginGesture = useEffectEvent(onGestureStart);
  const dispatchEventOffset = useEffectEvent(onEventOffset);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || container === null) {
      return;
    }

    let gesture: {
      pointerId: number;
      startX: number;
      startY: number;
      viewportWidth: number;
      axis: "pending" | "horizontal" | "vertical";
      reportedEventOffset: number;
    } | null = null;

    const clearGesture = (pointerId: number): void => {
      if (gesture?.pointerId !== pointerId) {
        return;
      }
      if (container.hasPointerCapture(pointerId)) {
        container.releasePointerCapture(pointerId);
      }
      gesture = null;
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (
        event.pointerType !== "touch" ||
        !event.isPrimary ||
        event.button !== 0
      ) {
        return;
      }
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        viewportWidth: window.innerWidth,
        axis: "pending",
        reportedEventOffset: 0,
      };
      beginGesture();
      container.setPointerCapture(event.pointerId);
    };
    const applyGesturePosition = (event: PointerEvent): void => {
      const current = gesture;
      if (current?.pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - current.startX;
      const deltaY = event.clientY - current.startY;
      if (current.axis === "pending") {
        const threshold =
          (current.viewportWidth * SPECTATE_SWIPE_PERCENT_PER_EVENT) / 100;
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) {
          return;
        }
        current.axis =
          Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
      }
      if (current.axis !== "horizontal") {
        return;
      }
      event.preventDefault();
      const eventOffset = spectateSwipeEventDelta(
        deltaX,
        0,
        current.viewportWidth
      );
      if (eventOffset !== current.reportedEventOffset) {
        current.reportedEventOffset = eventOffset;
        dispatchEventOffset(eventOffset);
      }
    };
    const handlePointerMove = (event: PointerEvent): void => {
      applyGesturePosition(event);
    };
    const handlePointerUp = (event: PointerEvent): void => {
      const current = gesture;
      if (current?.pointerId !== event.pointerId) {
        return;
      }
      if (current.axis === "pending") {
        const eventOffset = replayTapEventOffset(
          event.clientX,
          current.viewportWidth
        );
        if (eventOffset !== 0) {
          event.preventDefault();
          dispatchEventOffset(eventOffset);
        }
      }
      clearGesture(event.pointerId);
    };
    const handlePointerCancel = (event: PointerEvent): void => {
      clearGesture(event.pointerId);
    };

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerup", handlePointerUp);
    container.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [containerRef, enabled]);
}
