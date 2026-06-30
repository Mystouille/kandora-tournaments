import { ThunderboltOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface TsumoRateRankingCardProps {
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

export default function TsumoRateRankingCard(props: TsumoRateRankingCardProps) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<ThunderboltOutlined style={{ fontSize: 20, color: "#f5222d" }} />}
      title={t.statistics.tsumoRateRankingTitle}
      infoTooltip={t.statistics.tsumoRateInfo}
      accentColor="#f5222d"
      totalLabel={t.statistics.total}
      avgLabel={t.statistics.tsumoRateLabel}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.totalTsumo}
      getAvg={(item: RankingEntry) => item.tsumoRate}
    />
  );
}
