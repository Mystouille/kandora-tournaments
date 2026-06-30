import { TrophyOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface WinRateRankingCardProps {
  leagueIds: string[];
  playerIds: string[];
  teamIds: string[];
  startDate: string | null;
  endDate: string | null;
  cardId?: string;
  minGames?: number;
  invertRanking?: boolean;
  rankingsData?: RankingEntry[] | null;
  rankingsLoading?: boolean;
  rankingsError?: string | null;
  onHide?: () => void;
  pinnedPlayerId?: string | null;
}

export default function WinRateRankingCard(props: WinRateRankingCardProps) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<TrophyOutlined style={{ fontSize: 20, color: "#faad14" }} />}
      title={t.statistics.winRateRankingTitle}
      infoTooltip={t.statistics.winRateInfo}
      accentColor="#faad14"
      totalLabel={t.statistics.total}
      avgLabel={t.statistics.winRateLabel}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.roundsWon}
      getAvg={(item: RankingEntry) => item.winRate}
    />
  );
}
