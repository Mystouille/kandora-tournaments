import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    video: {
      setVideo: (options: { src: string }) => ReturnType;
    };
  }
}

/**
 * Self-hosted HTML5 <video> node. Renders as <video controls src="..."> with
 * a responsive max-width. The src is typically a URL returned from the
 * /api/uploads endpoint (mp4/webm/ogg/mov).
 */
export const VideoExtension = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("src"),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.src) {
            return {};
          }
          return { src: attributes.src };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "video[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(HTMLAttributes, {
        controls: "controls",
        preload: "metadata",
        playsinline: "true",
        style: "max-width: 100%; height: auto; display: block; margin: 1em 0;",
      }),
    ];
  },

  addCommands() {
    return {
      setVideo:
        (options) =>
        ({ commands }) => {
          if (!options.src) {
            return false;
          }
          return commands.insertContent({
            type: this.name,
            attrs: { src: options.src },
          });
        },
    };
  },
});
