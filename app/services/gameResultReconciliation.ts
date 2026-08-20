import type { GameResult } from "~/core/models/tournament/Game";

export function reconcileGameResultStanding(
  results: GameResult[],
  userId: GameResult["userId"],
  score: number,
  place: number
): boolean {
  const index = results.findIndex(
    (result) => result.userId?.toString() === userId.toString()
  );
  if (index < 0) {
    results.push({ userId, score, place, nbChombo: 0 });
    return true;
  }

  const current = results[index];
  if (current.score === score && current.place === place) {
    return false;
  }
  current.score = score;
  current.place = place;
  return true;
}