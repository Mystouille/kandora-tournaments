import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TableRenderer } from "../../../app/game/client/pixi/TableRenderer";
import { useMatchStore, type MatchView } from "../../../app/game/client/store";
import { tableLayoutFromConfig } from "../../../app/game/client/pixi/tableLayout";
import {
  mobileTableLayout,
  mobileDiscardLayoutOptions,
} from "../../../app/game/client/pixi/layouts/mobileTableLayout";
import {
  webTableLayoutConfig,
  webDiscardLayoutOptions,
} from "../../../app/game/client/pixi/layouts/webTableLayout";
import { ACTIVE_TILE_DESIGN } from "../../../app/game/client/pixi/tiles/activeTileDesign";
import {
  layoutDiscards,
  tilePlacementBounds,
} from "../../../app/game/client/pixi/tileAreaLayout";
import type { FocusedDiscardDrawingFrame } from "../../../app/game/client/pixi/geometry/reviewDrawingGeometry";
import { ReplayDrawingOverlay } from "../../../app/game/routes/ReplayDrawingOverlay";
import {
  base64ToBytes,
  bytesToBase64,
  decodeDrawing,
  encodeDrawing,
  type Stroke,
} from "../../../app/game/replay/reviewDrawing";
import {
  readReviewDraft,
  removeReviewDraft,
  writeReviewDraft,
} from "../../../app/routes/game/reviewDraftStorage";

type Mode = "standard" | "compact" | "mobile";
const savedKey = "review-drawing-browser-test";
const identity = {
  userId: "browser-reviewer",
  source: "ingame" as const,
  sourceGameId: "browser-test",
  reviewShortId: "browser-review",
};
const view: MatchView = {
  ...useMatchStore.getInitialState(),
  mySeat: 0,
  hands: Array.from({ length: 4 }, () => [
    "1m",
    "2m",
    "3m",
    "4m",
    "5m",
    "6m",
    "7m",
    "8m",
    "9m",
    "1p",
    "2p",
    "3p",
    "4p",
  ]),
  discards: Array.from({ length: 4 }, () => [
    "1s",
    "2s",
    "3s",
    "4s",
    "5s",
    "6s",
    "7s",
    "8s",
  ]),
  riichiTileIdx: [3, null, null, null],
  totalDiscards: 32,
  doraIndicators: ["1m"],
};

function loadDrawing(draft: boolean): Stroke[] {
  const pending = draft
    ? readReviewDraft(identity)?.active?.drawingBase64
    : null;
  const bytes = pending ?? localStorage.getItem(savedKey);
  return bytes ? decodeDrawing(base64ToBytes(bytes)).strokes : [];
}

