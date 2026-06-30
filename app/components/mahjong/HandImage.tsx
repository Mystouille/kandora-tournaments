import { useEffect, useState } from "react";
import { theme } from "antd";
import { basePath } from "../../utils/basePath";
import {
  MeldSource,
  MeldType,
  TILE_SETS,
  TileSetName,
  type TileSetConfig,
  getCalledTilePosition,
  getMeldUprightPosition,
  getTilePosition,
  parseHand,
} from "./handLayout";

// Re-export config types/values that other modules import from this file.
export { TILE_SETS, TileSetName, type TileSetConfig } from "./handLayout";

/* ---------- canvas drawing ---------- */

const MELD_GAP = 16;
const LAST_TILE_GAP = 8;

interface TileDraw {
  tile: string;
  x: number;
  tilted: boolean;
  /** Whether this is an upright tile inside a meld (for flipMeldUpright) */
  inMeld: boolean;
}

function layoutHand(
  hand: string,
  cfg: TileSetConfig,
  separateLastTile?: boolean
) {
  const { closedTiles, closedGapsBefore, melds, lastTileSeparated } =
    parseHand(hand);
  const effectiveSeparate = separateLastTile ?? lastTileSeparated;
  const draws: TileDraw[] = [];
  const gap = cfg.tileGap ?? 0;
  let x = 0;

  for (let i = 0; i < closedTiles.length; i++) {
    const explicitGapUnits = closedGapsBefore[i] ?? 0;
    if (explicitGapUnits > 0) {
      x += explicitGapUnits * LAST_TILE_GAP;
    } else if (effectiveSeparate && i === closedTiles.length - 1) {
      x += LAST_TILE_GAP;
    }
    draws.push({ tile: closedTiles[i], x, tilted: false, inMeld: false });
    x += cfg.tileW + gap;
  }

  for (const meld of melds) {
    x += MELD_GAP;
    // 8z is already the back tile sprite (col 7 of honors row); render as-is.
    const displayTiles = meld.tiles;
    for (let i = 0; i < displayTiles.length; i++) {
      const isTilted =
        meld.type !== MeldType.Ankan &&
        ((i === 0 && meld.source === MeldSource.Kamicha) ||
          (i === 1 && meld.source === MeldSource.Toimen) ||
          (i === displayTiles.length - 1 &&
            meld.source === MeldSource.Shimocha));

      draws.push({
        tile: displayTiles[i],
        x,
        tilted: isTilted,
        inMeld: !isTilted,
      });
      if (isTilted) {
        x += cfg.calledW;
      } else if (cfg.meldUprightW) {
        x += cfg.meldUprightW;
      } else {
        x += cfg.tileW;
      }
    }
  }

  return { draws, totalWidth: x, totalHeight: cfg.tileH };
}

// Module-level cache so spritesheets are only fetched & decoded once per src
// across the whole app lifetime, regardless of how many times users switch
// tile styles. Stores the in-flight promise on first call so concurrent
// requesters share the same fetch.
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) {
    return cached;
  }
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => {
      // Don't poison the cache on transient errors — allow a retry next time.
      imageCache.delete(src);
      reject(err);
    };
    img.crossOrigin = "anonymous";
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

async function renderHandToDataUrl(
  hand: string,
  cfg: TileSetConfig,
  drawBorder: boolean,
  displayScale: number,
  separateLastTile?: boolean
): Promise<string> {
  const { draws, totalWidth, totalHeight } = layoutHand(
    hand,
    cfg,
    separateLastTile
  );

  // Render at 2x the display size for sharper downscaling
  const scaleFactor = displayScale * 2;
  const canvasW = Math.round(totalWidth * scaleFactor);
  const canvasH = Math.round(totalHeight * scaleFactor);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const imagePromises: Promise<HTMLImageElement>[] = [
    loadImage(`${basePath}/tiles/${cfg.tilesImage}`),
    loadImage(`${basePath}/tiles/${cfg.calledImage}`),
  ];
  if (cfg.meldUprightImage) {
    imagePromises.push(loadImage(`${basePath}/tiles/${cfg.meldUprightImage}`));
  }
  const [tilesImg, calledImg, meldUprightImg] =
    await Promise.all(imagePromises);

  const muW = cfg.meldUprightW ?? cfg.tileW;
  const muH = cfg.meldUprightH ?? cfg.tileH;

  for (const d of draws) {
    const dx = d.x * scaleFactor;
    if (d.tilted) {
      const pos = getCalledTilePosition(d.tile, cfg);
      const yOffset = (cfg.tileH - cfg.calledH) * scaleFactor;
      ctx.drawImage(
        calledImg,
        pos.x,
        pos.y,
        cfg.calledW,
        cfg.calledH,
        dx,
        yOffset,
        cfg.calledW * scaleFactor,
        cfg.calledH * scaleFactor
      );
    } else if (d.inMeld && meldUprightImg) {
      const pos = getMeldUprightPosition(d.tile, muW, muH, cfg);
      const yOffset = (cfg.tileH - muH) * scaleFactor;
      ctx.drawImage(
        meldUprightImg,
        pos.x,
        pos.y,
        muW,
        muH,
        dx,
        yOffset,
        muW * scaleFactor,
        muH * scaleFactor
      );
    } else {
      const pos = getTilePosition(d.tile, cfg);
      ctx.drawImage(
        tilesImg,
        pos.x,
        pos.y,
        cfg.tileW,
        cfg.tileH,
        dx,
        0,
        cfg.tileW * scaleFactor,
        cfg.tileH * scaleFactor
      );
    }
  }

  if (drawBorder) {
    const r = (cfg.borderRadius ?? 0) * scaleFactor;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1 * scaleFactor;
    for (const d of draws) {
      const dx = d.x * scaleFactor;
      if (d.tilted) {
        const yOffset = (cfg.tileH - cfg.calledH) * scaleFactor;
        ctx.beginPath();
        ctx.roundRect(
          dx + 0.5,
          yOffset + 0.5,
          cfg.calledW * scaleFactor - 1,
          cfg.calledH * scaleFactor - 1,
          r
        );
        ctx.stroke();
      } else if (d.inMeld && cfg.meldUprightW && cfg.meldUprightH) {
        const yOffset = (cfg.tileH - cfg.meldUprightH) * scaleFactor;
        ctx.beginPath();
        ctx.roundRect(
          dx + 0.5,
          yOffset + 0.5,
          cfg.meldUprightW * scaleFactor - 1,
          cfg.meldUprightH * scaleFactor - 1,
          r
        );
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.roundRect(
          dx + 0.5,
          0.5,
          cfg.tileW * scaleFactor - 1,
          cfg.tileH * scaleFactor - 1,
          r
        );
        ctx.stroke();
      }
    }
  }

  return canvas.toDataURL("image/png");
}

