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
          drawingTooLarge: "Drawing too large",
          drawingUnavailable: "Drawing unavailable",
          discardAllTooltip: "Discard all non-published annotations",
          seatLockedTooltip: "Locked to {name}",
        },
      },
    },
  }),
}));

vi.mock("~/components/editor/RichTextEditor", () => ({
  RichTextEditor: ({
    placeholder,
    uiScale,
    config,
  }: {
    placeholder?: string;
    uiScale?: number;
    config?: { sizeFactor: number };
  }) =>
    createElement("div", {
      "data-editor-placeholder": placeholder,
      "data-editor-ui-scale": uiScale,
      "data-editor-size-factor": config?.sizeFactor,
    }),
}));

import { ReplayReviewCartridge } from "./ReplayReviewCartridge";

describe("ReplayReviewCartridge", () => {
  it("disables capture until renderer geometry is available without disabling text", () => {
    const html = renderToStaticMarkup(
      createElement(ReplayReviewCartridge, {
        canEdit: true,
        drawingAvailable: false,
        savedText: "",
        savedHasDrawing: false,
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
    const drawingButton = html.match(
      /<button[^>]*aria-label="Freehand draw"[^>]*>/
    )?.[0];
    const textButton = html.match(
      /<button[^>]*aria-label="Add text comment"[^>]*>/
    )?.[0];
    expect(drawingButton).toContain("disabled");
    expect(textButton).not.toContain("disabled");
  });

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
    expect(html).toContain('aria-label="Remove drawings from this event"');
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

  it("sizes the editor and its popup controls without changing the draft", () => {
    const draft = {
      mode: "text" as const,
      text: "Existing draft",
      strokes: [],
    };
    const html = renderToStaticMarkup(
      createElement(ReplayReviewCartridge, {
        uiScale: 0.75,
        richTextConfig: {
          sizeFactor: 1.1,
          handTileHeight: 36,
          handMargin: "12px 0",
        },
        canEdit: true,
        savedText: "",
        savedHasDrawing: false,
        savedStrokes: [],
        draft,
        onDraftChange: vi.fn(),
        onSubmitText: vi.fn(),
        onSubmitDrawing: vi.fn(),
        onRemoveDrawing: vi.fn(),
        publishing: false,
        seatMismatch: false,
        reviewSeatName: "",
        annotationBottom: "80px",
        onTextEditorHeightChange: vi.fn(),
      })
    );

    expect(html).toContain("width:615px");
    expect(html).toContain("bottom:80px");
    expect(html).toContain('data-editor-ui-scale="0.75"');
    expect(html).toContain('data-editor-size-factor="1.1"');
    expect(draft.text).toBe("Existing draft");
  });
});
