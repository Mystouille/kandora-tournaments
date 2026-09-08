export const NATIVE_APP_LINK_HOST = "tournaments.tnt-sessions.com";
export const NATIVE_APP_BUNDLE_ID = "com.kandora.app";
export const NATIVE_APP_ANDROID_PACKAGE = "com.kandora.app";

type Environment = Record<string, string | undefined>;

export type NativeAppLinkConfigResult<T> =
  { configured: true; value: T } | { configured: false; error: string };

export function readAppleAppLinkConfig(
  environment: Environment = process.env
): NativeAppLinkConfigResult<{ appId: string }> {
  const prefix =
    environment.APPLE_APPLICATION_IDENTIFIER_PREFIX?.trim().toUpperCase();
  if (prefix === undefined || !/^[A-Z0-9]{10}$/.test(prefix)) {
    return {
      configured: false,
      error: "APPLE_APPLICATION_IDENTIFIER_PREFIX must be 10 alphanumerics",
    };
  }
  return {
    configured: true,
    value: { appId: `${prefix}.${NATIVE_APP_BUNDLE_ID}` },
  };
}

export function readAndroidAppLinkConfig(
  environment: Environment = process.env
): NativeAppLinkConfigResult<{ fingerprints: string[] }> {
  const raw = environment.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS?.trim();
  if (raw === undefined || raw === "") {
    return {
      configured: false,
      error: "ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS is required",
    };
  }
  const fingerprints = [
    ...new Set(
      raw
        .split(/[,;\r\n]+/)
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value !== "")
    ),
  ];
  if (
    fingerprints.length === 0 ||
    fingerprints.some(
      (fingerprint) => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)
    )
  ) {
    return {
      configured: false,
      error: "Android fingerprints must be colon-separated SHA-256 values",
    };
  }
  return { configured: true, value: { fingerprints } };
}
