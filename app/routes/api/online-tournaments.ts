import { connectToDatabase } from "../../utils/dbConnection.server";
import { LeagueModel, type League } from "../../db/League";
import { TeamModel } from "../../db/Team";
import { GameModel } from "../../db/Game";
import { slugify } from "../../utils/slugify";

export async function loader() {
  try {
    await connectToDatabase();

    const [leagues, teamCounts, gameCounts, gamePlayerCounts] =
      await Promise.all([
        LeagueModel.find({ isDisplayed: true })
          .select("_id name startTime endTime rulesConfig")
          .sort({ startTime: -1 })
          .lean<League[]>(),
        TeamModel.aggregate([
          {
            $group: {
              _id: "$leagueId",
              playerCount: {
                $sum: {
                  $add: [
                    { $size: { $ifNull: ["$roster.members", []] } },
                    { $size: { $ifNull: ["$roster.substitutes", []] } },
                  ],
                },
              },
            },
          },
        ]),
        GameModel.aggregate([
          { $match: { league: { $exists: true, $ne: null } } },
          { $group: { _id: "$league", gameCount: { $sum: 1 } } },
        ]),
        GameModel.aggregate([
          { $match: { league: { $exists: true, $ne: null } } },
          { $unwind: "$results" },
          {
            $group: {
              _id: "$league",
              userIds: { $addToSet: "$results.userId" },
            },
          },
          {
            $project: {
              _id: 1,
              playerCount: { $size: "$userIds" },
            },
          },
        ]),
      ]);

    const teamCountMap = new Map<string, number>();
    for (const tc of teamCounts) {
      teamCountMap.set(tc._id.toString(), tc.playerCount);
    }

    const gameCountMap = new Map<string, number>();
    for (const gc of gameCounts) {
      gameCountMap.set(gc._id.toString(), gc.gameCount);
    }

    const gamePlayerCountMap = new Map<string, number>();
    for (const gpc of gamePlayerCounts) {
      gamePlayerCountMap.set(gpc._id.toString(), gpc.playerCount);
    }

    const result = leagues.map((league) => {
      const id = league._id.toString();
      const isTeamMode = league.rulesConfig?.isTeamMode ?? false;
      const playerCount = isTeamMode
        ? (teamCountMap.get(id) ?? 0)
        : (gamePlayerCountMap.get(id) ?? 0);

      return {
        _id: id,
        name: league.name,
        slug: slugify(league.name),
        startTime: league.startTime,
        endTime: league.endTime,
        playerCount,
        gameCount: gameCountMap.get(id) ?? 0,
        rulesConfig: league.rulesConfig,
      };
    });

    return Response.json(result);
  } catch (error) {
    console.error("Failed to load online tournaments:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