/* ---------- component ---------- */

interface HandImageProps {
  hand: string;
  tileHeight?: number;
  tileSet?: TileSetName;
  /**
   * Override automatic last-tile separation. When the hand has 2 tiles past a
   * multiple of 3 (i.e. it includes a drawn winning tile), the last tile is
   * normally rendered with a small gap. Pass `false` to disable that gap, or
   * `true` to force it.
   */
  separateLastTile?: boolean;
}

export function HandImage({
  hand,
  tileHeight = 64,
  tileSet = TileSetName.MahjongSoul,
  separateLastTile,
}: HandImageProps) {
  const cfg: TileSetConfig = TILE_SETS[tileSet];
  const { token } = theme.useToken();
  const isDark =
    token.colorBgBase === "#000" ||
    token.colorBgBase === "#000000" ||
    (token.colorBgBase ?? "").startsWith("#0") ||
    (token.colorBgBase ?? "").startsWith("#1");
  const drawBorder = !!(cfg.lightBorder && !isDark);
  const effectiveHeight = tileHeight * (cfg.displayScale ?? 1);
  const [src, setSrc] = useState<string | null>(null);
  const scale = effectiveHeight / cfg.tileH;

  useEffect(() => {
    let cancelled = false;
    renderHandToDataUrl(hand, cfg, drawBorder, scale, separateLastTile).then(
      (url) => {
        if (!cancelled) {
          setSrc(url);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [hand, tileSet, drawBorder, scale, separateLastTile]);

  if (!src) {
    return null;
  }

  const { totalWidth } = layoutHand(hand, cfg, separateLastTile);
  const width = Math.round(totalWidth * scale);

  return (
    <a
      download={`${hand}.png`}
      href={src}
      draggable={false}
      onClick={(e) => e.preventDefault()}
      style={{
        cursor: "default",
        display: "inline-block",
        lineHeight: 0,
        verticalAlign: "middle",
        maxWidth: "100%",
      }}
    >
      <img
        src={src}
        alt={hand}
        data-hand={hand}
        style={{
          width,
          maxWidth: "100%",
          height: "auto",
          display: "block",
        }}
      />
    </a>
  );
}

/* ---------- single tile canvas component ---------- */

async function renderTileToDataUrl(
  tile: string,
  cfg: TileSetConfig,
  displayHeight: number,
  drawBorder: boolean
): Promise<string> {
  const scale = displayHeight / cfg.tileH;
  // Render at 2x display size for sharpness
  const factor = scale * 2;
  const canvasW = Math.round(cfg.tileW * factor);
  const canvasH = Math.round(cfg.tileH * factor);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const img = await loadImage(`${basePath}/tiles/${cfg.tilesImage}`);
  const pos = getTilePosition(tile, cfg);

  ctx.drawImage(
    img,
    pos.x,
    pos.y,
    cfg.tileW,
    cfg.tileH,
    0,
    0,
    canvasW,
    canvasH
  );

  if (drawBorder) {
    const r = (cfg.borderRadius ?? 0) * factor;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1 * factor;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, canvasW - 1, canvasH - 1, r);
    ctx.stroke();
  }

  return canvas.toDataURL("image/png");
}

interface TileImageProps {
  tile: string;
  height?: number;
  tileSet?: TileSetName;
}

export function TileImage({
  tile,
  height = 22,
  tileSet = TileSetName.Trainer,
}: TileImageProps) {
  const cfg: TileSetConfig = TILE_SETS[tileSet];
  const { token } = theme.useToken();
  const isDark =
    (token.colorBgBase ?? "").startsWith("#0") ||
    (token.colorBgBase ?? "").startsWith("#1");
  const drawBorder = !!(cfg.lightBorder && !isDark);
  const displayHeight = height * (cfg.displayScale ?? 1);
  const [src, setSrc] = useState<string | null>(null);
  const displayWidth = Math.round(cfg.tileW * (displayHeight / cfg.tileH));

  useEffect(() => {
    let cancelled = false;
    renderTileToDataUrl(tile, cfg, displayHeight, drawBorder).then((url) => {
      if (!cancelled) {
        setSrc(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tile, tileSet, displayHeight, drawBorder]);

  if (!src) {
    return null;
  }

  // Center tile vertically on text without increasing line height.
  // Negative vertical margins let the tile overflow above/below the text line
  // without pushing the line box taller.
  const vMargin = -(displayHeight - 16) / 2;

  return (
    <img
      src={src}
      alt={tile}
      style={{
        width: displayWidth,
        height: displayHeight,
        display: "inline-block",
        verticalAlign: "middle",
        marginTop: vMargin,
        marginBottom: vMargin,
      }}
    />
  );
}
