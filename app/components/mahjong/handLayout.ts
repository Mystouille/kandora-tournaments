/* ---------- tile set configuration ---------- */

export enum TileSetName {
  MahjongSoul = "default",
  Tenhou = "tenhou",
  Trainer = "trainer",
}

export interface TileSetConfig {
  tileW: number;
  tileH: number;
  calledW: number;
  calledH: number;
  tilesImage: string;
  calledImage: string;
  /** Row order for suits in the spritesheet. Default: s=0, m=1, p=2, z=3. */
  suitRows?: Record<string, number>;
  /** Scale factor for melded tiles (tilted + upright). Default 1. */
  meldScaleFactor?: number;
  /** Separate spritesheet for upright meld tiles (e.g. tenhou style). */
  meldUprightImage?: string;
  meldUprightW?: number;
  meldUprightH?: number;
  /** Global display scale factor applied to tileHeight. Default 1. */
  displayScale?: number;
  /** Gap in pixels between tiles in the hand. Default 0. */
  tileGap?: number;
  /** Show a 1px border around tiles in light theme. Default false. */
  lightBorder?: boolean;
  /** Border radius in spritesheet pixels (scaled proportionally). Default 0. */
  borderRadius?: number;
}

export const TILE_SETS: Record<TileSetName, TileSetConfig> = {
  [TileSetName.MahjongSoul]: {
    tileW: 80,
    tileH: 129,
    calledW: 116,
    calledH: 91,
    tilesImage: "tiles.png",
    calledImage: "tilesCalled.png",
  },
  [TileSetName.Tenhou]: {
    tileW: 67,
    tileH: 101,
    calledW: 55,
    calledH: 50,
    tilesImage: "tilesTenhou.png",
    calledImage: "tilesCalledTenhou.png",
    suitRows: { m: 0, p: 1, s: 2, z: 3 },
    meldScaleFactor: 1.5,
    meldUprightImage: "tilesCalled2Tenhou.png",
    meldUprightW: 41,
    meldUprightH: 62,
  },
  [TileSetName.Trainer]: {
    tileW: 192,
    tileH: 256,
    calledW: 256,
    calledH: 192,
    tilesImage: "tilesTrainer.png",
    calledImage: "tilesCalledTrainer.png",
    displayScale: 0.8,
    tileGap: 2,
    lightBorder: true,
    borderRadius: 22,
  },
};

const DEFAULT_SUIT_ROWS: Record<string, number> = { s: 0, m: 1, p: 2, z: 3 };

export function getSuitRow(suit: string, cfg: TileSetConfig): number {
  return (cfg.suitRows ?? DEFAULT_SUIT_ROWS)[suit] ?? 0;
}

/* ---------- spritesheet positions ---------- */

export interface SpritePos {
  x: number;
  y: number;
}

export function getTilePosition(tile: string, cfg: TileSetConfig): SpritePos {
  const num = parseInt(tile[0], 10);
  const suit = tile[1];
  const row = getSuitRow(suit, cfg);
  const col = suit === "z" ? num - 1 : num;
  return { x: col * cfg.tileW, y: row * cfg.tileH };
}

export function getCalledTilePosition(
  tile: string,
  cfg: TileSetConfig
): SpritePos {
  const num = parseInt(tile[0], 10);
  const suit = tile[1];
  const row = getSuitRow(suit, cfg);
  const col = suit === "z" ? (num - 1) % 8 : num;
  return { x: col * cfg.calledW, y: row * cfg.calledH };
}

export function getMeldUprightPosition(
  tile: string,
  w: number,
  h: number,
  cfg: TileSetConfig
): SpritePos {
  const num = parseInt(tile[0], 10);
  const suit = tile[1];
  const row = getSuitRow(suit, cfg);
  const col = suit === "z" ? (num - 1) % 8 : num;
  return { x: col * w, y: row * h };
}

/* ---------- hand / meld parsing ---------- */

export enum MeldType {
  Chii = "c",
  Pon = "p",
  Shouminkan = "s",
  Daiminkan = "d",
  Ankan = "a",
}

export enum MeldSource {
  Self = 0,
  Shimocha = 1,
  Toimen = 2,
  Kamicha = 3,
}

export interface MeldToDisplay {
  tiles: string[];
  type: MeldType;
  source: MeldSource;
}

export interface ParsedHand {
  closedTiles: string[];
  /**
   * Per-tile extra gap units (each unit ≈ one underscore in the source string,
   * scaled to LAST_TILE_GAP px in HandImage). Same length as `closedTiles`.
   */
  closedGapsBefore: number[];
  melds: MeldToDisplay[];
  lastTileSeparated: boolean;
}

/** Splits a tile string like "1m2m3p" or compressed "123m456p" into ["1m","2m","3p"] */
export function splitHandTiles(hand: string): string[] {
  return splitHandTilesWithGaps(hand).tiles;
}

/**
 * Like {@link splitHandTiles} but also returns per-tile gap units derived from
 * `_` characters. Each `_` between digits/tiles adds one gap unit before the
 * next emitted tile. `__` doubles the gap, etc.
 */
