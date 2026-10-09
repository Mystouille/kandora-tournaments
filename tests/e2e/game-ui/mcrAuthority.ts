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
import { activeSeats } from "../../../app/game/rules/seats";
import { ServerMessageSchema } from "../../../app/game/protocol/messages";
import {
  REPLAY_LOG_SCHEMA_VERSION,
  type ReplayLog,
} from "../../../app/game/replay/types";
import { dealMatch } from "../../../app/game/rules/wall";

function fixtureSeed(): number {
  for (let seed = 0; seed < 100; seed++) {
    const deal = dealMatch(seed, { rulesFamily: "mcr" });
    if ((deal.flowerTiles?.flat().length ?? 0) > 0) {
      return seed;
    }
  }
  throw new Error("No deterministic MCR flower fixture was found");
}

export async function authoritativeMcrFixture(input: unknown) {
  const setup = GameSetupSchema.parse(input);
  if (setup.rulesFamily !== "mcr") {
    throw new Error("Expected an MCR setup");
  }
  const clock = createAuthorityClock({ epoch: "mcr-browser-clock" });
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
  const names = ["East", "South", "West", "North"];
  const match = new MatchProcess(
    "browser-mcr",
    fixtureSeed(),
    activeSeats(4).map((seat) => ({
      userId: `human-${seat}`,
      displayName: names[seat],
      isBot: false,
    })),
    { repository: ephemeralMatchRepository, runtime },
    undefined,
    rules,
    "mcr-ema",
    setup.mode
  );
  for (const seat of activeSeats(4)) {
    match.attachHuman(seat, (message) => {
      ServerMessageSchema.parse(message);
    });
  }
  setReadyCheckMs(0);
  await match.start();
  const replay = (): ReplayLog => ({
    rulesFamily: "mcr",
    source: "ingame",
    sourceGameId: "browser-mcr",
    ruleSet: "mcr-ema",
    ruleSetDetails: { ...rules },
    mode: setup.mode,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    schemaVersion: REPLAY_LOG_SCHEMA_VERSION,
    seats: activeSeats(4).map((seat) => ({
      seat,
      displayName: names[seat],
      finalScore: match.owners.kernel.currentState().scores[seat],
      place: (seat + 1) as 1 | 2 | 3 | 4,
    })),
    events: match.owners.publisher.history().map((entry) => entry.event),
  });
  return { match, clock, replay, setup };
}
