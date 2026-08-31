import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findTerms: vi.fn(),
  sortTerms: vi.fn(),
  leanTerms: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));

vi.mock("~/core/models/portal/GlossaryTerm", () => ({
  GlossaryTermModel: { find: mocks.findTerms },
}));

import { loader } from "./glossary";

describe("glossary API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = {
      sort: mocks.sortTerms,
      lean: mocks.leanTerms,
    };
    mocks.findTerms.mockReturnValue(query);
    mocks.sortTerms.mockReturnValue(query);
    mocks.leanTerms.mockResolvedValue([
      { _id: "term-1", name: "Agari", synonyms: [] },
    ]);
  });

  it("returns the public glossary sorted by name", async () => {
    const response = await loader();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      terms: [{ _id: "term-1", name: "Agari", synonyms: [] }],
    });
    expect(mocks.connectToDatabase).toHaveBeenCalledOnce();
    expect(mocks.findTerms).toHaveBeenCalledOnce();
    expect(mocks.sortTerms).toHaveBeenCalledWith({ name: 1 });
    expect(mocks.leanTerms).toHaveBeenCalledOnce();
  });
});
