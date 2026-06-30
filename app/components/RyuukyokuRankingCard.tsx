import { PauseCircleOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface RyuukyokuRankingCardProps {
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

export default function RyuukyokuRankingCard(props: RyuukyokuRankingCardProps) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<PauseCircleOutlined style={{ fontSize: 20, color: "#13c2c2" }} />}
      title={t.statistics.ryuukyokuRankingTitle}
      infoTooltip={t.statistics.ryuukyokuInfo}
      accentColor="#13c2c2"
      totalLabel={t.statistics.total}
      avgLabel={t.statistics.avgPerDraw}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.totalRyuukyoku}
      getAvg={(item: RankingEntry) => item.avgRyuukyokuPerDraw}
    />
  );
}
