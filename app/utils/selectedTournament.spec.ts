import { describe, expect, it, vi } from "vitest";
import {
  readSelectedTournament,
  saveSelectedTournament,
  selectedTournamentFromNavigationState,
} from "./selectedTournament";

describe("selected tournament persistence", () => {
  it("round-trips a tournament selection through storage", () => {
    let storedValue: string | null = null;
    const storage = {
      getItem: vi.fn(() => storedValue),
      setItem: vi.fn((_key: string, value: string) => {
        storedValue = value;
      }),
    };
    const tournament = { slug: "spring-cup", name: "Spring Cup" };

    saveSelectedTournament(tournament, storage);

    expect(readSelectedTournament(storage)).toEqual(tournament);
  });

  it("ignores malformed stored selections", () => {
    const storage = {
      getItem: vi.fn(() => '{"slug":"spring-cup"}'),
    };

    expect(readSelectedTournament(storage)).toBeNull();
  });

  it("reads a valid selection from navigation state", () => {
    expect(
      selectedTournamentFromNavigationState({
        selectedTournament: {
          slug: "summer-league",
          name: "Summer League",
        },
      })
    ).toEqual({ slug: "summer-league", name: "Summer League" });
    expect(selectedTournamentFromNavigationState(null)).toBeNull();
  });
});
