import { ChannelType, Locale } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";

const mocks = vi.hoisted(() => ({
  getImageFromTiles: vi.fn(),
  getHandEmojis: vi.fn(),
  fromStrToHandToDisplay: vi.fn(),
  getHandContext: vi.fn(),
  getShantenInfo: vi.fn(),
}));

vi.mock("../../mahjong/imageUtils", () => ({
  getImageFromTiles: mocks.getImageFromTiles,
}));

vi.mock("../../mahjong/handParser", () => ({
  getHandEmojis: mocks.getHandEmojis,
  fromStrToHandToDisplay: mocks.fromStrToHandToDisplay,
  getHandContext: mocks.getHandContext,
}));

vi.mock("../../mahjong/shantenUtils", () => ({
  getShantenInfo: mocks.getShantenInfo,
  UkeireChoice: { No: "No", Yes: "Yes", Full: "Full" },
}));

import { executeNanikiru } from "./nanikiru";

function interaction({
  thread = false,
  threadManager,
}: {
  thread?: boolean;
  threadManager?: unknown;
} = {}) {
  const getString = vi
    .fn()
    .mockReturnValueOnce("123m456p789s111z22z")
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(null);
  const getBoolean = vi
    .fn()
    .mockReturnValueOnce(thread)
    .mockReturnValueOnce(false);
  const editReply = vi.fn();
  editReply.mockResolvedValueOnce({ id: "initial", react: vi.fn() });
  editReply.mockResolvedValueOnce({ id: "final", react: vi.fn() });
  return {
    options: { getString, getBoolean },
    channel: thread
      ? { type: ChannelType.GuildText, threads: threadManager }
      : null,
    locale: Locale.EnglishUS,
    member: { user: { username: "tester" } },
    editReply,
  } as unknown as ChatInputCommandInteraction;
}

describe("executeNanikiru", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fromStrToHandToDisplay.mockReturnValue({
      closedTiles: "123m456p789s111z22z",
      melds: [],
      lastTileSeparated: false,
    });
    mocks.getHandContext.mockReturnValue("context");
    mocks.getHandEmojis.mockReturnValue([]);
    mocks.getShantenInfo.mockReturnValue("Agari!");
  });

  it("waits for the image and attaches it to the final reply", async () => {
    let resolveImage!: (image: string) => void;
    mocks.getImageFromTiles.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveImage = resolve;
      })
    );
    const command = interaction();
    let settled = false;
    const execution = executeNanikiru(command).then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(command.editReply).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    resolveImage("hand.png");
    await execution;

    expect(command.editReply).toHaveBeenLastCalledWith({
      content: expect.stringContaining("Agari!"),
      files: ["hand.png"],
    });
  });

  it("attaches the image before creating a thread", async () => {
    mocks.getImageFromTiles.mockResolvedValue("hand.png");
    const send = vi.fn().mockResolvedValue({ react: vi.fn() });
    const create = vi.fn().mockResolvedValue({ send });
    const command = interaction({ thread: true, threadManager: { create } });

    await executeNanikiru(command);

    expect(command.editReply).toHaveBeenLastCalledWith({
      content: expect.any(String),
      files: ["hand.png"],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ startMessage: "final" })
    );
    expect(mocks.getShantenInfo).toHaveBeenCalledWith(
      "123m456p789s111z22z",
      "No",
      Locale.EnglishUS,
      undefined
    );
  });
});