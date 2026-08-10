import parse, {
  type DOMNode,
  Element,
  Text as HtmlText,
} from "html-react-parser";
import { Fragment } from "react";
import { HandDisplay } from "./mahjong/TileDisplay";
import { TileImage } from "./mahjong/HandImage";
import { useTileSet } from "../contexts/TileSetContext";
import { useGlossary } from "../contexts/GlossaryContext";
import { GlossaryTermLink } from "./GlossaryTermLink";
import {
  DEFAULT_RICH_TEXT_CONFIG,
  INLINE_TILE_TO_FONT_RATIO,
  richTextFontSize,
  type RichTextConfig,
} from "./editor/richTextConfig";

interface ArticleContentProps {
  html: string;
  skipTerms?: Set<string>;
  config?: RichTextConfig;
}

const TILE_REGEX = /^[0-9][mpsz]$/;

/**
 * Renders article HTML content with custom mahjong-tile and mahjong-hand
 * elements mapped to React components, and links glossary terms.
 */
export function ArticleContent({
  html,
  skipTerms,
  config = DEFAULT_RICH_TEXT_CONFIG,
}: ArticleContentProps) {
  const { tileSet } = useTileSet();
  const { termPattern, openTerm } = useGlossary();

  const parserOptions = {
    replace(domNode: DOMNode) {
      if (domNode instanceof HtmlText && domNode.data && termPattern) {
        const text = domNode.data;
        termPattern.lastIndex = 0;
        if (!termPattern.test(text)) {
          return;
        }
        // Split text around glossary term matches
        termPattern.lastIndex = 0;
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = termPattern.exec(text)) !== null) {
          if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
          }
          const matched = match[1];
          if (skipTerms?.has(matched.toLowerCase())) {
            parts.push(matched);
          } else {
            parts.push(
              <GlossaryTermLink
                key={`${match.index}-${matched}`}
                text={matched}
                onClick={() => openTerm(matched)}
              />
            );
          }
          lastIndex = termPattern.lastIndex;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }
        if (parts.length > 0) {
          return (
            <>
              {parts.map((p, i) => (
                <Fragment key={i}>{p}</Fragment>
              ))}
            </>
          );
        }
        return;
      }

      if (!(domNode instanceof Element)) {
        return;
      }

      if (domNode.name === "mahjong-tile") {
        const tile = domNode.attribs["data-tile"] ?? "";
        if (TILE_REGEX.test(tile)) {
          return (
            <span
              style={{
                display: "inline-block",
                verticalAlign: "middle",
                lineHeight: 0,
              }}
            >
              <TileImage
                tile={tile}
                sizeFactor={INLINE_TILE_TO_FONT_RATIO}
                tileSet={tileSet}
              />
            </span>
          );
        }
        return <></>;
      }

      if (domNode.name === "mahjong-hand") {
        const hand = domNode.attribs["data-hand"] ?? "";
        const label = domNode.attribs["data-label"] ?? "";
        if (hand) {
          return (
            <div style={{ margin: config.handMargin, textAlign: "center" }}>
              <HandDisplay
                hand={hand}
                tileHeight={config.handTileHeight}
                tileSet={tileSet}
              />
              {label && (
                <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
                  {label}
                </div>
              )}
            </div>
          );
        }
        return <></>;
      }
    },
  };

  return (
    <div
      className="article-content rich-text-content"
      style={{ fontSize: richTextFontSize(config) }}
    >
      {parse(html, parserOptions)}
    </div>
  );
}
