import type {
  ActionWindowView,
  ActionIntentContext,
} from "../../../../app/game/protocol/timing";

export interface ReadyFrameEvidence {
  readonly performanceAt: number;
  readonly authorityAt: number;
  readonly baseRemainingMs: number;
  readonly window: ActionWindowView;
  readonly frame: number;
}

export interface SubmittedInputEvidence {
  readonly performanceAt: number;
  readonly authorityAt: number;
  readonly actionId: string;
  readonly intent: ActionIntentContext;
}

export interface AuthorityReceiptEvidence {
  readonly actionId: string;
  readonly windowId: string | null;
  readonly clockEpoch: string | null;
  readonly receivedAt: number;
  readonly resolvedAt: number;
  readonly accepted: boolean;
  readonly bankAfterMs: number | null;
  readonly error?: string;
}

export interface RoomEvidence {
  readonly matchId: string;
  readonly authorityNow: number;
  readonly window: ActionWindowView | null;
  readonly bankMs: number | null;
  readonly totalDiscards: number;
  readonly receipts: readonly AuthorityReceiptEvidence[];
  readonly attachedSessions: number;
  readonly status: string;
}

export interface BrowserTimingEvidence {
  readonly matchId: string;
  readonly ready: ReadyFrameEvidence | null;
  readonly infoVisibleAt: number | null;
  readonly drawLandAt: number | null;
  readonly submitted: SubmittedInputEvidence | null;
  readonly currentWindow: ActionWindowView | null;
  readonly currentRemainingMs: number | null;
  readonly bankMs: number | null;
  readonly frameIntervalsMs: readonly number[];
  readonly presentedFrames: readonly { frame: number; performanceAt: number }[];
  readonly drawLandingCount: number;
  readonly requestedFramesPerSecond: number;
  readonly degradedReasons: readonly string[];
}

export interface TimingHarness {
  ready(): Promise<ReadyFrameEvidence>;
  evidence(): BrowserTimingEvidence;
  authority(): Promise<RoomEvidence>;
  discardAfterReady(elapsedMs: number): Promise<BrowserTimingEvidence>;
  discardNow(): Promise<BrowserTimingEvidence>;
  clockError(): Promise<{ errorMs: number; referenceRoundTripMs: number }>;
  stepWallClock(deltaMs: number): {
    before: BrowserTimingEvidence;
    after: BrowserTimingEvidence;
    elapsedMs: number;
  };
  foregroundGap(durationMs: number): Promise<BrowserTimingEvidence>;
  restoreEpoch(): Promise<BrowserTimingEvidence>;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    timingHarness?: TimingHarness;
  }
}
