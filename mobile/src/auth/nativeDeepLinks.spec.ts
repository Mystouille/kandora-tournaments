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
const iosEntitlements = readFileSync(
  new URL("../../../ios/App/App/App.entitlements", import.meta.url),
  "utf8"
);
const iosProject = readFileSync(
  new URL("../../../ios/App/App.xcodeproj/project.pbxproj", import.meta.url),
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

  it("registers the four verified Android HTTPS route families", () => {
    const appLinkFilters = [
      ...androidManifest.matchAll(
        /<intent-filter android:autoVerify="true">[\s\S]*?<\/intent-filter>/g
      ),
    ].map(([filter]) => filter);

    expect(appLinkFilters).toHaveLength(4);
    for (const filter of appLinkFilters) {
      expect(filter).toContain('android:scheme="https"');
      expect(filter).toContain('android:host="tournaments.tnt-sessions.com"');
      expect(filter).toContain('android:name="android.intent.action.VIEW"');
      expect(filter).toContain(
        'android:name="android.intent.category.BROWSABLE"'
      );
    }
    expect(
      appLinkFilters.map((filter) => filter.match(/pathPrefix="([^"]+)/)?.[1])
    ).toEqual(["/game/", "/spectate/", "/watch/live/", "/watch/replay/"]);
  });

  it("wires the iOS associated domain into both build configurations", () => {
    expect(iosEntitlements).toContain(
      "<key>com.apple.developer.associated-domains</key>"
    );
    expect(iosEntitlements).toContain(
      "<string>applinks:tournaments.tnt-sessions.com</string>"
    );
    expect(
      iosProject.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)
    ).toHaveLength(2);
    expect(
      iosProject.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.kandora\.app;/g)
    ).toHaveLength(2);
  });
});