function Harness() {
  const container = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("standard");
  const [frame, setFrame] = useState<FocusedDiscardDrawingFrame | null>(null);
  const [strokes, setStrokes] = useState(() => loadDrawing(true));
  const [pen, setPen] = useState(true);
  const [contextKey, setContextKey] = useState("event-4");
  const [secondReviewer, setSecondReviewer] = useState(false);
  const config =
    mode === "mobile" ? mobileTableLayout : webTableLayoutConfig(mode);
  const layout = tableLayoutFromConfig(config);

  useEffect(() => {
    const element = container.current!;
    let disposed = false;
    let mounted = false;
    setFrame(null);
    const renderer = new TableRenderer({
      layoutConfig: config,
      presentation: mode === "mobile" ? "mobile" : "standard",
      webTableLayoutMode: mode === "compact" ? "compact" : "standard",
    });
    renderer.setAnimationsEnabled(false);
    renderer.setShowHands(true);
    renderer.setStagedRevealEnabled(false);
    renderer.setConnectionDiagnosticsVisible(false);
    renderer.setFocusedDiscardDrawingListener(setFrame);
    renderer.setOnRenderRequest(() => renderer.render(view));
    void renderer.mount(element).then(() => {
      mounted = true;
      if (disposed) {
        renderer.destroy();
        return;
      }
      renderer.render(view);
    });
    return () => {
      disposed = true;
      renderer.setFocusedDiscardDrawingListener(null);
      if (mounted) {
        renderer.destroy();
      }
    };
  }, [mode, config]);

  const options =
    mode === "mobile"
      ? mobileDiscardLayoutOptions(ACTIVE_TILE_DESIGN, layout)
      : webDiscardLayoutOptions(mode, ACTIVE_TILE_DESIGN, layout);
  const bounds = tilePlacementBounds(
    layoutDiscards(ACTIVE_TILE_DESIGN, 0, view.discards[0], 3, options)[3]
  );
  const w = container.current?.clientWidth ?? 1;
  const h = container.current?.clientHeight ?? 1;
  const scale = Math.min(w / layout.table.w, h / layout.table.h);
  const target = {
    x:
      (w - layout.table.w * scale) / 2 +
      (layout.discards[0].x + bounds.x + bounds.w / 2) * scale,
    y:
      (h - layout.table.h * scale) / 2 +
      (layout.discards[0].y + bounds.y + bounds.h / 2) * scale,
  };
  const onStrokesChange = (next: Stroke[]) => {
    const drawingBase64 = bytesToBase64(encodeDrawing({ strokes: next }));
    writeReviewDraft({
      version: 1,
      identity,
      seat: 0,
      updatedAt: Date.now(),
      pending: [],
      active: {
        eventIndex: 4,
        mode: "pen",
        drawingBase64,
        baseUpdatedAt: null,
      },
    });
    setStrokes(next);
  };
  return (
    <>
      <style>{`
        body { margin: 0; font-family: sans-serif; }
        .absolute { position: absolute; }
        .inset-0 { inset: 0; }
        .toolbar { height: 64px; display: flex; align-items: center; gap: 8px; }
        .board { position: relative; width: 100%; height: calc(100vh - 64px); overflow: hidden; }
      `}</style>
      <div className="toolbar">
        <label>
          Layout{" "}
          <select
            aria-label="Layout"
            value={mode}
            onChange={(e) => {
              const value = e.target.value;
              if (
                value === "standard" ||
                value === "compact" ||
                value === "mobile"
              ) {
                setMode(value);
              }
            }}
          >
            <option value="standard">Web</option>
            <option value="compact">Compact web</option>
            <option value="mobile">Mobile</option>
          </select>
        </label>
        <button onClick={() => setPen(!pen)}>Toggle pen</button>
        <button
          onClick={() => {
            localStorage.setItem(
              savedKey,
              bytesToBase64(encodeDrawing({ strokes }))
            );
            removeReviewDraft(identity);
          }}
        >
          Save drawing
        </button>
        <button
          onClick={() => {
            setStrokes(loadDrawing(false));
            setPen(false);
            removeReviewDraft(identity);
          }}
        >
          Cancel drawing
        </button>
        <button onClick={() => onStrokesChange([])}>Remove drawing</button>
        <button
          onClick={() => {
            setContextKey("event-5");
            setStrokes([]);
          }}
        >
          Next event
        </button>
        <button onClick={() => setSecondReviewer(true)}>Second reviewer</button>
      </div>
      <div className="board" ref={container} data-testid="board">
        {secondReviewer && (
          <ReplayDrawingOverlay
            strokes={[
              {
                space: "focused-discard",
                points: [
                  { x: 20, y: 80 },
                  { x: 70, y: 80 },
                ],
              },
            ]}
            drawing={false}
            frame={frame}
            color="#3b82f6"
            onStrokesChange={() => {}}
          />
        )}
        <ReplayDrawingOverlay
          strokes={strokes}
          drawing={pen && mode !== "mobile"}
          frame={frame}
          contextKey={contextKey}
          color="#f97316"
          onStrokesChange={onStrokesChange}
        />
      </div>
      <output hidden data-testid="drawing-state">
        {JSON.stringify({ mode, frame, strokes, target })}
      </output>
    </>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Drawing harness root is missing");
}
createRoot(root).render(<Harness />);
