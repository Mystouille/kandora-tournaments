import { Check, Menu, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type {
  LivePlayMenuFlags,
  LivePlayMenuOptionKey,
} from "~/game/client/LivePlayMenu";

const OPTIONS: Array<{
  key: LivePlayMenuOptionKey;
  label: string;
}> = [
  { key: "autoDiscard", label: "Drop all" },
  { key: "autoWin", label: "Auto win" },
  { key: "autoSort", label: "Sort" },
  { key: "noCall", label: "No call" },
];

interface MobileGameMenuProps {
  expanded: boolean;
  flags: LivePlayMenuFlags;
  handTop: number | null;
  onExpandedChange: (expanded: boolean) => void;
  onLeftChange: (left: number | null) => void;
  onToggle: (key: LivePlayMenuOptionKey) => void;
}

export function MobileGameMenu({
  expanded,
  flags,
  handTop,
  onExpandedChange,
  onLeftChange,
  onToggle,
}: MobileGameMenuProps) {
  const menuRef = useRef<HTMLElement>(null);
  const onLeftChangeRef = useRef(onLeftChange);
  onLeftChangeRef.current = onLeftChange;

  useEffect(() => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const reportLeft = (): void => {
      onLeftChangeRef.current(menu.getBoundingClientRect().left);
    };
    reportLeft();
    const observer = new ResizeObserver(reportLeft);
    observer.observe(menu);
    window.addEventListener("resize", reportLeft);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reportLeft);
    };
  }, [expanded]);

  useEffect(() => {
    return () => {
      onLeftChangeRef.current(null);
    };
  }, []);

  return (
    <aside
      ref={menuRef}
      className="mobile-game-menu"
      aria-label="Game options"
      style={
        handTop === null ? undefined : { bottom: `calc(100% - ${handTop}px)` }
      }
    >
      {expanded && (
        <div className="mobile-game-menu-options">
          {OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="mobile-game-option"
              aria-pressed={flags[key]}
              onClick={() => onToggle(key)}
            >
              <span>{label}</span>
              <i aria-hidden="true">{flags[key] && <Check />}</i>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="mobile-game-menu-toggle"
        aria-label={expanded ? "Close game options" : "Expand game options"}
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
    </aside>
  );
}
