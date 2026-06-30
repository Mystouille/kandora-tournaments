import { theme } from "antd";
import { basePath } from "../../utils/basePath";

import { HandImage } from "./HandImage";
import {
  MeldSource,
  MeldType,
  TILE_SETS,
  TileSetName,
  type MeldToDisplay,
  type TileSetConfig,
  getCalledTilePosition,
  getMeldUprightPosition,
  getTilePosition,
  parseHand,
} from "./handLayout";

// Re-export for back-compat with existing import sites.
export { splitHandTiles } from "./handLayout";

const SHEET_COLS = 10;

interface TileSpriteProps {
  /** Tile code, e.g. "1m", "5p", "9s" */
  tile: string;
  /** Display height in px (width is auto-scaled to keep aspect ratio) */
  height?: number;
  tileSet?: TileSetName;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Renders a single mahjong tile from the spritesheet using CSS background clipping.
 */
export function TileSprite({
  tile,
  height = 48,
  tileSet = TileSetName.MahjongSoul,
  style,
  className,
}: TileSpriteProps) {
  const cfg: TileSetConfig = TILE_SETS[tileSet];
  const { token } = theme.useToken();
  const isDark =
    (token.colorBgBase ?? "").startsWith("#0") ||
    (token.colorBgBase ?? "").startsWith("#1");
  const showBorder = !!(cfg.lightBorder && !isDark);
  const scale = height / cfg.tileH;
  const borderRadiusPx = cfg.borderRadius
    ? Math.round(cfg.borderRadius * scale)
    : undefined;
  const width = Math.round(cfg.tileW * scale);
  const displayHeight = Math.round(cfg.tileH * scale);
  const pos = getTilePosition(tile, cfg);

  return (
    <div
      className={className}
      style={{
        width,
        height: displayHeight,
        backgroundImage: `url(${basePath}/tiles/${cfg.tilesImage})`,
        backgroundPosition: `-${pos.x * scale}px -${pos.y * scale}px`,
        backgroundSize: `${SHEET_COLS * cfg.tileW * scale}px auto`,
        backgroundRepeat: "no-repeat",
        display: "inline-block",
        flexShrink: 0,
        outline: showBorder ? "1px solid #000" : undefined,
        outlineOffset: showBorder ? "-1px" : undefined,
        borderRadius: borderRadiusPx,
        ...style,
      }}
    />
  );
}

interface HandDisplayProps {
  /** Hand string e.g. "1m1m2m3m4m4m5m5m6m7m8m9m9m" */
  hand: string;
  /** Tile display height */
  tileHeight?: number;
  tileSet?: TileSetName;
  /** Override automatic last-tile separation. */
  separateLastTile?: boolean;
}

/**
 * Called/tilted tile spritesheet constants.
 * tilesCalled.png is a 10×4 grid of 116×91px tiles (same layout as tiles.png).
 */
const CALLED_SHEET_COLS = 10;

/** Renders a tile using the pre-rotated tilesCalled.png spritesheet */
function TiltedTileSprite({
  tile,
  height,
  tileSet = TileSetName.MahjongSoul,
}: {
  tile: string;
  height: number;
  tileSet?: TileSetName;
}) {
  const cfg: TileSetConfig = TILE_SETS[tileSet];
  const { token } = theme.useToken();
  const isDark =
    (token.colorBgBase ?? "").startsWith("#0") ||
    (token.colorBgBase ?? "").startsWith("#1");
  const showBorder = !!(cfg.lightBorder && !isDark);
  const msf = cfg.meldScaleFactor ?? 1;
  const scale = (height / cfg.tileH) * msf;
  const borderRadiusPx = cfg.borderRadius
    ? Math.round(cfg.borderRadius * scale)
    : undefined;
  const calledW = Math.round(cfg.calledW * scale);
  const calledH = Math.round(cfg.calledH * scale);
  const bgW = CALLED_SHEET_COLS * calledW;
  const bgH = 4 * calledH;
  const pos = getCalledTilePosition(tile, cfg);
  const col = pos.x / cfg.calledW;
  const row = pos.y / cfg.calledH;

  return (
    <div
      style={{
        width: calledW,
        height: calledH,
        backgroundImage: `url(${basePath}/tiles/${cfg.calledImage})`,
        backgroundPosition: `-${col * calledW}px -${row * calledH}px`,
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundRepeat: "no-repeat",
        flexShrink: 0,
        outline: showBorder ? "1px solid #000" : undefined,
        outlineOffset: showBorder ? "-1px" : undefined,
        borderRadius: borderRadiusPx,
      }}
    />
  );
}

/** Renders an upright meld tile from the meldUpright spritesheet */
function MeldUprightTileSprite({
  tile,
  height,
  tileSet = TileSetName.MahjongSoul,
}: {
  tile: string;
  height: number;
  tileSet?: TileSetName;
}) {
  const cfg: TileSetConfig = TILE_SETS[tileSet];
  const muW = cfg.meldUprightW!;
  const muH = cfg.meldUprightH!;
  const msf = cfg.meldScaleFactor ?? 1;
  const scale = (height / cfg.tileH) * msf;
  const w = Math.round(muW * scale);
  const h = Math.round(muH * scale);
  const pos = getMeldUprightPosition(tile, muW, muH, cfg);
  const col = Math.round(pos.x / muW);
  const row = Math.round(pos.y / muH);

  return (
    <div
      style={{
        width: w,
        height: h,
        backgroundImage: `url(${basePath}/tiles/${cfg.meldUprightImage})`,
        backgroundPosition: `-${col * w}px -${row * h}px`,
        backgroundSize: `${CALLED_SHEET_COLS * w}px ${4 * h}px`,
        backgroundRepeat: "no-repeat",
        flexShrink: 0,
      }}
    />
  );
}

/** Renders a single meld group */
function MeldDisplay({
  meld,
  tileHeight,
  tileSet,
}: {
  meld: MeldToDisplay;
  tileHeight: number;
  tileSet?: TileSetName;
}) {
  const cfg: TileSetConfig = TILE_SETS[tileSet ?? TileSetName.MahjongSoul];
  const tiles = [...meld.tiles];
  // 8z is the back tile sprite (col 7 of honors row); render as-is.
  const displayTiles = tiles;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        alignSelf: "flex-end",
        gap: 0,
        marginLeft: 16,
        marginBottom: 3,
      }}
    >
      {displayTiles.map((tile, i) => {
        const isTilted =
          meld.type !== MeldType.Ankan &&
          ((i === 0 && meld.source === MeldSource.Kamicha) ||
            (i === 1 && meld.source === MeldSource.Toimen) ||
            (i === displayTiles.length - 1 &&
              meld.source === MeldSource.Shimocha));

        if (isTilted) {
          return (
            <TiltedTileSprite
              key={i}
              tile={tile}
              height={tileHeight}
              tileSet={tileSet}
            />
          );
        }
        if (cfg.meldUprightImage) {
          return (
            <MeldUprightTileSprite
              key={i}
              tile={tile}
              height={tileHeight}
              tileSet={tileSet}
            />
          );
        }
        return (
          <TileSprite
            key={i}
            tile={tile}
            height={tileHeight}
            tileSet={tileSet}
          />
        );
      })}
    </div>
  );
}