export function splitHandTilesWithGaps(hand: string): {
  tiles: string[];
  gapsBefore: number[];
} {
  const suitLetters = new Set(["m", "p", "s", "z"]);
  const tiles: string[] = [];
  const gapsBefore: number[] = [];
  // Buffered tokens. Digits inherit the next suit; back-tile markers (`x`)
  // are emitted as `8z` regardless of the trailing suit, but their relative
  // position with surrounding digits is preserved.
  type PendingToken =
    | { kind: "digit"; digit: string; gap: number }
    | { kind: "back"; gap: number };
  let pending: PendingToken[] = [];
  let pendingGap = 0;
  const flushBacks = () => {
    for (const p of pending) {
      if (p.kind === "back") {
        tiles.push("8z");
        gapsBefore.push(p.gap);
      }
    }
    pending = [];
  };
  for (let i = 0; i < hand.length; i++) {
    const ch = hand[i];
    if (suitLetters.has(ch)) {
      for (const p of pending) {
        if (p.kind === "digit") {
          tiles.push(p.digit + ch);
        } else {
          tiles.push("8z");
        }
        gapsBefore.push(p.gap);
      }
      pending = [];
      pendingGap = 0;
    } else if (/\d/.test(ch)) {
      pending.push({ kind: "digit", digit: ch, gap: pendingGap });
      pendingGap = 0;
    } else if (ch === "x" || ch === "X") {
      pending.push({ kind: "back", gap: pendingGap });
      pendingGap = 0;
    } else if (ch === "_") {
      pendingGap += 1;
    } else if (ch === " ") {
      // Emit any trailing back-tile markers (no suit needed) and drop
      // unsuited digits.
      flushBacks();
      pendingGap = 0;
    } else {
      // Skip called-tile markers like ' for meld notation
    }
  }
  flushBacks();
  return { tiles, gapsBefore };
}

/** Parse raw meld tiles (with ' markers). */
function splitMeldTiles(raw: string): string[] {
  const suitNames = ["p", "m", "s", "z"];
  const tiles: string[] = [];
  let i = 0;
  let k = 0;
  while (i < raw.length) {
    if (suitNames.includes(raw[i])) {
      const tileSuit = raw[i];
      for (let j = k; j < i; j++) {
        const ch = raw[j];
        const isBack = ch === "x" || ch === "X";
        if (!/\d/.test(ch) && !isBack) {
          continue;
        }
        let called = "";
        if (raw[j + 1] === "'") {
          if (raw[j + 2] === "'") {
            called = "''";
            j++;
          } else {
            called = "'";
          }
          j++;
        }
        if (isBack) {
          tiles.push(`8${called}z`);
        } else {
          tiles.push(`${ch}${called}${tileSuit}`);
        }
      }
      k = i + 1;
    } else if (
      !/\d/.test(raw[i]) &&
      raw[i] !== "'" &&
      raw[i] !== "x" &&
      raw[i] !== "X"
    ) {
      k = i + 1;
    }
    i++;
  }
  return tiles;
}

function parseMelds(meldStr: string): MeldToDisplay[] {
  const meldList = splitMeldTiles(meldStr);
  const blocks: MeldToDisplay[] = [];
  let count = 0;
  let sourceLookup = false;
  let isCalled = false;
  let currentBlock: string[] = [];
  let currentType: MeldType | undefined;
  let currentSource: MeldSource | undefined;

  function pushMeld() {
    const meld: MeldToDisplay = {
      source:
        currentSource ?? (isCalled ? MeldSource.Shimocha : MeldSource.Self),
      type:
        currentType ??
        (isCalled
          ? count === 4
            ? MeldType.Daiminkan
            : MeldType.Pon
          : MeldType.Ankan),
      tiles: currentBlock.map((t) => t[0] + t[t.length - 1]),
    };
    if (
      meld.type === MeldType.Ankan &&
      !currentBlock.find((x) => x.includes("8z"))
    ) {
      const tile = meld.tiles[0];
      meld.tiles = ["8z", tile, tile, "8z"];
    }
    blocks.push(meld);
    count = 0;
  }

  meldList.forEach((tile) => {
    if (count === 4) {
      pushMeld();
    }
    if (
      count === 3 &&
      isCalled &&
      tile[0] + tile[tile.length - 1] !== currentBlock[0]
    ) {
      pushMeld();
    }
    if (currentType === MeldType.Chii && count === 3) {
      pushMeld();
    }

    if (count === 0) {
      currentBlock = [];
      sourceLookup = false;
      isCalled = false;
      currentSource = undefined;
      currentType = undefined;
    }

    if (sourceLookup) {
      currentSource =
        tile[0] === currentBlock[0][0]
          ? MeldSource.Toimen
          : MeldSource.Shimocha;
      sourceLookup = false;
    }
    if (tile.includes("''")) {
      currentType = MeldType.Shouminkan;
      isCalled = true;
    }
    if (tile.includes("'")) {
      isCalled = true;
      sourceLookup = true;
    }
    if (isCalled && count === 0) {
      currentSource = MeldSource.Kamicha;
      sourceLookup = false;
    }
    if (isCalled && count === 2 && currentBlock[0][0] !== currentBlock[1][0]) {
      currentType = MeldType.Chii;
    }
    if (tile === "8z") {
      currentType = MeldType.Ankan;
    }
    if (currentSource === undefined && isCalled) {
      currentSource =
        count === 0
          ? MeldSource.Kamicha
          : count === 1
            ? MeldSource.Toimen
            : undefined;
    }

    currentBlock.push(tile[0] + tile[tile.length - 1]);
    count++;
  });

  if (count === 4) {
    pushMeld();
  }
  if (count === 3) {
    blocks.push({
      source: currentSource ?? MeldSource.Shimocha,
      type: currentType ?? MeldType.Pon,
      tiles: currentBlock.map((t) => t[0] + t[t.length - 1]),
    });
  }
  return blocks;
}

export function parseHand(hand: string): ParsedHand {
  const parts = hand.split(" ");
  const { tiles: closedTiles, gapsBefore: closedGapsBefore } =
    splitHandTilesWithGaps(parts[0]);
  const meldStr = parts.slice(1).join("");
  const melds = meldStr.length > 0 ? parseMelds(meldStr) : [];
  const lastTileSeparated = closedTiles.length % 3 === 2;
  return { closedTiles, closedGapsBefore, melds, lastTileSeparated };
}
