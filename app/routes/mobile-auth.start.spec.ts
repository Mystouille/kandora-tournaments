import { describe, expect, it, vi } from "vitest";

vi.mock("config", () => ({
  discordOAuthConfig: () => ({ DISCORD_CLIENT_ID: "discord-client" }),
}));

import { loader } from "./mobile-auth.start";

describe("mobile Discord auth start", () => {
  it("redirects directly to Discord and stores the native completion path", async () => {
    const challenge = "a".repeat(43);
    const response = await loader({
      request: new Request(
        `https://internal.test/mobile-auth/start?challenge=${challenge}`,
        {
          headers: {
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "tournaments.example.com",
          },
        }
      ),
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(
      "https://discord.com/api/oauth2/authorize"
    );
    expect(location.searchParams.get("client_id")).toBe("discord-client");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://tournaments.example.com/auth/discord/callback"
    );
    expect(location.searchParams.get("state")).toBeTruthy();
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("discord_oauth_state="))).toBe(
      true
    );
    expect(
      cookies.some((cookie) =>
        cookie.includes("discord_return_to=%2Fmobile-auth%2Fcomplete")
      )
    ).toBe(true);
    expect(
      cookies.some((cookie) =>
        cookie.startsWith(`mobile_auth_challenge=${challenge}`)
      )
    ).toBe(true);
  });

  it("rejects requests without an app verifier challenge", async () => {
    const response = await loader({
      request: new Request("https://internal.test/mobile-auth/start"),
    });

    expect(response.status).toBe(400);
  });
});