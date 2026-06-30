import { AimOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface TenpaiTurnRankingCardProps {
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

export default function TenpaiTurnRankingCard(
  props: TenpaiTurnRankingCardProps
) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<AimOutlined style={{ fontSize: 20, color: "#eb2f96" }} />}
      title={t.statistics.tenpaiTurnRankingTitle}
      infoTooltip={t.statistics.tenpaiTurnInfo}
      accentColor="#eb2f96"
      totalLabel={t.statistics.avgTenpaiTurnLabel}
      avgLabel={t.statistics.avgTenpaiTurnLabel}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.avgTenpaiTurn}
      getAvg={(item: RankingEntry) => item.avgTenpaiTurn}
      averageOnly
      defaultInverted
    />
  );
}
