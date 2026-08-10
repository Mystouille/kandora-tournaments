export interface RichTextConfig {
  sizeFactor: number;
  handTileHeight: number;
  handMargin: string;
}

export const INLINE_TILE_TO_FONT_RATIO = 22 / 14;

export const DEFAULT_RICH_TEXT_CONFIG: RichTextConfig = {
  sizeFactor: 1,
  handTileHeight: 48,
  handMargin: "16px 0",
};

export const REPLAY_REVIEW_RICH_TEXT_CONFIG: RichTextConfig = {
  ...DEFAULT_RICH_TEXT_CONFIG,
  sizeFactor: 32 / 22,
};

export function richTextFontSize(config: RichTextConfig): string {
  return `${0.875 * config.sizeFactor}rem`;
}
