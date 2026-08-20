import { describe, expect, it } from "vitest";
import { resolveLeagueLobbies } from "./leagueLobbies";

describe("resolveLeagueLobbies", () => {
  it("returns the untagged primary lobby for a single-lobby league", () => {
    expect(
      resolveLeagueLobbies({
        tournamentId: "primary",
        internalTournamentId: "internal-primary",
        seasonId: "2",
        phaseTournaments: [],
      })
    ).toEqual([
      {
        phaseId: null,
        tournamentId: "primary",
        internalTournamentId: "internal-primary",
        seasonId: "2",
      },
    ]);
  });

  it("returns only phase-tagged lobbies in configured order", () => {
    expect(
      resolveLeagueLobbies({
        tournamentId: "primary",
        phaseTournaments: [
          {
            phaseId: "regular",
            tournamentId: "regular-lobby",
            internalTournamentId: "regular-internal",
          },
          { phaseId: "finals", tournamentId: "finals-lobby" },
        ],
      })
    ).toEqual([
      {
        phaseId: "regular",
        tournamentId: "regular-lobby",
        internalTournamentId: "regular-internal",
        seasonId: undefined,
      },
      {
        phaseId: "finals",
        tournamentId: "finals-lobby",
        internalTournamentId: undefined,
        seasonId: undefined,
      },
    ]);
  });

  it("returns no lobbies when none are configured", () => {
    expect(resolveLeagueLobbies({ phaseTournaments: [] })).toEqual([]);
  });
});