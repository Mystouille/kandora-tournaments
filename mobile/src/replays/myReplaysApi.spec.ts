import { describe, expect, it, vi } from "vitest";
import type { MobileAuthSession } from "../auth/mobileAuth";
import { fetchMyReplays, MyReplaysHttpError } from "./myReplaysApi";

const session: MobileAuthSession = {
  token: "game-token",
  username: "Alice",
  expiresAt: Date.now() + 60_000,
};

const replay = {
  key: "tenhou:game-1",
  source: "tenhou",
  sourceGameId: "game-1",
  reasons: ["played"],
  gameDate: 1_700_000_000_000,
  seats: [
    {
      seat: 0,
      displayName: "Alice",
      finalScore: 40_000,
      place: 1,
    },
  ],
  context: { kind: "external" },
  ruleset: { id: "platform:tenhou", label: "Tenhou" },
  replayUrl: "/watch/replay/game-1",
  commentCount: 1,
  reviews: [
    {
      key: "review:one",
      shortId: "one",
      reviewedPlayerName: "Alice",
      reasons: ["commented"],
      lastModified: 1_700_000_000_100,
      commentCount: 1,
      reviewUrl: "/watch/replay/game-1?review=one",
    },
  ],
};

describe("common My Replays API client", () => {
  it("loads canonical groups with a CORS-simple mobile session", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ replays: [replay] }));

    await expect(
      fetchMyReplays("https://play.example.com", session, fetcher)
    ).resolves.toEqual([replay]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://play.example.com/api/my-replays",
      { method: "POST", body: expect.any(URLSearchParams) }
    );
    const request = fetcher.mock.calls[0][1];
    expect((request?.body as URLSearchParams).get("token")).toBe("game-token");
  });

  it("preserves the response status for authentication handling", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({}, { status: 401 }));

    const request = fetchMyReplays(
      "https://play.example.com",
      session,
      fetcher
    );
    await expect(request).rejects.toBeInstanceOf(MyReplaysHttpError);
    await expect(request).rejects.toMatchObject({ status: 401 });
  });

  it("rejects incomplete web or mobile payloads", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ replays: [{ key: "incomplete" }] }));

    await expect(
      fetchMyReplays("https://play.example.com", session, fetcher)
    ).rejects.toThrow();
  });
});
