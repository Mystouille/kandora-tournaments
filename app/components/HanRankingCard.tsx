import { StarOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface HanRankingCardProps {
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

export default function HanRankingCard(props: HanRankingCardProps) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<StarOutlined style={{ fontSize: 20, color: "#eb2f96" }} />}
      title={t.statistics.hanRankingTitle}
      infoTooltip={t.statistics.hanInfo}
      accentColor="#eb2f96"
      totalLabel=""
      avgLabel={t.statistics.avgPerRoundWon}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.avgHanPerRoundWon}
      getAvg={(item: RankingEntry) => item.avgHanPerRoundWon}
      averageOnly
    />
  );
}
