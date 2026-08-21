import {
  ChannelType,
  Locale,
  type ChatInputCommandInteraction,
} from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeQuizChinitsu } from "./chinitsu";
import { ChinitsuQuizHandler } from "./handlers/ChinitsuQuizHandler";

describe("executeQuizChinitsu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes the new thread when the first question fails", async () => {
    vi.spyOn(ChinitsuQuizHandler.prototype, "startQuiz").mockRejectedValue(
      new Error("question image failed")
    );
    const thread = {
      type: ChannelType.PublicThread,
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const create = vi.fn().mockResolvedValue(thread);
    const command = {
      options: {
        getInteger: vi.fn().mockReturnValue(null),
        getString: vi.fn().mockReturnValue(null),
      },
      channel: { type: ChannelType.GuildText, threads: { create } },
      locale: Locale.EnglishUS,
      editReply: vi.fn().mockResolvedValue({ id: "starter-message" }),
    } as unknown as ChatInputCommandInteraction;

    await expect(executeQuizChinitsu(command)).rejects.toThrow(
      "question image failed"
    );
    expect(thread.delete).toHaveBeenCalledWith(
      "Quiz startup failed before the first question."
    );
  });
});