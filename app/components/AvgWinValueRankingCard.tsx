import { RiseOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface AvgWinValueRankingCardProps {
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

export default function AvgWinValueRankingCard(
  props: AvgWinValueRankingCardProps
) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<RiseOutlined style={{ fontSize: 20, color: "#389e0d" }} />}
      title={t.statistics.avgWinValueRankingTitle}
      infoTooltip={t.statistics.avgWinValueInfo}
      accentColor="#389e0d"
      totalLabel={t.statistics.avgWinValueLabel}
      avgLabel={t.statistics.avgWinValueLabel}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.avgWinValue}
      getAvg={(item: RankingEntry) => item.avgWinValue}
      averageOnly
    />
  );
}
