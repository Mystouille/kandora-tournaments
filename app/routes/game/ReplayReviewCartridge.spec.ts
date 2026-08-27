import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: {
      review: {
        cartridge: {
          textReview: "Text review",
          freehandDrawing: "Freehand drawing",
          addTextTooltip: "Add text comment",
          drawTooltip: "Freehand draw",
          removeDrawingTooltip: "Remove drawings from this event",
          deleteTextTooltip: "Delete this text annotation",
          textPlaceholder:
            'Write your comment here. Type "1234s " to insert tiles.',
          hideEditor: "Hide",
          save: "Save",
          cancel: "Exit",
          undoAll: "Cancel",
          drawHint: "Draw on the table. Submit when done.",
          nothingToSave: "Nothing to save",
          discardAllTooltip: "Discard all non-published annotations",
          seatLockedTooltip: "Locked to {name}",
        },
      },
    },
  }),
}));

vi.mock("~/components/editor/RichTextEditor", () => ({
  RichTextEditor: ({ placeholder }: { placeholder?: string }) =>
    createElement("div", { "data-editor-placeholder": placeholder }),
}));

import { ReplayReviewCartridge } from "./ReplayReviewCartridge";

describe("ReplayReviewCartridge", () => {
  it("separates icon-only text and freehand tools", () => {
    const html = renderToStaticMarkup(
      createElement(ReplayReviewCartridge, {
        canEdit: true,
        savedText: "",
        savedHasDrawing: true,
        savedStrokes: [],
        draft: { mode: null, text: "", strokes: [] },
        onDraftChange: vi.fn(),
        onSubmitText: vi.fn(),
        onSubmitDrawing: vi.fn(),
        onRemoveDrawing: vi.fn(),
        publishing: false,
        seatMismatch: false,
        reviewSeatName: "",
        annotationBottom: "0px",
        onTextEditorHeightChange: vi.fn(),
      })
    );

    expect(html).not.toContain("Text review");
    expect(html).not.toContain("Freehand drawing");
    expect(html).toContain('aria-label="Add text comment"');
    expect(html).toContain('aria-label="Freehand draw"');
    expect(html).toContain(
      'aria-label="Remove drawings from this event"'
    );
    expect(html).not.toContain("Discard all non-published annotations");
  });

  it("passes inline tile guidance to the text editor placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(ReplayReviewCartridge, {
        canEdit: true,
        savedText: "",
        savedHasDrawing: false,
        savedStrokes: [],
        draft: { mode: "text", text: "", strokes: [] },
        onDraftChange: vi.fn(),
        onSubmitText: vi.fn(),
        onSubmitDrawing: vi.fn(),
        onRemoveDrawing: vi.fn(),
        publishing: false,
        seatMismatch: false,
        reviewSeatName: "",
        annotationBottom: "0px",
        onTextEditorHeightChange: vi.fn(),
      })
    );

    expect(html).toContain(
      'data-editor-placeholder="Write your comment here. Type &quot;1234s &quot; to insert tiles."'
    );
    expect(html).toContain(">Hide</span>");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("left-2");
    expect(html).not.toContain("left-14");
  });
});
