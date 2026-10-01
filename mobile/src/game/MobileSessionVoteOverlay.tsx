import { usePromptCountdown } from "~/game/client/time/usePromptCountdown";
import type {
  ActionWindowView,
  PromptIntentContext,
} from "~/game/protocol/timing";
import type { Seat } from "~/game/protocol/messages";

export function MobileSessionVoteOverlay({
  vote,
  window,
  mySeat,
  seatNames,
  onVote,
}: {
  vote: {
    deadline: number;
    votes: Array<"yes" | "no" | null>;
    gameIndex: number;
  } | null;
  window?: ActionWindowView | null;
  mySeat: Seat | null;
  seatNames: readonly string[] | null;
  onVote: (vote: "yes" | "no", intent?: PromptIntentContext) => void;
}) {
  const countdown = usePromptCountdown(window, vote?.deadline ?? null);
  if (!vote || mySeat === null) {
    return null;
  }
  const intent = window
    ? { windowId: window.id, clockEpoch: window.clockEpoch }
    : undefined;
  return (
    <div className="rule-modal-backdrop">
      <section
        className="rule-modal resume-active-game-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Continue session"
      >
        <header>
          <h2>Game {vote.gameIndex + 1} complete</h2>
        </header>
        <div>
          <p>Play another East game?</p>
          <ul>
            {vote.votes.map((value, seat) => (
              <li key={seat}>
                {seatNames?.[seat] || `Player ${seat + 1}`}:{" "}
                {value ?? "Waiting"}
              </li>
            ))}
          </ul>
          <output aria-live="polite">
            {countdown.synchronized
              ? `${Math.ceil(countdown.remainingMs / 1_000)}s`
              : "Synchronizing clock"}
          </output>
        </div>
        <footer>
          <button
            type="button"
            className="home-secondary-action"
            disabled={!countdown.canRespond || vote.votes[mySeat] === "no"}
            onClick={() => onVote("no", intent)}
          >
            No
          </button>
          <button
            type="button"
            className="home-primary-action"
            disabled={!countdown.canRespond || vote.votes[mySeat] === "yes"}
            onClick={() => onVote("yes", intent)}
          >
            Yes
          </button>
        </footer>
      </section>
    </div>
  );
}
