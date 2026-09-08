import {
  NATIVE_APP_ANDROID_PACKAGE,
  readAndroidAppLinkConfig,
} from "~/config/nativeAppLinks.server";

const DYNAMIC_COMPONENTS = [
  { "/": "/watch/replay/tenhou-har", exclude: true },
  { "/": "/game/*" },
  { "/": "/spectate/*" },
  { "/": "/watch/live/*" },
  { "/": "/watch/replay/*" },
] as const;

export function loader(): Response {
  const config = readAndroidAppLinkConfig();
  if (!config.configured) {
    return Response.json(
      { error: "native_app_links_not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  return Response.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: NATIVE_APP_ANDROID_PACKAGE,
          sha256_cert_fingerprints: config.value.fingerprints,
        },
        relation_extensions: {
          "delegate_permission/common.handle_all_urls": {
            dynamic_app_link_components: DYNAMIC_COMPONENTS,
          },
        },
      },
    ],
    {
      headers: {
        "cache-control": "public, max-age=3600",
        "content-type": "application/json",
      },
    }
  );
}
