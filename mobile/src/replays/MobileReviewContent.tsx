import parse, { Element, type DOMNode } from "html-react-parser";
import {
  getTilePosition,
  splitHandTiles,
  TILE_SETS,
  TileSetName,
} from "~/core/ui/mahjong/handLayout";

const TILE_REGEX = /^[0-9][mpsz]$/;
const TILE_SHEET_COLUMNS = 10;
const TILE_SHEET_ROWS = 4;
const INLINE_TILE_HEIGHT = 30;
const HAND_TILE_HEIGHT = 28;
const TENHOU_TILES = TILE_SETS[TileSetName.Tenhou];
const TENHOU_INLINE_CONFIG = {
  ...TENHOU_TILES,
  tileW: TENHOU_TILES.inlineTileW,
  tileH: TENHOU_TILES.inlineTileH,
};

function MobileReviewTile({ tile, height }: { tile: string; height: number }) {
  const scale = height / TENHOU_INLINE_CONFIG.tileH;
  const width = TENHOU_INLINE_CONFIG.tileW * scale;
  const position = getTilePosition(tile, TENHOU_INLINE_CONFIG);
  return (
    <span
      className="mobile-review-tile"
      role="img"
      aria-label={tile}
      style={{
        width,
        height,
        backgroundImage: `url(${TENHOU_INLINE_CONFIG.inlineTilesImageUrl})`,
        backgroundPosition: `-${position.x * scale}px -${position.y * scale}px`,
        backgroundSize: `${TILE_SHEET_COLUMNS * width}px ${TILE_SHEET_ROWS * height}px`,
      }}
    />
  );
}

function MobileReviewHand({ hand, label }: { hand: string; label: string }) {
  const tiles = splitHandTiles(hand).filter((tile) => TILE_REGEX.test(tile));
  if (tiles.length === 0) {
    return null;
  }
  return (
    <figure className="mobile-review-hand">
      <span>
        {tiles.map((tile, index) => (
          <MobileReviewTile
            key={`${tile}:${index}`}
            tile={tile}
            height={HAND_TILE_HEIGHT}
          />
        ))}
      </span>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}

export function MobileReviewContent({ html }: { html: string }) {
  return (
    <div className="mobile-review-rich-text">
      {parse(html, {
        replace(domNode: DOMNode) {
          if (!(domNode instanceof Element)) {
            return;
          }
          if (domNode.name === "mahjong-tile") {
            const tile = domNode.attribs["data-tile"] ?? "";
            return TILE_REGEX.test(tile) ? (
              <MobileReviewTile tile={tile} height={INLINE_TILE_HEIGHT} />
            ) : (
              <></>
            );
          }
          if (domNode.name === "mahjong-hand") {
            return (
              <MobileReviewHand
                hand={domNode.attribs["data-hand"] ?? ""}
                label={domNode.attribs["data-label"] ?? ""}
              />
            );
          }
        },
      })}
    </div>
  );
}
