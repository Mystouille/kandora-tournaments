import {
  GameSetupSchema,
  gameSetupRules,
} from "../../../app/game/rules/gameSetup";
import {
  MatchProcess,
  setReadyCheckMs,
} from "../../../app/game/server/src/match";
import { ephemeralMatchRepository } from "../../../app/game/server/src/repository";
import type { MatchRuntime } from "../../../app/game/server/src/runtime";
import { createAuthorityClock } from "../../../app/game/server/src/timing/authorityClock";
import {
  duplicateMatchSeed,
  generateDuplicateHandPlan,
} from "../../../app/game/server/src/match-drivers/duplicatePlan";
import { DUPLICATE_GENERATION_VERSION } from "../../../app/game/protocol/matchMode";
import { activeSeats } from "../../../app/game/rules/seats";
import { ServerMessageSchema } from "../../../app/game/protocol/messages";
import {
  REPLAY_LOG_SCHEMA_VERSION,
  type ReplayLog,
} from "../../../app/game/replay/types";
import { editMatchState } from "../../../app/game/testing/matchState";

export function onlineBoardSeed(): string {
  for (let index = 0; index < 100; index++) {
    const seed = `browser-sanma-${index}`;
    const plan = generateDuplicateHandPlan(
      {
        type: "duplicate",
        seed,
        generationVersion: DUPLICATE_GENERATION_VERSION,
      },
      "m-league",
      { gameIndex: 0, roundWind: "E", roundNumber: 1, honba: 0, dealer: 0 },
      { playerCount: 3, sanmaType: "online", redFives: { p: 1, s: 1 } }
    );
    if (plan.deal.hands[0].includes("4z") || plan.drawQueues[0][0] === "4z") {
      return seed;
    }
  }
  throw new Error("No deterministic North fixture was found");
}

export async function authoritativeFixture(input: unknown) {
  const setup = GameSetupSchema.parse(input);
  const clock = createAuthorityClock({ epoch: "sanma-browser-clock" });
  const runtime: MatchRuntime = {
    clockEpoch: clock.epoch,
    now: () => clock.now(),
    random: () => 0.5,
    captureRandomState: () => 0,
    restoreRandomState: () => undefined,
    schedule: () => ({ cancel: () => undefined }),
    sleep: async () => undefined,
  };
  const rules = gameSetupRules(setup);
  const names = ["Initial East", "Initial South", "Initial West"];
  const match = new MatchProcess(
    "browser-sanma",
    setup.mode.type === "duplicate" ? duplicateMatchSeed(setup.mode) : 42,
    activeSeats(3).map((seat) => ({
      userId: `human-${seat}`,
      displayName: names[seat],
      isBot: false,
    })),
    { repository: ephemeralMatchRepository, runtime },
    setup.sanmaType === "online" && setup.mode.type === "normal"
      ? { humanDraws: ["4z"] }
      : undefined,
    rules,
    "m-league",
    setup.mode
  );
  for (const seat of activeSeats(3)) {
    match.attachHuman(seat, (message) => {
      ServerMessageSchema.parse(message);
    });
  }
  setReadyCheckMs(0);
  await match.start();
  if (setup.sanmaType === "online") {
    await match.owners.gameplay.effects.applyEngineAction({
      type: "nuki",
      seat: 0,
      tile: "4z",
    });
    await match.owners.gameplay.effects.applyEngineAction({
      type: "complete_nuki",
    });
    await match.owners.gameplay.turns.afterCall();
  }
  if (match.claimSeat("fourth", "Fourth") !== null) {
    throw new Error("Sanma admitted a fourth participant");
  }
  const replay = (): ReplayLog => ({
    source: "ingame",
    sourceGameId: "browser-sanma",
    ruleSet: "m-league",
    ruleSetDetails: { ...rules },
    mode: setup.mode,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    schemaVersion: REPLAY_LOG_SCHEMA_VERSION,
    seats: activeSeats(3).map((seat) => ({
      seat,
      displayName: names[seat],
      finalScore: match.owners.kernel.currentState().scores[seat],
      place: (seat + 1) as 1 | 2 | 3,
    })),
    events: match.owners.publisher.history().map((entry) => entry.event),
  });
  return { match, clock, replay, setup };
}

export async function advanceDealer(match: MatchProcess): Promise<void> {
  editMatchState(match, (state) => {
    state.phase = "hand_ended";
    state.lastHandResult = {
      reason: "ron",
      winner: 1,
      loser: 2,
      delta: [0, 1_000, -1_000],
      tenpai: null,
      abortKind: null,
      winHan: 1,
      winYakuman: false,
    };
  });
  await match.owners.lifecycle.hand.beginNextHandAfterReady();
}
