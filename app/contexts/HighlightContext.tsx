import { createContext, useContext, useState, type ReactNode } from "react";

interface HighlightContextType {
  /** The currently highlighted entity label (player/team name) */
  highlightedLabel: string | null;
  /** Set the highlighted label (call with null to clear) */
  setHighlightedLabel: (label: string | null) => void;
}

const HighlightContext = createContext<HighlightContextType>({
  highlightedLabel: null,
  setHighlightedLabel: () => {},
});

export function HighlightProvider({ children }: { children: ReactNode }) {
  const [highlightedLabel, setHighlightedLabel] = useState<string | null>(null);

  return (
    <HighlightContext.Provider
      value={{ highlightedLabel, setHighlightedLabel }}
    >
      {children}
    </HighlightContext.Provider>
  );
}

export function useHighlight() {
  return useContext(HighlightContext);
}