/**
 * Renders a full mahjong hand as a row of tile sprites,
 * including melds with tilted called tiles.
 */
export function HandDisplay({
  hand,
  tileHeight = 64,
  tileSet,
  separateLastTile,
}: HandDisplayProps) {
  return (
    <HandImage
      hand={hand}
      tileHeight={tileHeight}
      tileSet={tileSet}
      separateLastTile={separateLastTile}
    />
  );
}

interface TileOptionProps {
  tile: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  height?: number;
  tileSet?: TileSetName;
}

/**
 * A clickable tile option used for answer selection.
 */
export function TileOption({
  tile,
  selected,
  disabled,
  onClick,
  height = 48,
  tileSet,
}: TileOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: 3,
        border: selected ? "3px solid #1677ff" : "3px solid transparent",
        borderRadius: 6,
        background: selected ? "rgba(22, 119, 255, 0.08)" : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "border-color 0.15s, background 0.15s",
        lineHeight: 0,
      }}
    >
      <TileSprite tile={tile} height={height} tileSet={tileSet} />
    </button>
  );
}

interface InteractiveHandDisplayProps {
  /** Hand string e.g. "1m2m3m4p5p6p" or "123m456p" */
  hand: string;
  /** Index of the currently selected tile in the hand, or null */
  selectedIndex: number | null;
  /** Correct answer tile codes (shown after submission) */
  answerTiles?: string[];
  /** Whether interaction is disabled (after answering) */
  disabled: boolean;
  /** Whether we are in "answering" state (no answer feedback yet) */
  answering: boolean;
  /** Callback when a tile at a given index is clicked */
  onTileClick: (index: number, tile: string) => void;
  /** Tile display height */
  tileHeight?: number;
  /** Success color for correct answer borders */
  colorSuccess?: string;
  /** Error color for wrong answer borders */
  colorError?: string;
  /** Override whether the last tile is visually separated (drawn tile gap) */
  separateLastTile?: boolean;
  tileSet?: TileSetName;
}

