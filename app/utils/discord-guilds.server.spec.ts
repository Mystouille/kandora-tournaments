import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("config", () => ({
  discordBotConfig: () => ({
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_CLIENT_ID: "client-id",
    SERVERS_JSON: "[]",
  }),
}));

vi.mock("~/config/servers", () => ({
  getServers: () => [],
  getMainServer: () => ({ id: "guild-1", name: "TNT", isMain: true }),
  getAllServerIds: () => ["guild-1"],
}));

import { lookupGuildMember } from "./discord-guilds.server";

describe("lookupGuildMember", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the Discord member for a successful lookup", async () => {
    const member = { user: { id: "discord-1" }, roles: ["role-1"] };
    fetchMock.mockResolvedValue(Response.json(member));

    await expect(lookupGuildMember("guild-1", "discord-1")).resolves.toEqual({
      status: "member",
      member,
    });
  });

  it("classifies a 404 as a non-member", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(lookupGuildMember("guild-1", "discord-1")).resolves.toEqual({
      status: "not_member",
    });
  });

  it("classifies other Discord failures as unavailable", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));

    await expect(lookupGuildMember("guild-1", "discord-1")).resolves.toEqual({
      status: "unavailable",
      httpStatus: 429,
    });
  });

  it("classifies transport failures as unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(lookupGuildMember("guild-1", "discord-1")).resolves.toEqual({
      status: "unavailable",
    });
  });
});