import {
  ChannelType,
  Locale,
  type ChatInputCommandInteraction,
} from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NanikiruQuizHandler } from "./handlers/NanikiruQuizHandler";
import { executeQuizNanikiru } from "./nanikiru";

function interaction() {
  const thread = { type: ChannelType.PublicThread };
  const create = vi.fn().mockResolvedValue(thread);
  const editReply = vi.fn().mockResolvedValue({ id: "starter-message" });
  const command = {
    options: {
      getInteger: vi.fn().mockReturnValue(1),
      getString: vi.fn().mockReturnValue(null),
    },
    channel: { type: ChannelType.GuildText, threads: { create } },
    locale: Locale.EnglishUS,
    editReply,
  } as unknown as ChatInputCommandInteraction;
  return { command, create, editReply, thread };
}

describe("executeQuizNanikiru", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not finish before the first question has been posted", async () => {
    let resolveStart!: () => void;
    const startPromise = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    const startQuiz = vi
      .spyOn(NanikiruQuizHandler.prototype, "startQuiz")
      .mockReturnValue(startPromise);
    const { command, create } = interaction();
    let settled = false;
    const execution = executeQuizNanikiru(command).then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(startQuiz).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ startMessage: "starter-message" })
    );
    expect(settled).toBe(false);

    resolveStart();
    await execution;
    expect(settled).toBe(true);
  });

  it("propagates a first-question failure", async () => {
    vi.spyOn(NanikiruQuizHandler.prototype, "startQuiz").mockRejectedValue(
      new Error("question image failed")
    );
    const { command } = interaction();

    await expect(executeQuizNanikiru(command)).rejects.toThrow(
      "question image failed"
    );
  });
});