import type { GameResult } from "~/core/models/tournament/Game";

export function reconcileGameResultStanding(
  results: GameResult[],
  userId: GameResult["userId"],
  score: number,
  place: number,
  aliasUserIds: ReadonlyArray<GameResult["userId"]> = []
): boolean {
  const canonicalId = userId.toString();
  const matchingIds = new Set([
    canonicalId,
    ...aliasUserIds.map((alias) => alias.toString()),
  ]);
  const matchingIndices = results.flatMap((result, index) =>
    matchingIds.has(result.userId?.toString()) ? [index] : []
  );
  if (matchingIndices.length === 0) {
    results.push({ userId, score, place, nbChombo: 0 });
    return true;
  }

  const canonicalIndex = matchingIndices.find(
    (index) => results[index].userId?.toString() === canonicalId
  );
  const keepIndex = canonicalIndex ?? matchingIndices[0];
  const current = results[keepIndex];
  let changed =
    current.userId?.toString() !== canonicalId ||
    current.score !== score ||
    current.place !== place ||
    matchingIndices.length > 1;
  current.userId = userId;
  current.score = score;
  current.place = place;

  for (const index of matchingIndices.slice().sort((a, b) => b - a)) {
    if (index !== keepIndex) {
      results.splice(index, 1);
      if (index < keepIndex) {
        changed = true;
      }
    }
  }
  return changed;
}
