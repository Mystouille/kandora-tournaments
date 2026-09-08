import { readAppleAppLinkConfig } from "~/config/nativeAppLinks.server";

const COMPONENTS = [
  { "/": "/watch/replay/tenhou-har", exclude: true },
  { "/": "/game/*" },
  { "/": "/spectate/*" },
  { "/": "/watch/live/*" },
  { "/": "/watch/replay/*" },
] as const;

export function loader(): Response {
  const config = readAppleAppLinkConfig();
  if (!config.configured) {
    return Response.json(
      { error: "native_app_links_not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  return Response.json(
    {
      applinks: {
        apps: [],
        details: [{ appIDs: [config.value.appId], components: COMPONENTS }],
      },
    },
    {
      headers: {
        "cache-control": "public, max-age=3600",
        "content-type": "application/json",
      },
    }
  );
}
