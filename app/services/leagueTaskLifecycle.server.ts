import { LeagueModel } from "../core/models/tournament/League";
import { SchedulingMessageModel } from "../core/models/tournament/SchedulingMessage";

export async function canContinueLeagueTask(leagueId: string) {
  return Boolean(await LeagueModel.exists({ _id: leagueId }));
}

export async function canContinueSchedulingPoll(
  leagueId: string,
  messageId: string
) {
  const [league, schedulingMessage] = await Promise.all([
    LeagueModel.exists({ _id: leagueId }),
    SchedulingMessageModel.exists({
      league: leagueId,
      messageId,
      status: { $in: ["upcoming", "in_progress"] },
    }),
  ]);
  return Boolean(league && schedulingMessage);
}