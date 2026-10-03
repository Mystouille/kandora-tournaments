import type { LeagueGameSummary } from "../../../app/types/leagueGameSummary";

export function gameSummaryFixture(): LeagueGameSummary {
  const colors = ["#ef754b", "#53c995", "#74a9ff", "#eac858"];
  const names = [
    "Alice Martin",
    "Benoit Laurent",
    "Clara Dupont",
    "Daniel Nguyen",
  ];
  const scores = [44100, 30200, 19000, 6700];
  return {
    id: "100000000000000000000001",
    platformGameId: "example-game",
    league: {
      id: "200000000000000000000001",
      name: "Kandora Premier League",
      slug: "kandora-premier-league",
      isTeamMode: true,
    },
    startTime: "2026-08-30T18:00:00Z",
    endTime: "2026-08-30T19:15:00Z",
    phaseId: "second",
    isCounted: true,
    players: names.map((name, i) => ({
      id: `player-${i + 1}`,
      name,
      teamName: ["Red Cranes", "Jade Dragons", "Blue Waves", "Golden Tigers"][
        i
      ],
      imageUrl: null,
      teamLogoUrl: null,
      color: colors[i],
      seat: i,
      score: scores[i],
      place: i + 1,
      gamePoints: [64.1, 10.2, -21, -53.3][i],
    })),
    handCount: 8,
    drawCount: 2,
    stats: {
      status: "available",
      data: {
        "player-1": { riichis: 4, wins: 3, dealIns: 0 },
        "player-2": { riichis: 2, wins: 2, dealIns: 1 },
        "player-3": { riichis: 3, wins: 1, dealIns: 2 },
        "player-4": { riichis: 1, wins: 0, dealIns: 1 },
      },
    },
    points: {
      status: "available",
      data: {
        labels: [
          { kind: "start" },
          ...Array.from({ length: 8 }, (_, index) => ({
            kind: "hand" as const,
            wind: index < 4 ? ("E" as const) : ("S" as const),
            number: (index % 4) + 1,
            honba: 0,
          })),
        ],
        series: [
          {
            playerId: "player-1",
            scores: [
              25000, 29000, 28400, 40000, 38000, 39000, 41500, 42000, 44100,
            ],
          },
          {
            playerId: "player-2",
            scores: [
              25000, 28000, 32000, 27000, 29000, 26000, 29000, 31000, 30200,
            ],
          },
          {
            playerId: "player-3",
            scores: [
              25000, 18000, 22000, 15000, 23000, 19000, 16500, 15000, 19000,
            ],
          },
          {
            playerId: "player-4",
            scores: [
              25000, 25000, 17600, 18000, 10000, 16000, 13000, 12000, 6700,
            ],
          },
        ],
      },
    },
    standings: {
      status: "available",
      data: [
        {
          id: "team-1",
          name: "Red Cranes",
          teamName: null,
          imageUrl: null,
          teamLogoUrl: null,
          color: colors[0],
          rank: 1,
          rankHighlight: "leader",
          totalScore: 164.7,
          pointsChange: 64.1,
          pointsDifference: null,
          gamesPlayed: 12,
          totalGames: 14,
          eliminated: false,
          playedThisGame: true,
        },
        {
          id: "team-2",
          name: "Jade Dragons",
          teamName: null,
          imageUrl: null,
          teamLogoUrl: null,
          color: colors[1],
          rank: 2,
          rankHighlight: null,
          totalScore: 85.2,
          pointsChange: 10.2,
          pointsDifference: 79.5,
          gamesPlayed: 12,
          totalGames: 14,
          eliminated: false,
          playedThisGame: true,
        },
        {
          id: "team-3",
          name: "Blue Waves",
          teamName: null,
          imageUrl: null,
          teamLogoUrl: null,
          color: colors[2],
          rank: 3,
          rankHighlight: null,
          totalScore: null,
          pointsChange: null,
          pointsDifference: null,
          gamesPlayed: 8,
          totalGames: null,
          eliminated: true,
          playedThisGame: false,
        },
        {
          id: "team-4",
          name: "Golden Tigers",
          teamName: null,
          imageUrl: null,
          teamLogoUrl: null,
          color: colors[3],
          rank: 4,
          rankHighlight: null,
          totalScore: null,
          pointsChange: null,
          pointsDifference: null,
          gamesPlayed: 8,
          totalGames: null,
          eliminated: true,
          playedThisGame: false,
        },
      ],
    },
  };
}
