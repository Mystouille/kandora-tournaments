import { Node, mergeAttributes } from "@tiptap/core";

export type EmbedProvider = "youtube" | "vimeo";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embed: {
      setEmbed: (options: { url: string }) => ReturnType;
    };
  }
}

/**
 * Parses a YouTube/Vimeo URL and returns the canonical embed URL plus
 * provider. Returns null if the URL is not a recognised provider URL.
 */
export function parseEmbedUrl(
  raw: string
): { provider: EmbedProvider; embedUrl: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  // YouTube: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID,
  // youtube.com/shorts/ID
  if (host === "youtube.com" || host === "m.youtube.com") {
    let id = url.searchParams.get("v") ?? "";
    if (!id) {
      const m = url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/);
      if (m) {
        id = m[1];
      }
    }
    if (id) {
      return {
        provider: "youtube",
        embedUrl: `https://www.youtube.com/embed/${id}`,
      };
    }
  }
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "").split("/")[0];
    if (id) {
      return {
        provider: "youtube",
        embedUrl: `https://www.youtube.com/embed/${id}`,
      };
    }
  }

  // Vimeo: vimeo.com/ID, player.vimeo.com/video/ID
  if (host === "vimeo.com") {
    const id = url.pathname.replace(/^\//, "").split("/")[0];
    if (/^\d+$/.test(id)) {
      return {
        provider: "vimeo",
        embedUrl: `https://player.vimeo.com/video/${id}`,
      };
    }
  }
  if (host === "player.vimeo.com") {
    const m = url.pathname.match(/^\/video\/(\d+)/);
    if (m) {
      return {
        provider: "vimeo",
        embedUrl: `https://player.vimeo.com/video/${m[1]}`,
      };
    }
  }

  return null;
}

/**
 * Block node that renders a responsive 16:9 iframe wrapper for YouTube/Vimeo
 * embeds. We use a custom wrapper element so the editor can identify our
 * embeds and so the renderer can apply consistent responsive styling.
 */
export const EmbedExtension = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-src") ??
          element.querySelector("iframe")?.getAttribute("src") ??
          "",
        renderHTML: (attributes: Record<string, any>) => ({
          "data-src": attributes.src,
        }),
      },
      provider: {
        default: "youtube",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-provider") ?? "youtube",
        renderHTML: (attributes: Record<string, any>) => ({
          "data-provider": attributes.provider,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const src = node.attrs.src as string;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-embed": "true",
        class: "rich-text-embed",
      }),
      [
        "iframe",
        {
          src,
          frameborder: "0",
          allow:
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
          allowfullscreen: "true",
          loading: "lazy",
          referrerpolicy: "strict-origin-when-cross-origin",
        },
      ],
    ];
  },

  addCommands() {
    return {
      setEmbed:
        (options) =>
        ({ commands }) => {
          const parsed = parseEmbedUrl(options.url);
          if (!parsed) {
            return false;
          }
          return commands.insertContent({
            type: this.name,
            attrs: { src: parsed.embedUrl, provider: parsed.provider },
          });
        },
    };
  },
});
