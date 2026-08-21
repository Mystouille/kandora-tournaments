import { shanten, type HandCounts } from "~/game/rules/shanten";

export function shantenFromTileMatrix(
  matrix: readonly (readonly number[])[]
): number {
  const counts: HandCounts = {
    m: matrix[0] as number[],
    p: matrix[1] as number[],
    s: matrix[2] as number[],
    z: matrix[3] as number[],
  };
  return shanten(counts);
}