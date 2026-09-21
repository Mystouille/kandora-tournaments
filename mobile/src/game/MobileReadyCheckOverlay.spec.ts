import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MobileReadyCheckOverlay,
  mobileReadyCheckSeconds,
} from "./MobileReadyCheckOverlay";

describe("mobile ready check", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("derives the same whole-second countdown from the server deadline", () => {
    expect(mobileReadyCheckSeconds(15_001, 10_000)).toBe(6);
    expect(mobileReadyCheckSeconds(15_000, 10_000)).toBe(5);
    expect(mobileReadyCheckSeconds(9_999, 10_000)).toBe(0);
  });

  it("renders an OK button and countdown over a hand result", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);

    const html = renderToStaticMarkup(
      createElement(MobileReadyCheckOverlay, {
        readyCheck: {
          deadline: 15_000,
          acked: [false, true, true, true],
        },
        mySeat: 0,
        resultPanelBounds: { x: 20, y: 30, w: 300, h: 200 },
        onReady: vi.fn(),
      })
    );

    expect(html).toContain(">OK</button>");
    expect(html).toContain(">5s</output>");
    expect(html).toContain("mobile-ready-check-result");
  });

  it("keeps an acknowledged hand result visible with a disabled state", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);

    const html = renderToStaticMarkup(
      createElement(MobileReadyCheckOverlay, {
        readyCheck: {
          deadline: 15_000,
          acked: [true, true, true, true],
        },
        mySeat: 0,
        resultPanelBounds: { x: 20, y: 30, w: 300, h: 200 },
        onReady: vi.fn(),
      })
    );

    expect(html).toContain("disabled");
    expect(html).toContain(">CONFIRMED</button>");
    expect(html).toContain("mobile-ready-check-result");
  });
});
