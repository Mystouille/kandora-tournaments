import {
  DEGRADED_FAIRNESS_PROFILES,
  SUPPORTED_FAIRNESS_PROFILES,
  type FairnessProfile,
} from "../../../app/game/testing/timing/fairnessProfiles";

export const DEFERRED_30FPS_BROWSER_REASON =
  "User deferred 30 FPS Playwright evidence; the SC-002 FPS-floor browser gate remains unverified.";

export const DEFERRED_30FPS_BROWSER_PROFILES =
  SUPPORTED_FAIRNESS_PROFILES.filter(
    (profile) => profile.framesPerSecond === 30
  );

export const NORMAL_FRAME_RATE_BROWSER_PROFILES: readonly FairnessProfile[] =
  SUPPORTED_FAIRNESS_PROFILES.map((profile) => ({
    ...profile,
    name: profile.name.replace("-30fps", "-60fps"),
    framesPerSecond: 60,
  }));

export const DEGRADED_BROWSER_PROFILES: readonly FairnessProfile[] =
  DEGRADED_FAIRNESS_PROFILES.map((profile) =>
    profile.framesPerSecond === 30
      ? { ...profile, framesPerSecond: 60 }
      : profile
  );
