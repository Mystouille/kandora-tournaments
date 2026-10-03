import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  findById: vi.fn(),
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
  authorize: vi.fn(),
  store: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("~/core/models/tournament/Team", () => ({
  TeamModel: {
    findById: mocks.findById,
    findOneAndUpdate: mocks.findOneAndUpdate,
    updateOne: mocks.updateOne,
  },
}));
vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connect,
}));
vi.mock("~/utils/league-permissions.server", () => ({
  requireLeagueAdmin: mocks.authorize,
}));
vi.mock("~/services/pictureStorage.server", () => ({
  storePicturePair: mocks.store,
}));
vi.mock("~/services/cacheInvalidation.server", () => ({
  emitLeagueUpdated: mocks.invalidate,
}));

import { action } from "./league-team-picture";

const teamId = "400000000000000000000001";
const leagueId = "200000000000000000000001";
const original = {
  fullPicture: "/api/uploads/original.webp",
  croppedPicture: "/api/uploads/original-crop.webp",
  summaryCenterY: 0.2,
};
const replacement = {
  fullPicture: "/api/uploads/replacement.webp",
  croppedPicture: "/api/uploads/replacement-crop.webp",
};

function query(value: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/admin/league-team-picture", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findById.mockReturnValue(
    query({ _id: teamId, leagueId, pictures: original })
  );
  mocks.authorize.mockResolvedValue({ authorized: true });
  mocks.store.mockResolvedValue(replacement);
  mocks.findOneAndUpdate.mockImplementation(
    (_filter: unknown, update: { $set: Record<string, unknown> }) =>
      query({
        pictures:
          "pictures" in update.$set
            ? update.$set.pictures
            : {
                ...original,
                summaryCenterY: update.$set["pictures.summaryCenterY"],
              },
      })
  );
});

describe("team picture centering API", () => {
  it.each([0, 0.25, 1])(
    "stores center %s without rewriting image files or refs",
    async (summaryCenterY) => {
      const response = await action({
        request: request("PATCH", {
          teamId,
          fullPicture: original.fullPicture,
          summaryCenterY,
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        success: true,
        pictures: { ...original, summaryCenterY },
      });
      expect(mocks.authorize).toHaveBeenCalledWith(
        expect.any(Request),
        leagueId
      );
      expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: teamId, leagueId, "pictures.fullPicture": original.fullPicture },
        { $set: { "pictures.summaryCenterY": summaryCenterY } },
        { new: true, runValidators: true }
      );
      expect(mocks.store).not.toHaveBeenCalled();
      expect(mocks.invalidate).toHaveBeenCalledWith(leagueId);
    }
  );

  it.each([-0.1, 1.1, "0.5", null, undefined])(
    "rejects invalid focus %s",
    async (summaryCenterY) => {
      const response = await action({
        request: request("PATCH", {
          teamId,
          fullPicture: original.fullPicture,
          summaryCenterY,
        }),
      });
      expect(response.status).toBe(400);
      expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
    }
  );

  it("rejects unauthorized updates", async () => {
    mocks.authorize.mockResolvedValue({
      authorized: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const response = await action({
      request: request("PATCH", {
        teamId,
        fullPicture: original.fullPicture,
        summaryCenterY: 0.7,
      }),
    });
    expect(response.status).toBe(403);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("does not apply a stale center to a replaced picture", async () => {
    const response = await action({
      request: request("PATCH", {
        teamId,
        fullPicture: "/api/uploads/stale.webp",
        summaryCenterY: 0.7,
      }),
    });
    expect(response.status).toBe(409);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("guards the picture reference atomically against a concurrent replacement", async () => {
    mocks.findOneAndUpdate.mockReturnValue(query(null));
    const response = await action({
      request: request("PATCH", {
        teamId,
        fullPicture: original.fullPicture,
        summaryCenterY: 0.7,
      }),
    });
    expect(response.status).toBe(409);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("reports a write that did not persist the requested center", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.findOneAndUpdate.mockReturnValue(query({ pictures: original }));
      const response = await action({
        request: request("PATCH", {
          teamId,
          fullPicture: original.fullPicture,
          summaryCenterY: 0.7,
        }),
      });
      expect(response.status).toBe(500);
      expect(log).toHaveBeenCalled();
      expect(mocks.invalidate).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("returns stored references and resets focus for a replacement image", async () => {
    const response = await action({
      request: request("PUT", {
        teamId,
        pictures: {
          fullPicture: "data:image/png;base64,AA==",
          croppedPicture: "data:image/png;base64,AA==",
        },
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      pictures: { ...replacement, summaryCenterY: 0.5 },
    });
  });

  it("preserves focus when only the square thumbnail changes", async () => {
    const pictures = {
      fullPicture: original.fullPicture,
      croppedPicture: replacement.croppedPicture,
    };
    mocks.store.mockResolvedValue(pictures);
    const response = await action({
      request: request("PUT", { teamId, pictures }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      pictures: { ...pictures, summaryCenterY: 0.2 },
    });
  });

  it("removes the entire picture pair including its focus metadata", async () => {
    const response = await action({
      request: request("PUT", { teamId, pictures: null }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      pictures: null,
    });
  });

  it("rejects malformed requests instead of removing pictures", async () => {
    const missing = await action({ request: request("PUT", { teamId }) });
    expect(missing.status).toBe(400);
    const invalidId = await action({
      request: request("PATCH", { teamId: "invalid", summaryCenterY: 0.2 }),
    });
    expect(invalidId.status).toBe(400);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
