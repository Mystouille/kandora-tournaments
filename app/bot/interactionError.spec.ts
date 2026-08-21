import type { RepliableInteraction } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportInteractionError } from "./interactionError";

describe("reportInteractionError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the original error but sends only a correlation reference", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      replied: false,
      deferred: false,
      reply,
      followUp: vi.fn(),
    } as unknown as RepliableInteraction;
    const secretError = new Error("mongodb://user:password@internal/db");

    await reportInteractionError(interaction, "test command", secretError);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[Discord test command error [a-f0-9]{8}\]$/),
      secretError
    );
    expect(reply).toHaveBeenCalledWith({
      content: expect.stringMatching(/Reference: `[a-f0-9]{8}`/),
      flags: expect.any(Number),
    });
    expect(JSON.stringify(reply.mock.calls)).not.toContain("password");
  });

  it("uses a follow-up after an interaction was deferred", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      replied: false,
      deferred: true,
      reply: vi.fn(),
      followUp,
    } as unknown as RepliableInteraction;

    await reportInteractionError(interaction, "test command", new Error());

    expect(followUp).toHaveBeenCalledOnce();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});