import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useLayoutEffect,
  useEffect,
} from "react";

export interface DropIndicator {
  cardId: string;
  side: "left" | "right";
}

interface UseCardGridOptions {
  localStorageOrderKey: string;
  localStorageHiddenKey: string;
  defaultOrder: string[];
}

export function useCardGrid({
  localStorageOrderKey,
  localStorageHiddenKey,
  defaultOrder,
}: UseCardGridOptions) {
  // ----- Card ordering & visibility (persisted to localStorage) -----
  const [cardOrder, setCardOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(localStorageOrderKey);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        const missing = defaultOrder.filter((id) => !parsed.includes(id));
        const valid = parsed.filter((id) => defaultOrder.includes(id));
        return [...valid, ...missing];
      }
    } catch {}
    return defaultOrder;
  });

  const [hiddenCards, setHiddenCards] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(localStorageHiddenKey);
      if (stored) {
        return new Set(JSON.parse(stored) as string[]);
      }
    } catch {}
    return new Set();
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(localStorageOrderKey, JSON.stringify(cardOrder));
  }, [cardOrder, localStorageOrderKey]);

  useEffect(() => {
    localStorage.setItem(
      localStorageHiddenKey,
      JSON.stringify([...hiddenCards])
    );
  }, [hiddenCards, localStorageHiddenKey]);

  const visibleCards = useMemo(
    () => cardOrder.filter((id) => !hiddenCards.has(id)),
    [cardOrder, hiddenCards]
  );

  // ----- Drag-and-drop reordering state -----
  const dragCardRef = useRef<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(
    null
  );

  // ----- FLIP animation refs -----
  const cardElRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const prevRectsRef = useRef<Record<string, DOMRect>>({});
  const [flipTrigger, setFlipTrigger] = useState(0);
  const prevVisibleRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    if (flipTrigger === 0) {
      return;
    }
    const prev = prevRectsRef.current;
    const prevVisible = prevVisibleRef.current;

    for (const [id, el] of Object.entries(cardElRefs.current)) {
      if (!el) {
        continue;
      }
      if (prev[id]) {
        const newRect = el.getBoundingClientRect();
        const dx = prev[id].left - newRect.left;
        const dy = prev[id].top - newRect.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
          continue;
        }
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.style.transition = "none";
      } else if (!prevVisible.has(id)) {
        el.style.transform = "scale(0.92)";
        el.style.opacity = "0";
        el.style.transition = "none";
      }
    }

    prevRectsRef.current = {};

    requestAnimationFrame(() => {
      for (const [_id, el] of Object.entries(cardElRefs.current)) {
        if (!el) {
          continue;
        }
        el.style.transition = "transform 0.35s ease, opacity 0.35s ease";
        el.style.transform = "";
        el.style.opacity = "";
      }
    });
  }, [flipTrigger]);

  /** Snapshot all card positions before a reorder */
  const snapshotPositions = useCallback(() => {
    prevVisibleRef.current = new Set(
      Object.entries(cardElRefs.current)
        .filter(([, el]) => el !== null)
        .map(([id]) => id)
    );
    for (const [id, el] of Object.entries(cardElRefs.current)) {
      if (el) {
        prevRectsRef.current[id] = el.getBoundingClientRect();
      }
    }
  }, []);

  // ----- Drag handlers -----
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, cardId: string) => {
      dragCardRef.current = cardId;
      e.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => {
        const el = e.currentTarget;
        if (el) {
          el.style.opacity = "0.4";
        }
      });
    },
    []
  );

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.style.opacity = "1";
    dragCardRef.current = null;
    setDropIndicator(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, cardId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragCardRef.current === cardId) {
        setDropIndicator(null);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const side = e.clientX < midX ? "left" : "right";
      setDropIndicator((prev) =>
        prev?.cardId === cardId && prev?.side === side ? prev : { cardId, side }
      );
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDropIndicator(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetCardId: string) => {
      e.preventDefault();
      const sourceCardId = dragCardRef.current;
      const indicator = dropIndicator;
      setDropIndicator(null);
      if (!sourceCardId || sourceCardId === targetCardId) {
        return;
      }
      snapshotPositions();
      setCardOrder((prev) => {
        const sourceIdx = prev.indexOf(sourceCardId);
        let targetIdx = prev.indexOf(targetCardId);
        if (sourceIdx < 0 || targetIdx < 0) {
          return prev;
        }
        const next = [...prev];
        next.splice(sourceIdx, 1);
        targetIdx = next.indexOf(targetCardId);
        if (indicator?.side === "right") {
          targetIdx += 1;
        }
        next.splice(targetIdx, 0, sourceCardId);
        return next;
      });
      setFlipTrigger((c) => c + 1);
    },
    [dropIndicator, snapshotPositions]
  );

  // ----- Hide / show / reset -----
  const handleHideCard = useCallback((cardId: string) => {
    setHiddenCards((prev) => new Set([...prev, cardId]));
  }, []);

  const handleShowCard = useCallback((cardId: string) => {
    setHiddenCards((prev) => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
  }, []);

  const handleResetLayout = useCallback(() => {
    snapshotPositions();
    setCardOrder(defaultOrder);
    setHiddenCards(new Set());
    setFlipTrigger((c) => c + 1);
  }, [snapshotPositions, defaultOrder]);

  return {
    cardOrder,
    hiddenCards,
    visibleCards,
    cardElRefs,
    dropIndicator,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleHideCard,
    handleShowCard,
    handleResetLayout,
  };
}
