export interface RosterPlayerInput {
  userId: string;
  isSubstitute: boolean;
  isCaptain: boolean;
}

export interface RosterTeamInput {
  teamId?: string | null;
  simpleName: string;
  displayName: string;
  players: RosterPlayerInput[];
}

export class RosterUserRemapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterUserRemapError";
  }
}

export function canonicalRosterUserId(
  userId: string,
  replacements: ReadonlyMap<string, string>
) {
  const seen = new Set<string>();
  let current = userId;
  while (replacements.has(current)) {
    if (seen.has(current)) {
      throw new RosterUserRemapError("User replacement cycle detected");
    }
    seen.add(current);
    current = replacements.get(current)!;
  }
  return current;
}

function remapPlayers(
  players: RosterPlayerInput[],
  replacements: ReadonlyMap<string, string>
) {
  const remapped = new Map<string, RosterPlayerInput>();
  for (const player of players) {
    const userId = canonicalRosterUserId(player.userId, replacements);
    const existing = remapped.get(userId);
    if (!existing) {
      remapped.set(userId, { ...player, userId });
      continue;
    }
    existing.isCaptain = existing.isCaptain || player.isCaptain;
    existing.isSubstitute = existing.isSubstitute && player.isSubstitute;
  }
  return [...remapped.values()];
}

export function remapRosterUsers(
  teams: RosterTeamInput[],
  players: RosterPlayerInput[],
  replacements: ReadonlyMap<string, string>
) {
  const remappedTeams = teams.map((team) => ({
    ...team,
    players: remapPlayers(team.players, replacements),
  }));
  const teamByUserId = new Map<string, string>();
  for (const team of remappedTeams) {
    const teamKey = team.teamId ?? team.simpleName;
    for (const player of team.players) {
      const existingTeam = teamByUserId.get(player.userId);
      if (existingTeam && existingTeam !== teamKey) {
        throw new RosterUserRemapError(
          "An existing user cannot belong to multiple teams in one roster"
        );
      }
      teamByUserId.set(player.userId, teamKey);
    }
  }

  return {
    teams: remappedTeams,
    players: remapPlayers(players, replacements),
  };
}

export interface ScheduledRosterGameInput {
  id: string;
  scheduledAt: string | Date;
  slots: Array<{ seatIndex: number; participantId: string | null }>;
}

export function remapScheduledGameUsers(
  games: ScheduledRosterGameInput[],
  replacements: ReadonlyMap<string, string>
) {
  const assignments = new Set<string>();
  return games.map((game) => {
    const scheduledAt = new Date(game.scheduledAt);
    const participantsInGame = new Set<string>();
    const slots = game.slots.map((slot) => {
      const participantId = slot.participantId
        ? canonicalRosterUserId(slot.participantId, replacements)
        : null;
      if (participantId) {
        if (participantsInGame.has(participantId)) {
          throw new RosterUserRemapError(
            "An existing user cannot occupy multiple seats in one scheduled game"
          );
        }
        participantsInGame.add(participantId);
        const assignmentKey = `${scheduledAt.getTime()}:${participantId}`;
        if (assignments.has(assignmentKey)) {
          throw new RosterUserRemapError(
            "An existing user cannot play simultaneous scheduled games"
          );
        }
        assignments.add(assignmentKey);
      }
      return { ...slot, participantId };
    });
    return { ...game, slots };
  });
}

export interface ExistingRosterUserCandidate {
  id: string;
  name: string;
  isRegistered: boolean;
}

export interface RosterIdentityResolution<
  Candidate extends ExistingRosterUserCandidate,
> {
  owner: Candidate | null;
  duplicatesToMerge: Candidate[];
}

export function selectExistingRosterUser<
  Candidate extends ExistingRosterUserCandidate,
>(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) {
    return null;
  }
  const registered = candidates.filter((candidate) => candidate.isRegistered);
  if (registered.length === 1) {
    return registered[0];
  }
  if (registered.length > 1 || candidates.length > 1) {
    throw new RosterUserRemapError(
      "Multiple existing users own this platform identity"
    );
  }
  return candidates[0];
}

export function selectRosterIdentityOwner<
  Candidate extends ExistingRosterUserCandidate,
>(
  current: ExistingRosterUserCandidate,
  existingCandidates: Candidate[]
): Candidate | null {
  if (!current.isRegistered) {
    return selectExistingRosterUser(existingCandidates);
  }
  if (existingCandidates.some((candidate) => candidate.isRegistered)) {
    throw new RosterUserRemapError(
      "Multiple registered users own this platform identity"
    );
  }
  return null;
}

export function resolveRosterIdentityOwner<
  Candidate extends ExistingRosterUserCandidate,
>(
  current: ExistingRosterUserCandidate,
  existingCandidates: Candidate[]
): RosterIdentityResolution<Candidate> {
  const registered = existingCandidates.filter(
    (candidate) => candidate.isRegistered
  );
  if (current.isRegistered) {
    if (registered.length > 0) {
      throw new RosterUserRemapError(
        "Multiple registered users own this platform identity"
      );
    }
    return { owner: null, duplicatesToMerge: existingCandidates };
  }
  if (registered.length > 1) {
    throw new RosterUserRemapError(
      "Multiple registered users own this platform identity"
    );
  }
  if (registered.length === 1) {
    const owner = registered[0];
    return {
      owner,
      duplicatesToMerge: existingCandidates.filter(
        (candidate) => candidate.id !== owner.id
      ),
    };
  }
  return { owner: null, duplicatesToMerge: existingCandidates };
}
