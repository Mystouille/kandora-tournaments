import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img",
  "video",
  "source",
  "iframe",
  "mahjong-tile",
  "mahjong-hand",
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  ...sanitizeHtml.defaults.allowedAttributes,
  img: ["src", "alt", "title", "width", "height"],
  video: [
    "src",
    "controls",
    "preload",
    "playsinline",
    "muted",
    "loop",
    "poster",
    "width",
    "height",
    "style",
  ],
  source: ["src", "type"],
  iframe: [
    "src",
    "width",
    "height",
    "frameborder",
    "allow",
    "allowfullscreen",
    "loading",
    "referrerpolicy",
    "title",
  ],
  div: ["data-embed", "data-src", "data-provider", "class"],
  "mahjong-tile": ["data-tile"],
  "mahjong-hand": ["data-hand", "data-label"],
  a: ["href", "target", "rel"],
};

// Only allow iframes pointing to trusted embed providers
const ALLOWED_IFRAME_HOSTNAMES = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
];

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https"],
    allowedIframeHostnames: ALLOWED_IFRAME_HOSTNAMES,
  });
}
