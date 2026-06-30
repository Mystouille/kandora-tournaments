import { SplitCellsOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface CallsRankingCardProps {
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

export default function CallsRankingCard(props: CallsRankingCardProps) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<SplitCellsOutlined style={{ fontSize: 20, color: "#1890ff" }} />}
      title={t.statistics.callsRankingTitle}
      infoTooltip={t.statistics.callsInfo}
      accentColor="#1890ff"
      totalLabel={t.statistics.total}
      avgLabel={t.statistics.avgCallsPerHand}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.totalCalls}
      getAvg={(item: RankingEntry) => item.avgCallsPerRound}
    />
  );
}
