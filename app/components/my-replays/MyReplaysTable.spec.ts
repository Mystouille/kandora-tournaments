import { describe, expect, it } from "vitest";
import {
  MY_REPLAY_HEADER_TEXT_STYLE,
  MY_REPLAY_PLATFORM_LOGO_ASPECT_RATIO,
  myReplayPlatformLogo,
  myReplayLinkForRow,
  reviewLinkLabel,
  toTableRows,
} from "./MyReplaysTable";
import type { MyReplayGroup } from "~/types/myReplays";

describe("My Replays table rows", () => {
  it("uses equal-ratio platform marks with the requested backgrounds", () => {
    expect(MY_REPLAY_PLATFORM_LOGO_ASPECT_RATIO).toBe("16 / 9");
    expect(myReplayPlatformLogo("tenhou")).toMatchObject({
      backgroundColor: "#000000",
    });
    expect(myReplayPlatformLogo("majsoul")).toMatchObject({
      backgroundColor: "#ffffff",
    });
    expect(myReplayPlatformLogo("riichicity")).toMatchObject({
      backgroundColor: "#ffffff",
    });
    expect(myReplayPlatformLogo("ingame")).toBeNull();
  });

  it("wraps headers only at natural word boundaries", () => {
    expect(MY_REPLAY_HEADER_TEXT_STYLE).toMatchObject({
      whiteSpace: "normal",
      overflowWrap: "normal",
      wordBreak: "normal",
      hyphens: "none",
    });
  });

  it("uses only the review destination for review child rows", () => {
    expect(
      myReplayLinkForRow({
        replayUrl: "/watch/replay/game-1",
        reviewUrl: "/watch/replay/game-1?review=review-1",
        reviewedPlayerName: "Alice",
      })
    ).toEqual({
      kind: "review",
      url: "/watch/replay/game-1?review=review-1",
      reviewedPlayerName: "Alice",
    });
  });

  it("uses the replay destination for parent rows", () => {
    expect(myReplayLinkForRow({ replayUrl: "/watch/replay/game-1" })).toEqual({
      kind: "replay",
      url: "/watch/replay/game-1",
    });
  });

  it("labels the review with the reviewed player name", () => {
    expect(reviewLinkLabel("{username}'s review", "Alice", "Unknown")).toBe(
      "Alice's review"
    );
    expect(reviewLinkLabel("{username}'s review", null, "Unknown")).toBe(
      "Unknown's review"
    );
  });

  it("omits tree children for replay rows without reviews", () => {
    const group: MyReplayGroup = {
      key: "ingame:game-1",
      source: "ingame",
      sourceGameId: "game-1",
      reasons: ["played"],
      gameDate: 1_700_000_000_000,
      context: { kind: "friendly" },
      ruleset: { id: "m-league", label: "M-League" },
      replayUrl: "/watch/replay/game-1",
      commentCount: 0,
      reviews: [],
    };

    expect(toTableRows([group])[0]).not.toHaveProperty("children");
  });

  it("marks review rows with continuing and terminating tree branches", () => {
    const group: MyReplayGroup = {
      key: "tenhou:game-1",
      source: "tenhou",
      sourceGameId: "game-1",
      reasons: ["played"],
      gameDate: 1_700_000_000_000,
      context: { kind: "external" },
      ruleset: { id: "platform:tenhou", label: "Tenhou" },
      replayUrl: "/watch/replay/game-1",
      commentCount: 2,
      reviews: [
        {
          key: "review:first",
          shortId: "first",
          reviewedPlayerName: "Alice",
          reasons: ["commented"],
          lastModified: 1_700_000_000_100,
          commentCount: 1,
          reviewUrl: "/watch/replay/game-1?review=first",
        },
        {
          key: "review:last",
          shortId: "last",
          reviewedPlayerName: "Bob",
          reasons: ["commented"],
          lastModified: 1_700_000_000_200,
          commentCount: 1,
          reviewUrl: "/watch/replay/game-1?review=last",
        },
      ],
    };

    expect(
      toTableRows([group])[0].children?.map((row) => row.treeBranch)
    ).toEqual(["middle", "last"]);
  });
});
