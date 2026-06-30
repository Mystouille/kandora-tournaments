import { useEffect, useRef } from "react";

type SwipeDirection = "left" | "right" | "up" | "down";

interface SwipeCallbacks {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

interface SwipeOptions {
  /** Minimum distance in px to count as a swipe (default 50) */
  threshold?: number;
  /** Element ref to attach listeners to; defaults to document */
  element?: React.RefObject<HTMLElement | null>;
  /** Ignore swipes on horizontally scrollable elements (default true) */
  ignoreScrollableX?: boolean;
}

function isHorizontallyScrollable(el: Element): boolean {
  return el.scrollWidth > el.clientWidth;
}

function isInHorizontallyScrollableContainer(target: Element): boolean {
  let current: Element | null = target;
  while (current) {
    const computed = window.getComputedStyle(current);
    const overflowX = computed.overflowX;
    if (
      overflowX === "auto" ||
      overflowX === "scroll" ||
      overflowX === "overlay"
    ) {
      if (isHorizontallyScrollable(current)) {
        return true;
      }
    }
    current = current.parentElement;
  }
  return false;
}

function findScrollableAncestorForX(target: Element): HTMLElement | null {
  let current: Element | null = target;
  while (current) {
    const computed = window.getComputedStyle(current);
    const overflowX = computed.overflowX;
    if (
      (overflowX === "auto" ||
        overflowX === "scroll" ||
        overflowX === "overlay") &&
      isHorizontallyScrollable(current)
    ) {
      return current as HTMLElement;
    }
    current = current.parentElement;
  }
  return null;
}

function isInTabsOrCarousel(target: Element): boolean {
  let current: Element | null = target;
  while (current) {
    const classList = current.classList;
    // Only restrict on tab headers/navs and carousel controls, not entire tab container
    if (
      classList.contains("ant-tabs-nav") ||
      classList.contains("ant-tabs-nav-wrap") ||
      classList.contains("ant-carousel") ||
      classList.contains("swiper") ||
      classList.contains("slick-track")
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Calls the matching callback when the user performs a swipe gesture.
 * Only the dominant axis fires (horizontal vs vertical).
 */
export function useSwipeGesture(
  callbacks: SwipeCallbacks,
  options: SwipeOptions = { ignoreScrollableX: true }
) {
  const { threshold = 50, element, ignoreScrollableX = true } = options;
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    const target = element?.current ?? document;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let startTarget: Element | null = null;
    let scrollableAncestor: HTMLElement | null = null;
    let startScrollLeft = 0;

    function onTouchStart(e: Event) {
      const touch = (e as TouchEvent).touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTarget = e.target as Element;
      tracking = true;

      scrollableAncestor = findScrollableAncestorForX(startTarget);
      startScrollLeft = scrollableAncestor?.scrollLeft ?? 0;
    }

    function onTouchEnd(e: Event) {
      if (!tracking) {
        return;
      }
      tracking = false;

      // Check if swipe is inside a tabs/carousel/slider component
      if (ignoreScrollableX && startTarget && isInTabsOrCarousel(startTarget)) {
        return;
      }

      // Check if the scrollable ancestor actually scrolled horizontally
      const endScrollLeft = scrollableAncestor?.scrollLeft ?? 0;
      if (scrollableAncestor && endScrollLeft !== startScrollLeft) {
        return;
      }

      // Check if swipe started on a horizontally scrollable container
      if (
        ignoreScrollableX &&
        startTarget &&
        isInHorizontallyScrollableContainer(startTarget)
      ) {
        return;
      }

      const touch = (e as TouchEvent).changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx < threshold && absDy < threshold) {
        return;
      }

      let direction: SwipeDirection;
      if (absDx > absDy) {
        direction = dx > 0 ? "right" : "left";
      } else {
        direction = dy > 0 ? "down" : "up";
      }

      const cb =
        direction === "left"
          ? cbRef.current.onSwipeLeft
          : direction === "right"
            ? cbRef.current.onSwipeRight
            : direction === "up"
              ? cbRef.current.onSwipeUp
              : cbRef.current.onSwipeDown;

      cb?.();
    }

    target.addEventListener("touchstart", onTouchStart, { passive: true });
    target.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      target.removeEventListener("touchstart", onTouchStart);
      target.removeEventListener("touchend", onTouchEnd);
    };
  }, [element, threshold, ignoreScrollableX]);
}
