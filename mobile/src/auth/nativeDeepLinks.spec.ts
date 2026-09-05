import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const androidManifest = readFileSync(
  new URL("../../../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8"
);
const iosInfoPlist = readFileSync(
  new URL("../../../ios/App/App/Info.plist", import.meta.url),
  "utf8"
);

describe("native mobile authentication callbacks", () => {
  it("registers the Android callback intent", () => {
    const callbackFilter = [
      ...androidManifest.matchAll(/<intent-filter>[\s\S]*?<\/intent-filter>/g),
    ]
      .map(([filter]) => filter)
      .find((filter) => filter.includes('android:scheme="kandora"'));

    expect(callbackFilter).toBeDefined();
    expect(androidManifest).toContain('android:launchMode="singleTask"');
    expect(callbackFilter).toContain(
      'android:name="android.intent.action.VIEW"'
    );
    expect(callbackFilter).toContain(
      'android:name="android.intent.category.DEFAULT"'
    );
    expect(callbackFilter).toContain(
      'android:name="android.intent.category.BROWSABLE"'
    );
    expect(callbackFilter).toContain('android:host="auth"');
    expect(callbackFilter).toContain('android:pathPrefix="/complete"');
  });

  it("registers the iOS callback URL scheme", () => {
    const callbackTypes = iosInfoPlist.match(
      /<key>CFBundleURLTypes<\/key>[\s\S]*?<\/array>/
    )?.[0];

    expect(callbackTypes).toBeDefined();
    expect(callbackTypes).toContain("<key>CFBundleURLSchemes</key>");
    expect(callbackTypes).toContain("<string>kandora</string>");
  });
});