/**
 * Renders a hand where each tile is clickable for answer selection.
 * Only the specific clicked tile instance is highlighted.
 * The last tile is separated by a small gap (drawn tile).
 */
export function InteractiveHandDisplay({
  hand,
  selectedIndex,
  answerTiles,
  disabled,
  answering,
  onTileClick,
  tileHeight = 64,
  colorSuccess = "#52c41a",
  colorError = "#ff4d4f",
  separateLastTile,
  tileSet,
}: InteractiveHandDisplayProps) {
  const cfg: TileSetConfig = TILE_SETS[tileSet ?? TileSetName.MahjongSoul];
  const effectiveHeight = tileHeight * (cfg.displayScale ?? 1);
  const tileGap = cfg.tileGap ?? 0;
  const { closedTiles, melds, lastTileSeparated } = parseHand(hand);
  const effectiveSeparate = separateLastTile ?? lastTileSeparated;

  // After submission: find which index to highlight for each answer tile
  const answerHighlightIndices = new Set<number>();
  if (!answering && answerTiles) {
    for (const answerTile of answerTiles) {
      if (selectedIndex !== null && closedTiles[selectedIndex] === answerTile) {
        answerHighlightIndices.add(selectedIndex);
      } else {
        const firstIdx = closedTiles.indexOf(answerTile);
        if (firstIdx !== -1) {
          answerHighlightIndices.add(firstIdx);
        }
      }
    }
  }

  return (
    <div
      data-hand={hand}
      style={{
        display: "inline-flex",
        justifyContent: "center",
        alignItems: "flex-end",
        flexWrap: "nowrap",
        gap: 0,
      }}
    >
      {closedTiles.map((tile, i) => {
        const isSelected = selectedIndex === i;
        const isAnswerHighlight = answerHighlightIndices.has(i);
        const isLastTile = effectiveSeparate && i === closedTiles.length - 1;

        let borderColor = "transparent";
        let missedAnswer = false;
        if (answering) {
          if (isSelected) {
            borderColor = "#1677ff";
          }
        } else {
          if (isAnswerHighlight && isSelected) {
            borderColor = colorSuccess;
          } else if (isAnswerHighlight && !isSelected) {
            missedAnswer = true;
          } else if (isSelected && !isAnswerHighlight) {
            borderColor = colorError;
          }
        }

        const showSelected = answering
          ? isSelected
          : isAnswerHighlight || isSelected;

        return (
          <div
            key={`${tile}-${i}`}
            style={{
              position: "relative",
              display: "inline-block",
              marginLeft: isLastTile ? 8 : i > 0 ? tileGap : 0,
              lineHeight: 0,
            }}
          >
            <button
              type="button"
              onClick={() => onTileClick(i, tile)}
              disabled={disabled}
              style={{
                padding: 0,
                margin: 0,
                border: "none",
                borderBottom: `3px solid ${borderColor}`,
                borderTop: `3px solid ${borderColor}`,
                background: showSelected
                  ? "rgba(22, 119, 255, 0.08)"
                  : "transparent",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "border-color 0.15s, background 0.15s",
                lineHeight: 0,
              }}
            >
              <TileSprite
                tile={tile}
                height={effectiveHeight}
                tileSet={tileSet}
              />
            </button>
            {missedAnswer && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderTop: `3px solid ${colorSuccess}`,
                  borderBottom: `3px solid ${colorSuccess}`,
                  pointerEvents: "none",
                  opacity: 0.4,
                }}
              />
            )}
          </div>
        );
      })}
      {melds.map((meld, i) => (
        <MeldDisplay
          key={i}
          meld={meld}
          tileHeight={effectiveHeight}
          tileSet={tileSet}
        />
      ))}
    </div>
  );
}
