import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discordBotConfig: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("config", () => ({
  discordBotConfig: mocks.discordBotConfig,
}));

import { sendDirectMessage } from "./discordPublisher.server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Discord direct messages", () => {
  beforeEach(() => {
    mocks.discordBotConfig.mockReset();
    mocks.discordBotConfig.mockReturnValue({
      DISCORD_BOT_TOKEN: "bot-token",
    });
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a DM channel and posts the message as the configured bot", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ id: "dm-channel" }))
      .mockResolvedValueOnce(jsonResponse({ id: "message-1" }));

    await expect(
      sendDirectMessage("discord-user", "Review updated")
    ).resolves.toEqual({ id: "message-1" });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      "https://discord.com/api/v10/users/@me/channels",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recipient_id: "discord-user" }),
        headers: expect.objectContaining({
          Authorization: "Bot bot-token",
          "Content-Type": "application/json",
        }),
      })
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      "https://discord.com/api/v10/channels/dm-channel/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "Review updated" }),
      })
    );
  });

  it("surfaces a Discord rejection while opening the DM channel", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("DMs disabled", { status: 403 }));

    await expect(
      sendDirectMessage("discord-user", "Review updated")
    ).rejects.toThrow(
      "Failed to open direct message channel for user discord-user: 403 DMs disabled"
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
