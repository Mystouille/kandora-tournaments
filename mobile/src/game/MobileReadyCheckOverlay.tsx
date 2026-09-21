import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  advanceReadyCheckTick,
  type ReadyCheckTickState,
} from "~/game/client/readyCheckCountdown";
import { playGameCountdownSound } from "~/game/client/sound";
import type { Seat } from "~/game/protocol/messages";

export interface MobileReadyCheck {
  deadline: number;
  acked: [boolean, boolean, boolean, boolean];
}

export interface MobileResultPanelBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function mobileReadyCheckSeconds(
  deadline: number,
  now: number = Date.now()
): number {
  return Math.ceil(Math.max(0, deadline - now) / 1000);
}

export function MobileReadyCheckOverlay({
  readyCheck,
  mySeat,
  resultPanelBounds,
  onReady,
}: {
  readyCheck: MobileReadyCheck | null;
  mySeat: Seat | null;
  resultPanelBounds: MobileResultPanelBounds | null;
  onReady: () => void;
}) {
  const deadline = readyCheck?.deadline ?? null;
  const [remainingMs, setRemainingMs] = useState(() =>
    deadline === null ? 0 : Math.max(0, deadline - Date.now())
  );
  const [submittedDeadline, setSubmittedDeadline] = useState<number | null>(
    null
  );
  const lastTickRef = useRef<ReadyCheckTickState>({
    deadline: null,
    seconds: -1,
  });
  const acknowledged =
    readyCheck !== null && mySeat !== null ? readyCheck.acked[mySeat] : false;
  const locallyReady =
    acknowledged || (deadline !== null && submittedDeadline === deadline);

  useEffect(() => {
    if (deadline === null) {
      setRemainingMs(0);
      return;
    }
    let frame: number | null = null;
    const update = (): void => {
      const nextRemainingMs = Math.max(0, deadline - Date.now());
      setRemainingMs(nextRemainingMs);
      if (nextRemainingMs > 0) {
        frame = requestAnimationFrame(update);
      }
    };
    update();
    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [deadline]);

  const seconds = Math.ceil(remainingMs / 1000);
  useEffect(() => {
    const tick = advanceReadyCheckTick(
      lastTickRef.current,
      deadline,
      seconds,
      locallyReady
    );
    lastTickRef.current = tick.next;
    if (tick.play && deadline !== null) {
      playGameCountdownSound(
        "game-start-tick",
        `mobile-ready:${deadline}`,
        seconds
      );
    }
  }, [deadline, locallyReady, seconds]);

  if (readyCheck === null || mySeat === null) {
    return null;
  }

  const isPostHand = resultPanelBounds !== null;
  const style: CSSProperties | undefined = resultPanelBounds
    ? {
        left: resultPanelBounds.x + resultPanelBounds.w - 8,
        top: resultPanelBounds.y + resultPanelBounds.h - 8,
      }
    : undefined;

  return (
    <div
      className={`mobile-ready-check ${
        isPostHand ? "mobile-ready-check-result" : "mobile-ready-check-centered"
      }`}
      style={style}
      role="group"
      aria-label="Ready check"
    >
      <button
        type="button"
        className="mobile-ready-check-button"
        disabled={locallyReady}
        onClick={() => {
          if (!locallyReady) {
            setSubmittedDeadline(deadline);
            onReady();
          }
        }}
      >
        {locallyReady ? "CONFIRMED" : isPostHand ? "OK" : "GO"}
      </button>
      <output className="mobile-ready-check-countdown" aria-live="polite">
        {seconds}s
      </output>
    </div>
  );
}
