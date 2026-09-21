export interface SelectedTournament {
  slug: string;
  name: string;
}

export const SELECTED_TOURNAMENT_STORAGE_KEY = "kandora_selected_tournament";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

function parseSelectedTournament(value: unknown): SelectedTournament | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.slug !== "string" ||
    typeof candidate.name !== "string"
  ) {
    return null;
  }

  const slug = candidate.slug.trim();
  const name = candidate.name.trim();
  return slug && name ? { slug, name } : null;
}

export function readSelectedTournament(
  storage: StorageReader
): SelectedTournament | null {
  try {
    const stored = storage.getItem(SELECTED_TOURNAMENT_STORAGE_KEY);
    return stored ? parseSelectedTournament(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export function saveSelectedTournament(
  tournament: SelectedTournament,
  storage: StorageWriter
): void {
  try {
    storage.setItem(
      SELECTED_TOURNAMENT_STORAGE_KEY,
      JSON.stringify(tournament)
    );
  } catch {
    // Storage can be unavailable in privacy mode or when its quota is full.
  }
}

export function selectedTournamentFromNavigationState(
  state: unknown
): SelectedTournament | null {
  if (!state || typeof state !== "object") {
    return null;
  }

  return parseSelectedTournament(
    (state as Record<string, unknown>).selectedTournament
  );
}
