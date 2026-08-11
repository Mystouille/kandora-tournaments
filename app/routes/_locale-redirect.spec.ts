import { afterEach, describe, expect, it, vi } from "vitest";
import { loader } from "./_locale-redirect";

async function loadLocaleUrl(url: string): Promise<Response> {
  return loader({
    request: new Request(url),
    params: {},
    context: {},
  } as Parameters<typeof loader>[0]);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("locale redirect loader", () => {
  it("sets a host-local locale and redirects the locale root", async () => {
    vi.stubEnv("AUTH_COOKIE_DOMAIN", "");

    const response = await loadLocaleUrl("http://tournaments.test/fr/");
    const setCookie = response.headers.get("Set-Cookie") ?? "";

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(setCookie).toContain(
      "locale=fr; Path=/; Max-Age=31536000; SameSite=Lax"
    );
    expect(setCookie).not.toContain("kandora_locale_v1");
    expect(setCookie).not.toContain("Domain=");
    expect(setCookie).not.toContain("Secure");
  });

  it("sets both locale scopes and preserves a replay path and query", async () => {
    vi.stubEnv("AUTH_COOKIE_DOMAIN", ".tnt-sessions.com");

    const response = await loadLocaleUrl(
      "https://tournaments.test/en/watch/replay/game-123?seat=2&source=published"
    );
    const setCookie = response.headers.get("Set-Cookie") ?? "";

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/watch/replay/game-123?seat=2&source=published"
    );
    expect(setCookie).toContain(
      "locale=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure"
    );
    expect(setCookie).toContain(
      "kandora_locale_v1=en; Path=/; Max-Age=31536000; SameSite=Lax; Domain=.tnt-sessions.com; Secure"
    );
  });
});