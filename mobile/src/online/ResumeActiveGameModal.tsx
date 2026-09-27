import { RefreshCw, X } from "lucide-react";
import type { ActiveMatchSummary } from "~/game/protocol/activeMatch";

interface ResumeActiveGameModalProps {
  activeMatch: ActiveMatchSummary;
  busy: boolean;
  onResume: () => void;
  onDecline: () => void;
}

export function ResumeActiveGameModal({
  activeMatch,
  busy,
  onResume,
  onDecline,
}: ResumeActiveGameModalProps) {
  return (
    <div className="rule-modal-backdrop" role="presentation">
      <section
        className="rule-modal resume-active-game-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-active-game-title"
        aria-describedby="resume-active-game-description"
      >
        <header>
          <div>
            <h2 id="resume-active-game-title">Resume active game?</h2>
            <span>{activeMatch.matchId}</span>
          </div>
          <button
            type="button"
            className="shell-icon-button"
            aria-label="Not now"
            disabled={busy}
            onClick={onDecline}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <p id="resume-active-game-description">
          This account is currently seated in an online game. Resuming here will
          transfer control from the other device.
        </p>
        <footer>
          <button
            type="button"
            className="home-secondary-action"
            disabled={busy}
            onClick={onDecline}
          >
            Not now
          </button>
          <button
            type="button"
            className="home-primary-action"
            disabled={busy}
            onClick={onResume}
          >
            <RefreshCw
              aria-hidden="true"
              className={busy ? "spin" : undefined}
            />
            Resume
          </button>
        </footer>
      </section>
    </div>
  );
}
