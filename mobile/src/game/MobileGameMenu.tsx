import {
  Check,
  Menu,
  X,
} from "lucide-react";
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
  onExpandedChange: (expanded: boolean) => void;
  onToggle: (key: LivePlayMenuOptionKey) => void;
}

export function MobileGameMenu({
  expanded,
  flags,
  onExpandedChange,
  onToggle,
}: MobileGameMenuProps) {
  return (
    <aside className="mobile-game-menu" aria-label="Game options">
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
              <i aria-hidden="true">
                {flags[key] && <Check />}
              </i>
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