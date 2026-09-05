import { describe, expect, it, vi } from "vitest";
import type { MobileAuthSession } from "../auth/mobileAuth";
import {
  fetchMyReplayLog,
  fetchMyReplays,
  MyReplaysHttpError,
} from "./myReplaysApi";

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
    await expect(request).rejects.toMatchObject({
      status: 401,
      code: null,
    });
  });

  it("rejects incomplete web or mobile payloads", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ replays: [{ key: "incomplete" }] }));

    await expect(
      fetchMyReplays("https://play.example.com", session, fetcher)
    ).rejects.toThrow();
  });

  it("preserves stable JSON errors and distinguishes an HTML 404", async () => {
    const missingFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: "replay_not_found" }, { status: 404 })
      );
    await expect(
      fetchMyReplayLog(
        "https://play.example.com",
        session,
        "tenhou",
        "missing",
        null,
        missingFetcher
      )
    ).rejects.toMatchObject({ status: 404, code: "replay_not_found" });

    const undeployedFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<!doctype html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      })
    );
    await expect(
      fetchMyReplayLog(
        "https://play.example.com",
        session,
        "tenhou",
        "missing",
        null,
        undeployedFetcher
      )
    ).rejects.toMatchObject({ status: 404, code: null });
  });

  it("loads one full replay log lazily", async () => {
    const log = {
      source: "ingame",
      sourceGameId: "game-1",
      ruleSet: "m-league",
      startedAt: 1_000,
      endedAt: 2_000,
      seats: [0, 1, 2, 3].map((seat) => ({
        seat,
        displayName: `Player ${seat}`,
        finalScore: 40_000 - seat * 10_000,
        place: seat + 1,
      })),
      events: [],
      schemaVersion: 6,
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        log,
        seatEnrichment: [
          {
            teamName: "East Club",
            teamLogoUrl: "/api/uploads/east.webp",
          },
          null,
          null,
          null,
        ],
        review: {
          shortId: "review-1",
          seat: 1,
          targetName: "Player 1",
          edits: [
            {
              eventIndex: 3,
              authorName: "Reviewer",
              colorIndex: 0,
              text: "<p>Comment</p>",
              drawingBase64: null,
              updatedAt: "2026-01-02T03:04:05.000Z",
            },
          ],
        },
      })
    );

    await expect(
      fetchMyReplayLog(
        "https://play.example.com",
        session,
        "ingame",
        "game-1",
        "review-1",
        fetcher
      )
    ).resolves.toEqual({
      log,
      seatEnrichment: [
        {
          teamName: "East Club",
          teamLogoUrl: "https://play.example.com/api/uploads/east.webp",
        },
        null,
        null,
        null,
      ],
      review: {
        shortId: "review-1",
        seat: 1,
        targetName: "Player 1",
        edits: [
          {
            eventIndex: 3,
            authorName: "Reviewer",
            colorIndex: 0,
            text: "<p>Comment</p>",
            drawingBase64: null,
            updatedAt: "2026-01-02T03:04:05.000Z",
          },
        ],
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://play.example.com/api/my-replays/log",
      { method: "POST", body: expect.any(URLSearchParams) }
    );
    const request = fetcher.mock.calls[0][1];
    expect(request?.body).toBeInstanceOf(URLSearchParams);
    expect((request?.body as URLSearchParams).get("sourceGameId")).toBe(
      "game-1"
    );
    expect((request?.body as URLSearchParams).get("reviewShortId")).toBe(
      "review-1"
    );
  });
});
