import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthCookie: vi.fn(),
  findOrCreateDiscordUser: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getGuildMember: vi.fn(),
  linkDiscordToUser: vi.fn(),
  signToken: vi.fn(),
}));

vi.mock("config", () => ({
  discordOAuthConfig: () => ({
    DISCORD_CLIENT_ID: "client-id",
    DISCORD_CLIENT_SECRET: "client-secret",
    DISCORD_REDIRECT_URI: "/auth/discord/callback",
  }),
}));

vi.mock("../../../utils/auth.server", () => ({
  AuthService: {
    findOrCreateDiscordUser: mocks.findOrCreateDiscordUser,
    linkDiscordToUser: mocks.linkDiscordToUser,
  },
}));

vi.mock("../../../utils/jwt.server", () => ({
  createAuthCookie: mocks.createAuthCookie,
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  signToken: mocks.signToken,
}));

vi.mock("../../../utils/discord-guilds.server", () => ({
  getGuildMember: mocks.getGuildMember,
}));

vi.mock("../../../config/servers", () => ({
  getMainServer: () => ({ id: "guild-1", name: "TNT", isMain: true }),
}));

import { loader } from "./callback.server";

function oauthRequest(returnTo: string, linkMode = false): Request {
  const cookies = [
    "discord_oauth_state=state-1",
    `discord_return_to=${encodeURIComponent(returnTo)}`,
  ];
  if (linkMode) {
    cookies.push("discord_link_mode=true");
  }
  return new Request(
    "http://app.test/auth/discord/callback?code=code-1&state=state-1",
    { headers: { Cookie: cookies.join("; ") } }
  );
}

describe("Discord callback return destinations", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
      .mockResolvedValueOnce(
        Response.json({
          id: "discord-1",
          username: "alice",
          global_name: "Alice",
          avatar: null,
        })
      );
    mocks.createAuthCookie.mockReturnValue("auth_token=signed");
    mocks.signToken.mockResolvedValue("signed");
    mocks.getGuildMember.mockResolvedValue({ roles: [] });
    mocks.findOrCreateDiscordUser.mockResolvedValue({
      success: true,
      user: { _id: { toString: () => "user-1" }, name: "Alice" },
      isNewUser: false,
    });
    mocks.getAuthenticatedUser.mockResolvedValue({
      sub: "user-1",
      username: "Alice",
      loginMethod: "email",
    });
    mocks.linkDiscordToUser.mockResolvedValue({ success: true });
  });

  it("returns an existing user to the sign-in gate with its nested destination", async () => {
    const response = await loader({
      request: oauthRequest(
        "/sign-in?returnTo=%2Fspectate%2Fmatch-1%3Fdelay%3D300000"
      ),
    });

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe(
      "/sign-in?returnTo=%2Fspectate%2Fmatch-1%3Fdelay%3D300000&discord_auth=success&username=alice"
    );
  });

  it("carries a new user's destination through account setup", async () => {
    mocks.findOrCreateDiscordUser.mockResolvedValue({
      success: true,
      user: { _id: { toString: () => "user-1" }, name: "Alice" },
      isNewUser: true,
    });

    const response = await loader({
      request: oauthRequest("/sign-in?returnTo=%2Fgame%2Froom-1"),
    });

    expect((response as Response).headers.get("Location")).toBe(
      "/account?setup=true&returnTo=%2Fsign-in%3FreturnTo%3D%252Fgame%252Froom-1&discord_auth=success&username=alice&newUser=true"
    );
  });

  it("returns link mode to the originating sign-in gate", async () => {
    const response = await loader({
      request: oauthRequest(
        "/sign-in?returnTo=%2Fgame%2Froom-1",
        true
      ),
    });

    expect(mocks.linkDiscordToUser).toHaveBeenCalledWith("user-1", {
      id: "discord-1",
      username: "alice",
      displayName: "Alice",
      avatarUrl: undefined,
    });
    expect((response as Response).headers.get("Location")).toBe(
      "/sign-in?returnTo=%2Fgame%2Froom-1&discord_link=success"
    );
  });

  it("falls back to the application root for an external return cookie", async () => {
    const response = await loader({
      request: oauthRequest("https://evil.test/steal"),
    });

    expect((response as Response).headers.get("Location")).toBe(
      "/?discord_auth=success&username=alice"
    );
  });
});