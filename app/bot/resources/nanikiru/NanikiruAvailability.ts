export const KIN_PUBLIC_PROBLEM_LIMIT = 80;

export function isNanikiruProblemPublic(source: string | undefined): boolean {
  if (!source || !source.startsWith("KIN-")) {
    return true;
  }
  const match = source.match(/^KIN-Q-(\d+)$/);
  if (!match) {
    return false;
  }
  const problemNumber = Number(match[1]);
  return problemNumber >= 1 && problemNumber <= KIN_PUBLIC_PROBLEM_LIMIT;
}