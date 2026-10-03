import type { GameEvent } from "~/game/protocol/messages";
import type {
  SummaryData,
  SummaryHandLabel,
  SummaryPlayerStats,
  SummaryPoints,
} from "~/types/leagueGameSummary";

export interface SummaryRoundStats {
  hasRiichi: boolean;
  isWinner: boolean;
  gotRonned: boolean;
  ryuukyoku: boolean;
}

export interface SummaryPlayerRecord {
  playerId: string;
  roundEvents: readonly SummaryRoundStats[];
}

export function buildSummaryStats(
  records: readonly SummaryPlayerRecord[],
  playerIds: readonly string[],
  expectedHands?: number
): SummaryData<Record<string, SummaryPlayerStats>> {
  if (records.length === 0) {
    return { status: "unavailable", reason: "missingRecord" };
  }
  const byId = new Map(records.map((record) => [record.playerId, record]));
  const handCount = expectedHands ?? records[0].roundEvents.length;
  if (
    handCount === 0 ||
    byId.size !== records.length ||
    playerIds.length === 0
  ) {
    return { status: "unavailable", reason: "incompleteRecord" };
  }
  const data: Record<string, SummaryPlayerStats> = {};
  for (const playerId of playerIds) {
    const rounds = byId.get(playerId)?.roundEvents;
    if (
      !rounds ||
      rounds.length !== handCount ||
      rounds.some((round) =>
        [
          round.hasRiichi,
          round.isWinner,
          round.gotRonned,
          round.ryuukyoku,
        ].some((value) => typeof value !== "boolean")
      )
    ) {
      return { status: "unavailable", reason: "incompleteRecord" };
    }
    data[playerId] = {
      riichis: rounds.filter((round) => round.hasRiichi).length,
      wins: rounds.filter((round) => round.isWinner).length,
      dealIns: rounds.filter((round) => round.gotRonned).length,
    };
  }
  return { status: "available", data };
}

function validScores(scores: number[] | undefined): scores is number[] {
  return (
    scores !== undefined && scores.length === 4 && scores.every(Number.isFinite)
  );
}

export function buildSummaryPoints(
  events: readonly GameEvent[],
  players: readonly { playerId: string; seat: number; score: number }[]
): SummaryData<SummaryPoints> {
  if (events.length === 0) {
    return { status: "unavailable", reason: "missingRecord" };
  }
  const incomplete = {
    status: "unavailable",
    reason: "incompleteRecord",
  } as const;
  if (
    players.length === 0 ||
    players.some(
      (player) =>
        !Number.isInteger(player.seat) || player.seat < 0 || player.seat > 3
    ) ||
    new Set(players.map((player) => player.seat)).size !== players.length ||
    new Set(players.map((player) => player.playerId)).size !== players.length
  ) {
    return incomplete;
  }

  const hands: {
    label: SummaryHandLabel;
    startScores: number[] | null;
    endScores: number[] | null;
    closed: boolean;
  }[] = [];
  let finalScores: Map<number, number> | null = null;

  for (const event of events) {
    if (event.type === "hand_start") {
      if (finalScores || (hands.length > 0 && !hands.at(-1)!.closed)) {
        return incomplete;
      }
      hands.push({
        label: {
          kind: "hand",
          wind: event.roundWind ?? null,
          number: event.roundNumber ?? null,
          honba: event.honba ?? 0,
        },
        startScores: validScores(event.scores) ? event.scores : null,
        endScores: null,
        closed: false,
      });
    } else if (event.type === "hand_end") {
      const hand = hands.at(-1);
      if (!hand || hand.closed || finalScores) {
        return incomplete;
      }
      hand.closed = true;
      hand.endScores = validScores(event.scores) ? event.scores : null;
    } else if (event.type === "match_end") {
      if (finalScores) {
        return incomplete;
      }
      finalScores = new Map(
        event.finalScores.map((standing) => [standing.seat, standing.score])
      );
      if (finalScores.size !== event.finalScores.length) {
        return incomplete;
      }
    }
  }

  const initialScores = hands[0]?.startScores;
  if (!initialScores || !finalScores || hands.some((hand) => !hand.closed)) {
    return incomplete;
  }
  if (
    players.some((player) => finalScores!.get(player.seat) !== player.score)
  ) {
    return { status: "unavailable", reason: "inconsistentScores" };
  }
  const snapshots: number[][] = [initialScores];
  for (let index = 0; index < hands.length; index++) {
    // Deal/match boundaries include riichi bets that intermediate hand-end snapshots may omit.
    const scores =
      index === hands.length - 1
        ? Array.from({ length: 4 }, (_, seat) => finalScores.get(seat) ?? NaN)
        : (hands[index + 1]?.startScores ?? hands[index].endScores);
    if (!scores || !scores.every(Number.isFinite)) {
      return incomplete;
    }
    snapshots.push(scores);
  }

  const labels: SummaryHandLabel[] = [
    { kind: "start" },
    ...hands.map((hand) => hand.label),
  ];
  return {
    status: "available",
    data: {
      labels,
      series: players.map((player) => ({
        playerId: player.playerId,
        scores: snapshots.map((scores) => scores[player.seat]),
      })),
    },
  };
}
