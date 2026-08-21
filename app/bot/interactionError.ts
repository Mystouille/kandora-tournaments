import { randomUUID } from "node:crypto";
import {
  MessageFlags,
  type RepliableInteraction,
} from "discord.js";

export function logInteractionError(context: string, error: unknown): string {
  const reference = randomUUID().slice(0, 8);
  console.error(`[Discord ${context} error ${reference}]`, error);
  return reference;
}

export function safeInteractionErrorMessage(reference: string): string {
  return `Something went wrong. Please try again. Reference: \`${reference}\``;
}

export async function reportInteractionError(
  interaction: RepliableInteraction,
  context: string,
  error: unknown
): Promise<void> {
  const reference = logInteractionError(context, error);
  const payload = {
    content: safeInteractionErrorMessage(reference),
    flags: MessageFlags.Ephemeral,
  } as const;

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (replyError) {
    console.error(
      `[Discord ${context} error ${reference}] Failed to send error response`,
      replyError
    );
  }
}