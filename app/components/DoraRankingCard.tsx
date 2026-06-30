import { FireOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface DoraRankingCardProps {
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

export default function DoraRankingCard(props: DoraRankingCardProps) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<FireOutlined style={{ fontSize: 20, color: "#fa8c16" }} />}
      title={t.statistics.doraRankingTitle}
      infoTooltip={t.statistics.doraInfo}
      accentColor="#fa8c16"
      totalLabel={t.statistics.totalDora}
      avgLabel={t.statistics.avgPerRoundWon}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.totalDora}
      getAvg={(item: RankingEntry) => item.avgDoraPerRoundWon}
    />
  );
}
