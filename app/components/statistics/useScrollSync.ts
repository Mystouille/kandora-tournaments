import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Synchronises horizontal scroll between a main container (hidden scrollbar)
 * and a sticky proxy scrollbar pinned to the viewport bottom.
 *
 * Returns refs to attach and the current scrollWidth for the proxy div.
 */
export function useScrollSync(depKeys: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const proxyRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const syncing = useRef(false);

  // Keep scrollWidth in sync via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const update = () => setScrollWidth(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, depKeys);

  const onContainerScroll = useCallback(() => {
    if (syncing.current) {
      return;
    }
    syncing.current = true;
    if (proxyRef.current && containerRef.current) {
      proxyRef.current.scrollLeft = containerRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  const onProxyScroll = useCallback(() => {
    if (syncing.current) {
      return;
    }
    syncing.current = true;
    if (containerRef.current && proxyRef.current) {
      containerRef.current.scrollLeft = proxyRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  return {
    containerRef,
    proxyRef,
    scrollWidth,
    onContainerScroll,
    onProxyScroll,
  };
}
