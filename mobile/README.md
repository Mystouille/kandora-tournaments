# Kandora mobile

The mobile web bundle is a standalone Vite entry that imports renderer,
protocol, replay, and rules code directly from `../app/game`. It does not copy
shared game source and does not bundle the React Router server application.

```sh
npm run mobile:dev
npm run mobile:typecheck
npm run mobile:build
npm run mobile:sync
npm run mobile:android:install
```

Capacitor loads `build/mobile`. Android and iOS projects are generated from the
root `capacitor.config.ts`; iOS compilation and signing require macOS/Xcode.
Set `VITE_MOBILE_APP_BASE_URL` to the public tournaments web origin used for
Discord sign-in and the online lobby. Native builds reject localhost/loopback
origins rather than opening an unusable URL inside the device.

On Windows, `mobile:android:install` builds the mobile bundle, copies it into
Capacitor, force-repackages the debug APK, installs it on the only connected
phone/emulator, and launches Kandora. If multiple targets are connected, pick
one explicitly:

```powershell
npm run mobile:android:install -- -Serial emulator-5554
```

The first shell renders the production Pixi table and imports shared
`ReplayLog` JSON. Native startup opens a versioned SQLite `MatchRepository`
covering asynchronous live event journals, explicit-pause recovery checkpoints,
tombstones, completed matches, and replay archives; browser development uses
the existing in-memory repository. Normal turns never wait for SQLite.

Nearby mode currently runs a complete on-device solo table: one local human and
three shared-engine bots. `LocalMatchController` composes `MatchProcess` with
SQLite and feeds its `ServerMessage` callback through the same Zustand dispatcher
used by `GameWS`, so tile/action input and the production Pixi renderer do not
fork between cloud and local play. App backgrounding attempts to flush the
journal and save a checkpoint before suspension; mobile operating systems may
suspend JavaScript before that best-effort callback completes. Manual Pause
awaits the same barrier and therefore provides the exact Resume guarantee.

The online Lobby is native UI: it loads public rule presets and live room
summaries from `/api/mobile/lobby`, offers a rule-selection modal, and labels
waiting rooms as Join and active rooms as Watch. Discord login runs in a
Capacitor Browser tab and returns through `kandora://auth/complete`. Create and
Join open a boardless native waiting room backed by the shared `GameWS`
transport; once the server starts the match, the shell mounts the production
mobile Pixi table and routes actions over that socket. Watch uses the same table
with a spectator handshake. The production web service must be deployed with
the mobile API and auth routes before a newly built APK can create or connect to
live rooms.

Web and mobile share the canonical `/api/my-replays` contract and replay-query
service. Authentication logic resolves both clients to the same user principal,
while session transport remains platform-specific: web requests use the HttpOnly
site cookie and the native shell sends its scoped game token in a CORS-simple
form POST. The web route consumes the same response builder directly during SSR;
the mobile replay library flattens review relationship metadata for its compact
filters after validating the shared response.

## Universal Links and App Links

Public shares remain ordinary links on
`https://tournaments.tnt-sessions.com`. When Kandora is installed and the
domain association is verified, Android App Links and iOS Universal Links open
the native shell. Without the app, or when link handling is disabled, the same
URL continues to open the website. The custom `kandora://auth/complete` scheme
is reserved for the Discord OAuth callback.

| Public path             | Native destination                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `/game/:matchId`        | Join or reclaim the player seat. A full started room may redirect to spectating.            |
| `/spectate/:matchId`    | Spectate an internal Kandora match.                                                         |
| `/watch/live/:watchId`  | Resolve the tracked Tenhou relay, then spectate its internal match.                         |
| `/watch/replay/:gameId` | Open the replay viewer, preserving valid `seat`, `round`, `event`, and `review` parameters. |

Cached replays and matching reviews remain anonymously readable. A replay cache
miss and every live-game link require the native Discord session. The original
link is stored for 30 minutes and resumed after sign-in, including after a
process restart. Opening a different destination while a table is active asks
before leaving it. The developer-only `/watch/replay/tenhou-har` route and other
site pages are not native destinations.

The web service generates its association documents from these runtime values:

- `APPLE_APPLICATION_IDENTIFIER_PREFIX`: the application identifier prefix for
  the Apple App ID `com.kandora.app`.
- `ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS`: one or more comma-separated
  fingerprints for certificates that sign installed builds. For Play releases,
  copy the Play App Signing certificate fingerprint, not just the upload key.

Deploy and verify the web service before installing the native build. Missing
or malformed values deliberately make the relevant association resource return
`503` so Apple or Android cannot cache placeholder ownership data.

Android verification on an installed release-signed build:

```powershell
adb shell pm verify-app-links --re-verify com.kandora.app
adb shell pm get-app-links com.kandora.app
```

Test representative links from another app, such as Messages or Notes, for
both cold and warm launches. On iOS, tapping a same-domain link while already
browsing that domain in Safari can intentionally remain in Safari; test from a
different app or domain. Apple fetches association data through its CDN and may
take up to 24 hours to observe a newly deployed document.

`@capacitor-community/sqlite` packages SQLCipher on Android and iOS even when
database encryption is disabled. App Store release work must complete Apple's
encryption/export-compliance questionnaire and any required annual
self-classification before distribution. Android cloud backup and device
transfer are disabled for recovery databases so stale authority/tombstones
cannot migrate onto another installation.
