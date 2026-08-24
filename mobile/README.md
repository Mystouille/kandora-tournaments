# Kandora mobile

The mobile web bundle is a standalone Vite entry that imports renderer,
protocol, replay, and rules code directly from `../app/game`. It does not copy
shared game source and does not bundle the React Router server application.

```sh
npm run mobile:dev
npm run mobile:typecheck
npm run mobile:build
npm run mobile:sync
```

Capacitor loads `build/mobile`. Android and iOS projects are generated from the
root `capacitor.config.ts`; iOS compilation and signing require macOS/Xcode.

The first shell renders the production Pixi table and imports shared
`ReplayLog` JSON. Native startup opens a versioned SQLite `MatchRepository`
covering recovery checkpoints, command transactions, tombstones, completed
matches, and replay archives; browser development uses the existing in-memory
repository.

Nearby mode currently runs a complete on-device solo table: one local human and
three shared-engine bots. `LocalMatchController` composes `MatchProcess` with
SQLite and feeds its `ServerMessage` callback through the same Zustand dispatcher
used by `GameWS`, so tile/action input and the production Pixi renderer do not
fork between cloud and local play. App backgrounding atomically pauses/saves the
match; foregrounding restores a new process from the active recovery record.
The shell also exposes manual Pause/Resume for the same path.

Cloud play and multi-phone Nearby host/join remain transport boundaries for the
next milestone. Google Nearby Connections is not implemented in this shell yet.

`@capacitor-community/sqlite` packages SQLCipher on Android and iOS even when
database encryption is disabled. App Store release work must complete Apple's
encryption/export-compliance questionnaire and any required annual
self-classification before distribution. Android cloud backup and device
transfer are disabled for recovery databases so stale authority/tombstones
cannot migrate onto another installation.