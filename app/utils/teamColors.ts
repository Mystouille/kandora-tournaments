export const DEFAULT_TEAM_COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
] as const;

export type TeamColorMap = ReadonlyMap<string, string | null>;

export interface TeamColorLookup {
  byTeamId: TeamColorMap;
  byPlayerId: TeamColorMap;
  graphs: ReadonlyMap<string, string>;
}

interface ColoredTeam {
  _id: string;
  leagueId?: string;
  color?: string | null;
  roster: {
    members: readonly string[];
    substitutes: readonly string[];
  };
}

export function getDefaultTeamColor(index: number): string {
  return DEFAULT_TEAM_COLORS[index % DEFAULT_TEAM_COLORS.length];
}

export function isTeamColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function resolveRosterTeamColor(
  requested: string | null | undefined,
  existing: { color?: string | null } | undefined,
  index: number
): string | null {
  if (requested !== undefined) {
    return requested?.toLowerCase() ?? null;
  }
  return existing ? (existing.color ?? null) : getDefaultTeamColor(index);
}

export function buildTeamColorLookup(
  teams: readonly ColoredTeam[]
): TeamColorLookup {
  const byTeamId = new Map<string, string | null>();
  const byPlayerId = new Map<string, string | null>();
  const graphs = new Map<string, string>();
  const leagueIndexes = new Map<string, number>();

  for (const team of teams) {
    const color = team.color ?? null;
    byTeamId.set(team._id, color);
    for (const playerId of [
      ...team.roster.members,
      ...team.roster.substitutes,
    ]) {
      byPlayerId.set(playerId, color);
    }
  }

  for (const team of [...teams].sort((a, b) => a._id.localeCompare(b._id))) {
    const leagueId = team.leagueId ?? "";
    const index = leagueIndexes.get(leagueId) ?? 0;
    graphs.set(team._id, team.color ?? getDefaultTeamColor(index));
    leagueIndexes.set(leagueId, index + 1);
  }

  return { byTeamId, byPlayerId, graphs };
}

export function snapshotTeamColors(
  teams: readonly { simpleName: string; color?: string | null }[]
): TeamColorMap {
  return new Map(teams.map((team) => [team.simpleName, team.color ?? null]));
}

export function getImportedTeamColor(
  existing: TeamColorMap,
  name: string,
  index: number
): string | null {
  if (existing.has(name)) {
    return existing.get(name) ?? null;
  }
  return getDefaultTeamColor(index);
}

export function teamColorGradient(color: string | null | undefined) {
  return color
    ? `linear-gradient(to right, ${color}ff 0%, ${color}00 100%)`
    : undefined;
}

export function teamColorForeground(color: string | null | undefined) {
  if (!color) {
    return undefined;
  }
  const [red, green, blue] = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "#000000"
    : "#ffffff";
}

export function teamColorLabelStyle(color: string | null | undefined) {
  const foreground = teamColorForeground(color);
  if (!foreground) {
    return {};
  }
  // The halo keeps long labels readable as the gradient fades into either theme.
  const halo = foreground === "#ffffff" ? "#000000" : "#ffffff";
  return {
    color: foreground,
    textShadow: `0 0 2px ${halo}, 0 0 2px ${halo}`,
  };
}
