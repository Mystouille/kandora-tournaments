import {
  Locale,
  type ChatInputCommandInteraction,
  type PublicThreadChannel,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { QuizHandler, QuizMode, type QuizQuestion } from "./QuizHandler";

class TestQuizHandler extends QuizHandler {
  protected get firstThreadMessage() {
    return "Quiz starting";
  }

  protected async getNewQuestionData(): Promise<QuizQuestion> {
    return {
      questionText: "Choose a discard",
      questionImage: "hand.png",
      optionEmojis: ["1m"],
      answer: ["1m"],
      fullAnswer: "Answer",
    };
  }
}

describe("QuizHandler.startQuiz", () => {
  it("posts and awaits the first question", async () => {
    const collector = { on: vi.fn() };
    const message = {
      createReactionCollector: vi.fn().mockReturnValue(collector),
      react: vi.fn().mockResolvedValue(undefined),
    };
    const send = vi.fn().mockResolvedValue(message);
    const thread = { send } as unknown as PublicThreadChannel<false>;
    const interaction = {
      locale: Locale.EnglishUS,
    } as ChatInputCommandInteraction;
    const handler = new TestQuizHandler(
      thread,
      interaction,
      QuizMode.Explore,
      0,
      1
    );

    await expect(handler.startQuiz()).resolves.toBe(message);
    expect(send).toHaveBeenCalledWith({
      content: expect.stringContaining("Choose a discard"),
      files: ["hand.png"],
    });
    expect(message.createReactionCollector).toHaveBeenCalledOnce();
    expect(message.react).toHaveBeenNthCalledWith(1, "1m");
  });
});