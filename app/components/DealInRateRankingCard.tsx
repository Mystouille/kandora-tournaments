import { FrownOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface DealInRateRankingCardProps {
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

export default function DealInRateRankingCard(
  props: DealInRateRankingCardProps
) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<FrownOutlined style={{ fontSize: 20, color: "#f5222d" }} />}
      title={t.statistics.dealInRateRankingTitle}
      infoTooltip={t.statistics.dealInRateInfo}
      accentColor="#f5222d"
      totalLabel={t.statistics.total}
      avgLabel={t.statistics.dealInRateLabel}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.totalDealIn}
      getAvg={(item: RankingEntry) => item.dealInRate}
      defaultInverted
    />
  );
}
