import {
  ChannelType,
  Locale,
  type ChatInputCommandInteraction,
} from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const collectionsMock = vi.hoisted(() => ({
  waitUntilReady: vi.fn(),
  getProblemCount: vi.fn(),
  isConfigured: vi.fn(),
}));

vi.mock("../../resources/nanikiru/NanikiruCollections", () => ({
  NanikiruType: {
    Uzaku300: "300",
    Uzaku301: "301",
    UzakuKin: "KIN",
    Undefined: "Undefined",
  },
  NanikiruCollections: { instance: collectionsMock },
}));

import { NanikiruQuizHandler } from "./handlers/NanikiruQuizHandler";
import { executeQuizNanikiru } from "./nanikiru";

function interaction() {
  const thread = {
    type: ChannelType.PublicThread,
    delete: vi.fn().mockResolvedValue(undefined),
  };
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
  beforeEach(() => {
    collectionsMock.waitUntilReady.mockReset().mockResolvedValue(undefined);
    collectionsMock.getProblemCount.mockReset().mockReturnValue(1);
    collectionsMock.isConfigured.mockReset().mockReturnValue(true);
  });

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
    const { command, thread } = interaction();

    await expect(executeQuizNanikiru(command)).rejects.toThrow(
      "question image failed"
    );
    expect(thread.delete).toHaveBeenCalledOnce();
  });

  it("reports missing configuration without creating a thread", async () => {
    collectionsMock.getProblemCount.mockReturnValue(0);
    collectionsMock.isConfigured.mockReturnValue(false);
    const startQuiz = vi.spyOn(NanikiruQuizHandler.prototype, "startQuiz");
    const { command, create, editReply } = interaction();

    await executeQuizNanikiru(command);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("Google Sheets"),
    });
    expect(create).not.toHaveBeenCalled();
    expect(startQuiz).not.toHaveBeenCalled();
  });

  it("reports an empty series without creating a thread", async () => {
    collectionsMock.getProblemCount.mockReturnValue(0);
    const startQuiz = vi.spyOn(NanikiruQuizHandler.prototype, "startQuiz");
    const { command, create, editReply } = interaction();

    await executeQuizNanikiru(command);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('series "301"'),
    });
    expect(create).not.toHaveBeenCalled();
    expect(startQuiz).not.toHaveBeenCalled();
  });
});