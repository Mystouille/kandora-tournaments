import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUsers: vi.fn(),
  sendDirectMessage: vi.fn(),
  trackError: vi.fn(),
}));

vi.mock("config", () => ({
  basePath: "/tournaments",
  coreConfig: { APP_BASE_URL: "https://kandora.example" },
}));
vi.mock("~/core/models/shared/User", () => ({
  UserModel: { find: mocks.findUsers },
}));
vi.mock("./discordPublisher.server", () => ({
  sendDirectMessage: mocks.sendDirectMessage,
}));
vi.mock("./replayReview.server", () => ({
  effectiveReviewAuthor: (
    edit: { author?: unknown },
    createdBy: unknown
  ): string =>
    edit.author === undefined || edit.author === null
      ? String(createdBy)
      : String(edit.author),
}));
vi.mock("./telemetry.server", () => ({
  trackError: mocks.trackError,
}));

import { notifyReviewContributors } from "./replayReviewNotification.server";

const CREATOR_ID = "64b000000000000000000001";
const PUBLISHER_ID = "64b000000000000000000002";
const OTHER_ID = "64b000000000000000000003";

function mockUsers(
  users: Array<{ _id: string; discordIdentity?: { id?: string } }>
): void {
  mocks.findUsers.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(users),
    }),
  });
}

function review(edits: Array<{ author?: unknown }>) {
  return {
    shortId: "Review1234",
    sourceGameId: "game/123",
    createdBy: CREATOR_ID,
    seat: 2,
    edits,
  };
}

describe("replay review contributor notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendDirectMessage.mockResolvedValue({ id: "message-1" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("messages each other current contributor once with a review deep link", async () => {
    mockUsers([
      { _id: CREATOR_ID, discordIdentity: { id: "discord-creator" } },
      { _id: OTHER_ID, discordIdentity: { id: "discord-other" } },
    ]);

    await notifyReviewContributors({
      review: review([
        { author: PUBLISHER_ID },
        { author: CREATOR_ID },
        { author: CREATOR_ID },
        { author: OTHER_ID },
      ]),
      publisherId: PUBLISHER_ID,
      publisherName: " Contributor ",
      eventIndex: 24,
    });

    expect(mocks.findUsers).toHaveBeenCalledWith({
      _id: { $in: [CREATOR_ID, OTHER_ID] },
    });
    const message =
      "Contributor published new annotations on a replay you commented on:\n" +
      "https://kandora.example/tournaments/watch/replay/game%2F123?seat=2&event=24&review=Review1234";
    expect(mocks.sendDirectMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendDirectMessage).toHaveBeenCalledWith(
      "discord-creator",
      message
    );
    expect(mocks.sendDirectMessage).toHaveBeenCalledWith(
      "discord-other",
      message
    );
  });

  it("treats an authorless legacy annotation as belonging to the creator", async () => {
    mockUsers([
      { _id: CREATOR_ID, discordIdentity: { id: "discord-creator" } },
    ]);

    await notifyReviewContributors({
      review: review([{ author: PUBLISHER_ID }, {}]),
      publisherId: PUBLISHER_ID,
      publisherName: "Contributor",
      eventIndex: 10,
    });

    expect(mocks.findUsers).toHaveBeenCalledWith({
      _id: { $in: [CREATOR_ID] },
    });
    expect(mocks.sendDirectMessage).toHaveBeenCalledOnce();
  });

  it("skips unlinked users and duplicate Discord identities", async () => {
    mockUsers([
      { _id: CREATOR_ID },
      { _id: OTHER_ID, discordIdentity: { id: "discord-shared" } },
      {
        _id: "64b000000000000000000004",
        discordIdentity: { id: "discord-shared" },
      },
    ]);

    await notifyReviewContributors({
      review: review([
        { author: PUBLISHER_ID },
        { author: CREATOR_ID },
        { author: OTHER_ID },
        { author: "64b000000000000000000004" },
      ]),
      publisherId: PUBLISHER_ID,
      publisherName: "Contributor",
      eventIndex: 10,
    });

    expect(mocks.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendDirectMessage).toHaveBeenCalledWith(
      "discord-shared",
      expect.any(String)
    );
  });

  it("isolates a rejected DM and continues sending to other contributors", async () => {
    mockUsers([
      { _id: CREATOR_ID, discordIdentity: { id: "discord-blocked" } },
      { _id: OTHER_ID, discordIdentity: { id: "discord-other" } },
    ]);
    const rejection = new Error("DMs disabled");
    mocks.sendDirectMessage
      .mockRejectedValueOnce(rejection)
      .mockResolvedValueOnce({ id: "message-2" });

    await expect(
      notifyReviewContributors({
        review: review([
          { author: PUBLISHER_ID },
          { author: CREATOR_ID },
          { author: OTHER_ID },
        ]),
        publisherId: PUBLISHER_ID,
        publisherName: "Contributor",
        eventIndex: 10,
      })
    ).resolves.toBeUndefined();

    expect(mocks.sendDirectMessage).toHaveBeenCalledTimes(2);
    expect(mocks.trackError).toHaveBeenCalledWith(rejection, {
      source: "replayReviewNotification",
      reviewShortId: "Review1234",
      recipientUserId: CREATOR_ID,
    });
  });

  it("does not query users when the publisher is the only contributor", async () => {
    await notifyReviewContributors({
      review: review([{ author: PUBLISHER_ID }]),
      publisherId: PUBLISHER_ID,
      publisherName: "Contributor",
      eventIndex: 10,
    });

    expect(mocks.findUsers).not.toHaveBeenCalled();
    expect(mocks.sendDirectMessage).not.toHaveBeenCalled();
  });
});
