import type { PublicThreadChannel } from "discord.js";
import { logInteractionError } from "../../interactionError";

export async function startQuizInThread(
  thread: PublicThreadChannel<false>,
  startQuiz: () => Promise<unknown>
): Promise<void> {
  try {
    await startQuiz();
  } catch (error) {
    try {
      await thread.delete("Quiz startup failed before the first question.");
    } catch (cleanupError) {
      logInteractionError("quiz startup thread cleanup", cleanupError);
    }
    throw error;
  }
}