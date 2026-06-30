import { StarOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface FuRankingCardProps {
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

export default function FuRankingCard(props: FuRankingCardProps) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<StarOutlined style={{ fontSize: 20, color: "#722ed1" }} />}
      title={t.statistics.fuRankingTitle}
      infoTooltip={t.statistics.fuInfo}
      accentColor="#722ed1"
      totalLabel=""
      avgLabel={t.statistics.avgPerRoundWon}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.avgFuPerRoundWon}
      getAvg={(item: RankingEntry) => item.avgFuPerRoundWon}
      averageOnly
    />
  );
}
