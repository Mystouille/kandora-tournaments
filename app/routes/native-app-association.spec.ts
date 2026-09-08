import { afterEach, describe, expect, it, vi } from "vitest";
import { loader as appleAssociation } from "./apple-app-site-association";
import { loader as androidAssociation } from "./assetlinks";

const fingerprint = Array.from({ length: 32 }, (_, index) =>
  index.toString(16).padStart(2, "0")
).join(":");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("native app association resources", () => {
  it("serves a path-scoped Apple association document", async () => {
    vi.stubEnv("APPLE_APPLICATION_IDENTIFIER_PREFIX", "AB12CD34EF");

    const response = appleAssociation();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.has("location")).toBe(false);
    await expect(response.json()).resolves.toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appIDs: ["AB12CD34EF.com.kandora.app"],
            components: [
              { "/": "/watch/replay/tenhou-har", exclude: true },
              { "/": "/game/*" },
              { "/": "/spectate/*" },
              { "/": "/watch/live/*" },
              { "/": "/watch/replay/*" },
            ],
          },
        ],
      },
    });
  });

  it("serves Android statements for every configured signing key", async () => {
    vi.stubEnv(
      "ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS",
      `${fingerprint},${fingerprint.toUpperCase()}`
    );

    const response = androidAssociation();
    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.kandora.app",
        sha256_cert_fingerprints: [fingerprint.toUpperCase()],
      },
    });
  });

  it("does not publish placeholder or malformed release identities", async () => {
    vi.stubEnv("APPLE_APPLICATION_IDENTIFIER_PREFIX", "TEAM_ID_HERE");
    vi.stubEnv("ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS", "not-a-hash");

    expect(appleAssociation().status).toBe(503);
    expect(androidAssociation().status).toBe(503);
    expect(appleAssociation().headers.get("cache-control")).toBe("no-store");
  });
});
