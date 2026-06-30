import React, { createContext, useContext, useState, useEffect } from "react";
import { TileSetName } from "../components/mahjong/HandImage";

const STORAGE_KEY = "tile-set-preference";

interface TileSetContextType {
  tileSet: TileSetName;
  setTileSet: (value: TileSetName) => void;
}

const TileSetContext = createContext<TileSetContextType | undefined>(undefined);

export const useTileSet = (): TileSetContextType => {
  const context = useContext(TileSetContext);
  if (!context) {
    throw new Error("useTileSet must be used within a TileSetProvider");
  }
  return context;
};

const VALID_VALUES = new Set<string>(Object.values(TileSetName));

function loadFromStorage(): TileSetName {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && VALID_VALUES.has(v)) {
      return v as TileSetName;
    }
  } catch {
    // ignore
  }
  return TileSetName.MahjongSoul;
}

interface TileSetProviderProps {
  children: React.ReactNode;
}

export const TileSetProvider: React.FC<TileSetProviderProps> = ({
  children,
}) => {
  const [tileSet, setTileSetState] = useState<TileSetName>(loadFromStorage);

  const setTileSet = (value: TileSetName) => {
    setTileSetState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // ignore
    }
  };

  // Sync from localStorage on mount (SSR hydration)
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored !== tileSet) {
      setTileSetState(stored);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TileSetContext.Provider value={{ tileSet, setTileSet }}>
      {children}
    </TileSetContext.Provider>
  );
};

/**
 * Wraps children in a `TileSetContext.Provider` with a fixed
 * `tileSet`, ignoring the user's preferred set. Used to force
 * a specific style (e.g. tenhou) inside isolated parts of the
 * UI such as the replay review annotations.
 *
 * `setTileSet` becomes a no-op so consumers can't accidentally
 * mutate the global preference from inside the override.
 */
interface FixedTileSetProviderProps {
  tileSet: TileSetName;
  children: React.ReactNode;
}

export const FixedTileSetProvider: React.FC<FixedTileSetProviderProps> = ({
  tileSet,
  children,
}) => {
  return (
    <TileSetContext.Provider value={{ tileSet, setTileSet: () => {} }}>
      {children}
    </TileSetContext.Provider>
  );
};
