import { ForkOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface CallRateRankingCardProps {
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

export default function CallRateRankingCard(props: CallRateRankingCardProps) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<ForkOutlined style={{ fontSize: 20, color: "#52c41a" }} />}
      title={t.statistics.callRateRankingTitle}
      infoTooltip={t.statistics.callRateInfo}
      accentColor="#52c41a"
      totalLabel={t.statistics.callRateLabel}
      avgLabel={t.statistics.callRateLabel}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.callRate}
      getAvg={(item: RankingEntry) => item.callRate}
      averageOnly
    />
  );
}
