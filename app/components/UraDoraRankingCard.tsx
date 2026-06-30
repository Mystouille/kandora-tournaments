import { EyeOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import StatRankingCard from "./StatRankingCard";
import type { RankingEntry } from "./StatRankingCard";

interface UraDoraRankingCardProps {
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
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onHide?: () => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  pinnedPlayerId?: string | null;
}

export default function UraDoraRankingCard(props: UraDoraRankingCardProps) {
  const { t } = useLocale();

  return (
    <StatRankingCard
      {...props}
      icon={<EyeOutlined style={{ fontSize: 20, color: "#722ed1" }} />}
      title={t.statistics.uraDoraRankingTitle}
      infoTooltip={t.statistics.uraDoraInfo}
      accentColor="#722ed1"
      totalLabel={t.statistics.totalUraDora}
      avgLabel={t.statistics.avgPerRiichiWin}
      noDataLabel={t.statistics.noDoraData}
      getTotal={(item: RankingEntry) => item.totalUraDora}
      getAvg={(item: RankingEntry) => item.avgUraDoraPerRoundWon}
    />
  );
}
