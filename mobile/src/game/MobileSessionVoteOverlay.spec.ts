import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileSessionVoteOverlay } from "./MobileSessionVoteOverlay";
import { ActionWindowViewSchema } from "~/game/protocol/timing";
import { bindLiveClock, releaseLiveClock } from "~/game/client/time/liveClock";

const owner = {};
afterEach(() => { releaseLiveClock(owner); vi.restoreAllMocks(); });

describe("native fixed-vote controls", () => {
  it("retains legacy countdown and yes/no controls", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    const html = renderToStaticMarkup(createElement(MobileSessionVoteOverlay, {
      vote: { deadline: 15_000, votes: [null, "yes", "yes", "yes"], gameIndex: 0 },
      mySeat: 0, seatNames: ["One", "Two", "Three", "Four"], onVote: vi.fn(),
    }));
    expect(html).toContain(">Yes</button>");
    expect(html).toContain(">No</button>");
    expect(html).toContain(">5s</output>");
  });

  it("disables unsynchronized upgraded replies rather than inventing a client budget", () => {
    const window = ActionWindowViewSchema.parse({
      id: "vote-1", clockEpoch: "epoch-1", timingVersion: 2, seat: 0, kind: "session_vote",
      state: "open", infoSentAt: 1_000, opensAt: 1_000, baseEndsAt: 11_000,
      budgetEndsAt: 11_000, expiresAt: 11_200, bankAtOpenMs: 0,
      allowanceMs: 200, generation: 1, legalActionIds: ["yes", "no"],
    });
    bindLiveClock(owner, { now: () => null, quality: () => null });
    const html = renderToStaticMarkup(createElement(MobileSessionVoteOverlay, {
      vote: { deadline: 11_000, votes: [null, "yes", "yes", "yes"], gameIndex: 0 },
      window, mySeat: 0, seatNames: null, onVote: vi.fn(),
    }));
    expect(html).toContain("Synchronizing clock");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
