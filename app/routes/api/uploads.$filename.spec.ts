import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: mocks.access,
  readFile: mocks.readFile,
}));
vi.mock("../../../config", () => ({
  uploadDir: "C:/test/uploads",
}));

import { loader } from "./uploads.$filename";

describe("public upload assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(Buffer.from("image"));
  });

  it("allows Capacitor to load public team logos cross-origin", async () => {
    const response = await loader({
      params: { filename: "team.webp" },
      request: new Request("https://app.test/api/uploads/team.webp"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Content-Type")).toBe("image/webp");
  });
});
