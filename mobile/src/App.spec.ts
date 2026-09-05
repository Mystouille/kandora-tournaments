import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mobile App initial screen", () => {
  it("opens the Home menu instead of the demo table", () => {
    vi.stubGlobal("localStorage", memoryStorage());

    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain("Kandora");
    expect(html).toContain("Go to lobby");
    expect(html).toContain("Replays");
    expect(html).toContain("Nearby");
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Sound");
    expect(html).not.toContain("Demo table");
    expect(html).not.toContain("table-canvas");
  });
});
