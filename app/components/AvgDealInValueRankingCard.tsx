import { FallOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface AvgDealInValueRankingCardProps {
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

export default function AvgDealInValueRankingCard(
  props: AvgDealInValueRankingCardProps
) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<FallOutlined style={{ fontSize: 20, color: "#cf1322" }} />}
      title={t.statistics.avgDealInValueRankingTitle}
      infoTooltip={t.statistics.avgDealInValueInfo}
      accentColor="#cf1322"
      totalLabel={t.statistics.avgDealInValueLabel}
      avgLabel={t.statistics.avgDealInValueLabel}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.avgDealInValue}
      getAvg={(item: RankingEntry) => item.avgDealInValue}
      averageOnly
      defaultInverted
    />
  );
}
