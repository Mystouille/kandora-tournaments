import { useCallback, useRef } from "react";

/**
 * Manages focus & hover highlight state for the yaku map table.
 * All visual updates go through a dynamic <style> tag (no React re-renders).
 *
 * Usage:
 *   const focus = useYakuMapFocus(isDark);
 *   <style ref={focus.styleRef} />
 *   <table id={focus.scopeId}> …
 */
export function useYakuMapFocus(isDark: boolean) {
  const scopeId = useRef(`ym-${Math.random().toString(36).slice(2, 8)}`);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const focusedRowRef = useRef<string | null>(null);
  const focusedColRef = useRef<number | null>(null);
  const hoveredRowRef = useRef<string | null>(null);
  const hoveredColRef = useRef<number | null>(null);

  /* ── core CSS builder ── */
  const updateCSS = useCallback(() => {
    const el = styleRef.current;
    if (!el) {
      return;
    }
    const s = scopeId.current;
    // Hover colors (lighter)
    const hoverHL = isDark ? "rgba(250,173,20,0.06)" : "rgba(250,173,20,0.08)";
    const hoverBorder = isDark
      ? "rgba(250,173,20,0.2)"
      : "rgba(250,173,20,0.25)";
    // Focus colors (stronger)
    const focusHL = isDark ? "rgba(250,173,20,0.12)" : "rgba(250,173,20,0.15)";
    const focusBorder = isDark
      ? "rgba(250,173,20,0.4)"
      : "rgba(250,173,20,0.5)";
    let css = "";
    const hRow = hoveredRowRef.current;
    const hCol = hoveredColRef.current;
    const fRow = focusedRowRef.current;
    const fCol = focusedColRef.current;
    // --- hover (rendered first so focus takes precedence) ---
    if (hRow && hRow !== fRow) {
      const escaped = CSS.escape(hRow);
      css += `#${s} td[data-row="${escaped}"] { outline: 1px solid ${hoverBorder}; outline-offset: -1px; }`;
      css += `#${s} td.ym-empty[data-row="${escaped}"] { background: ${hoverHL} !important; }`;
      css += `#${s} td.ym-name[data-row="${escaped}"] { font-weight: 600 !important; color: #faad14 !important; }`;
    }
    if (hCol !== null && hCol !== fCol) {
      css += `#${s} td[data-col="${hCol}"] { outline: 1px solid ${hoverBorder}; outline-offset: -1px; }`;
      css += `#${s} td.ym-empty[data-col="${hCol}"] { background: ${hoverHL} !important; }`;
      css += `#${s} div[data-yaku-label="${hCol}"] { font-weight: 700 !important; color: #faad14 !important; }`;
    }
    // --- focus (stronger, overrides hover) ---
    if (fRow) {
      const escaped = CSS.escape(fRow);
      css += `#${s} td[data-row="${escaped}"] { outline: 1px solid ${focusBorder}; outline-offset: -1px; }`;
      css += `#${s} td.ym-empty[data-row="${escaped}"] { background: ${focusHL} !important; }`;
      css += `#${s} td.ym-name[data-row="${escaped}"] { font-weight: 700 !important; color: #faad14 !important; }`;
    }
    if (fCol !== null) {
      css += `#${s} td[data-col="${fCol}"] { outline: 1px solid ${focusBorder}; outline-offset: -1px; }`;
      css += `#${s} td.ym-empty[data-col="${fCol}"] { background: ${focusHL} !important; }`;
      css += `#${s} div[data-yaku-label="${fCol}"] { font-weight: 700 !important; color: #faad14 !important; }`;
    }
    if (fRow && fCol !== null) {
      const escaped = CSS.escape(fRow);
      css += `#${s} td[data-row="${escaped}"][data-col="${fCol}"] { box-shadow: inset 0 0 0 2px #faad14; }`;
    }
    el.textContent = css;
  }, [isDark]);

  /* ── public callbacks ── */
  const toggleFocusRow = useCallback(
    (id: string) => {
      focusedRowRef.current = focusedRowRef.current === id ? null : id;
      updateCSS();
    },
    [updateCSS]
  );

  const toggleFocusCol = useCallback(
    (yakuId: number) => {
      focusedColRef.current = focusedColRef.current === yakuId ? null : yakuId;
      updateCSS();
    },
    [updateCSS]
  );

  const hoverRow = useCallback(
    (id: string | null) => {
      hoveredRowRef.current = id;
      updateCSS();
    },
    [updateCSS]
  );

  const hoverCol = useCallback(
    (yakuId: number | null) => {
      hoveredColRef.current = yakuId;
      updateCSS();
    },
    [updateCSS]
  );

  const hoverCell = useCallback(
    (rowId: string | null, colId: number | null) => {
      hoveredRowRef.current = rowId;
      hoveredColRef.current = colId;
      updateCSS();
    },
    [updateCSS]
  );

  const focusCell = useCallback(
    (rowId: string, colId: number) => {
      focusedRowRef.current =
        focusedRowRef.current === rowId && focusedColRef.current === colId
          ? null
          : rowId;
      focusedColRef.current = focusedRowRef.current === null ? null : colId;
      updateCSS();
    },
    [updateCSS]
  );

  return {
    scopeId: scopeId.current,
    styleRef,
    toggleFocusRow,
    toggleFocusCol,
    hoverRow,
    hoverCol,
    hoverCell,
    focusCell,
  };
}
