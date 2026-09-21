---
name: Mobile App Versioning
description: "Use when changing the Kandora mobile app, its shared game runtime, native projects, or mobile build configuration. Ensures the visible app version is bumped for shipped changes."
applyTo:
  - "mobile/**"
  - "app/game/**"
  - "android/**"
  - "ios/**"
  - "capacitor.config.ts"
  - "vite.mobile.config.ts"
---

# Mobile App Versioning

- After completing a task that changes shipped mobile behavior, UI, assets, runtime code, or native/build configuration, increment `MOBILE_APP_VERSION` in `mobile/src/App.tsx` exactly once.
- Use a semantic-version patch bump by default, for example `0.0.1` to `0.0.2`. Use a version or bump level specified by the user instead when provided.
- Apply the bump after the functional edits and before final validation so the validated bundle contains the new version.
- Do not bump for tests-only, documentation-only, comment-only, formatting-only, or agent-instruction changes.
- Mention the resulting version in the final response.