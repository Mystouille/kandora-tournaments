import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sheetMock = vi.hoisted(() => ({
  loadInfo: vi.fn(),
  getRows: vi.fn(),
}));

vi.mock("config", () => ({
  googleSheetsConfig: () => ({
    NANIKIRU_SHEET_ID: "sheet-id",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "test@example.com",
      private_key: "private-key",
    }),
  }),
}));

vi.mock("google-auth-library", () => ({
  JWT: class {},
}));

vi.mock("google-spreadsheet", () => ({
  GoogleSpreadsheet: class {
    public readonly sheetsByTitle = {
      Problems: { getRows: sheetMock.getRows },
    };

    public readonly loadInfo = sheetMock.loadInfo;
  },
}));

import {
  isNanikiruProblemPublic,
  KIN_PUBLIC_PROBLEM_LIMIT,
  NanikiruCollections,
  NanikiruType,
} from "./NanikiruCollections";

const globalKey = "__NanikiruCollections__";

describe("NanikiruCollections", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[globalKey];
    sheetMock.loadInfo.mockReset();
    sheetMock.getRows.mockReset();
    sheetMock.loadInfo.mockResolvedValue(undefined);
    sheetMock.getRows.mockResolvedValue([]);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[globalKey];
  });

  it("replaces a stale global instance", async () => {
    (globalThis as Record<string, unknown>)[globalKey] = {};

    const collections = NanikiruCollections.instance;
    await collections.waitUntilReady();

    expect(collections).toBeInstanceOf(NanikiruCollections);
  });

  it("waits for sheet rows before reporting readiness", async () => {
    let finishLoading!: () => void;
    sheetMock.loadInfo.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLoading = resolve;
        })
    );
    sheetMock.getRows.mockResolvedValue([
      {
        rowNumber: 2,
        get: (key: string) =>
          ({
            hand: "123m456p789s1122z",
            answer: "1z",
            source: "300-Q-001",
          })[key],
      },
    ]);

    const collections = NanikiruCollections.instance;
    let isReady = false;
    const readiness = collections.waitUntilReady().then(() => {
      isReady = true;
    });

    await Promise.resolve();
    expect(isReady).toBe(false);
    expect(collections.getProblemCount(NanikiruType.Uzaku300)).toBe(0);

    finishLoading();
    await readiness;

    expect(isReady).toBe(true);
    expect(collections.getProblemCount(NanikiruType.Uzaku300)).toBe(1);
    expect(collections.getNextProblem(NanikiruType.Uzaku300)?.source).toBe(
      "300-Q-001"
    );
  });

  it("limits public KIN problems to 80", async () => {
    sheetMock.getRows.mockResolvedValue(
      Array.from({ length: 82 }, (_, index) => ({
        rowNumber: index + 2,
        get: (key: string) =>
          ({
            hand: "123m456p789s1122z",
            answer: "1z",
            source: `KIN-Q-${String(index + 1).padStart(3, "0")}`,
          })[key],
      }))
    );

    const collections = NanikiruCollections.instance;
    await collections.waitUntilReady();

    expect(KIN_PUBLIC_PROBLEM_LIMIT).toBe(80);
    expect(collections.getProblemCount(NanikiruType.UzakuKin)).toBe(80);
    expect(collections.getProblemBySource("KIN-Q-080")?.source).toBe(
      "KIN-Q-080"
    );
    expect(collections.getProblemBySource("KIN-Q-081")).toBeNull();
    await expect(
      collections.getProblemFromSource("KIN-Q-081")
    ).resolves.toBeNull();
  });

  it("classifies 301 problems into the 301 collection", async () => {
    sheetMock.getRows.mockResolvedValue([
      {
        rowNumber: 2,
        get: (key: string) =>
          ({
            hand: "123m456p789s1122z",
            answer: "1z",
            source: "301-Q-001",
          })[key],
      },
    ]);

    const collections = NanikiruCollections.instance;
    await collections.waitUntilReady();

    expect(collections.isConfigured()).toBe(true);
    expect(collections.getProblemCount(NanikiruType.Uzaku301)).toBe(1);
    expect(collections.getNextProblem(NanikiruType.Uzaku301)?.source).toBe(
      "301-Q-001"
    );
  });

  it("rejects malformed and over-limit KIN sources", () => {
    expect(isNanikiruProblemPublic("KIN-Q-080")).toBe(true);
    expect(isNanikiruProblemPublic("KIN-Q-081")).toBe(false);
    expect(isNanikiruProblemPublic("KIN-custom")).toBe(false);
    expect(isNanikiruProblemPublic("300-Q-300")).toBe(true);
  });
});