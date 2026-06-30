import { useMemo } from "react";
import {
  Button,
  Dropdown,
  InputNumber,
  Select,
  Spin,
  Switch,
  Typography,
} from "antd";
import {
  CloseOutlined,
  EyeInvisibleOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useLocale } from "../../contexts/LocaleContext";
import { useCardGrid } from "./useCardGrid";
import type { RankingEntry } from "../StatRankingCard";

import DoraRankingCard from "../DoraRankingCard";
import UraDoraRankingCard from "../UraDoraRankingCard";
import HanRankingCard from "../HanRankingCard";
import FuRankingCard from "../FuRankingCard";
import RyuukyokuRankingCard from "../RyuukyokuRankingCard";
import CallRateRankingCard from "../CallRateRankingCard";
import CallsRankingCard from "../CallsRankingCard";
import TenpaiTurnRankingCard from "../TenpaiTurnRankingCard";
import WinRateRankingCard from "../WinRateRankingCard";
import TsumoRateRankingCard from "../TsumoRateRankingCard";
import DealInRateRankingCard from "../DealInRateRankingCard";
import AvgDealInValueRankingCard from "../AvgDealInValueRankingCard";
import AvgWinValueRankingCard from "../AvgWinValueRankingCard";

const { Text } = Typography;

// Map card IDs to their component
const CARD_COMPONENTS: Record<string, React.ComponentType<any>> = {
  dora: DoraRankingCard,
  uraDora: UraDoraRankingCard,
  han: HanRankingCard,
  fu: FuRankingCard,
  ryuukyoku: RyuukyokuRankingCard,
  callRate: CallRateRankingCard,
  calls: CallsRankingCard,
  tenpaiTurn: TenpaiTurnRankingCard,
  winRate: WinRateRankingCard,
  tsumoRate: TsumoRateRankingCard,
  dealInRate: DealInRateRankingCard,
  avgDealInValue: AvgDealInValueRankingCard,
  avgWinValue: AvgWinValueRankingCard,
};

export interface PinOption {
  label: any;
  value?: string;
  searchLabel?: string;
  options?: PinOption[];
}

export interface RankingTabProps {
  /** Unique localStorage keys for card order/hidden */
  localStorageOrderKey: string;
  localStorageHiddenKey: string;
  /** Default card order for this tab */
  defaultOrder: string[];
  /** Labels for cards (card id → display name) */
  cardLabels: Record<string, string>;

  /** Filter params passed to each card */
  leagueIds: string[];
  filterMode: "teams" | "players";
  effectivePlayerIds: string[];
  selectedTeams: string[];
  rankingStartDate: string | null;
  rankingEndDate: string | null;

  /** Shared ranking controls */
  minGames: number;
  onMinGamesChange: (v: number) => void;
  invertRanking: boolean;
  onInvertRankingChange: (v: boolean) => void;

  /** Pin player/team */
  isPlayerMode: boolean;
  pinnedPlayerId: string | null;
  onPinnedPlayerChange: (v: string | null) => void;
  pinnedTeamId: string | null;
  onPinnedTeamChange: (v: string | null) => void;
  pinPlayerOptions: PinOption[];
  pinTeamOptions: PinOption[];

  /** Shared ranking data from parent */
  rankingsData: RankingEntry[] | null;
  rankingsLoading: boolean;
  rankingsError: string | null;
  effectivePinnedId: string | null;
}

export default function RankingTab({
  localStorageOrderKey,
  localStorageHiddenKey,
  defaultOrder,
  cardLabels,
  leagueIds,
  filterMode,
  effectivePlayerIds,
  selectedTeams,
  rankingStartDate,
  rankingEndDate,
  minGames,
  onMinGamesChange,
  invertRanking,
  onInvertRankingChange,
  isPlayerMode,
  pinnedPlayerId,
  onPinnedPlayerChange,
  pinnedTeamId,
  onPinnedTeamChange,
  pinPlayerOptions,
  pinTeamOptions,
  rankingsData,
  rankingsLoading,
  rankingsError,
  effectivePinnedId,
}: RankingTabProps) {
  const { t } = useLocale();

  const {
    cardOrder,
    hiddenCards,
    visibleCards,
    cardElRefs,
    dropIndicator,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleHideCard,
    handleShowCard,
    handleResetLayout,
  } = useCardGrid({
    localStorageOrderKey,
    localStorageHiddenKey,
    defaultOrder,
  });

  const isLayoutModified = useMemo(
    () =>
      hiddenCards.size > 0 ||
      cardOrder.length !== defaultOrder.length ||
      cardOrder.some((id, i) => id !== defaultOrder[i]),
    [hiddenCards, cardOrder, defaultOrder]
  );

  return (
    <Spin spinning={rankingsLoading} size="large">
      <div style={{ padding: "24px 0", minHeight: 200 }}>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <Text>{t.statistics.minGamesPlayed}:</Text>
          <InputNumber
            min={0}
            value={minGames}
            onChange={(v) => onMinGamesChange(v ?? 0)}
            style={{ width: 80 }}
          />
          <div
            style={{
              marginLeft: 16,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Text>{t.statistics.topRanking}</Text>
            <Switch
              size="small"
              checked={invertRanking}
              onChange={onInvertRankingChange}
            />
            <Text>{t.statistics.bottomRanking}</Text>
          </div>
          {isPlayerMode ? (
            <Select
              placeholder={t.statistics.pinPlayer}
              allowClear
              showSearch
              optionFilterProp="searchLabel"
              style={{ minWidth: 200, marginLeft: 16 }}
              value={pinnedPlayerId}
              onChange={onPinnedPlayerChange}
              options={pinPlayerOptions}
              size="small"
              suffixIcon={null}
            />
          ) : (
            <Select
              placeholder={t.statistics.pinTeam}
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ minWidth: 200, marginLeft: 16 }}
              value={pinnedTeamId}
              onChange={onPinnedTeamChange}
              options={pinTeamOptions}
              size="small"
              suffixIcon={null}
            />
          )}
          {isLayoutModified && (
            <Button
              size="small"
              icon={<UndoOutlined />}
              onClick={handleResetLayout}
              style={{ marginLeft: 16 }}
            >
              {t.statistics.resetLayout}
            </Button>
          )}
          {hiddenCards.size > 0 && (
            <Dropdown
              menu={{
                items: [...hiddenCards].map((cardId) => ({
                  key: cardId,
                  label: (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        minWidth: 160,
                      }}
                    >
                      <span>{cardLabels[cardId] ?? cardId}</span>
                      <CloseOutlined
                        style={{ fontSize: 12, color: "#999" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShowCard(cardId);
                        }}
                      />
                    </div>
                  ),
                })),
              }}
              trigger={["click"]}
            >
              <Button
                size="small"
                icon={<EyeInvisibleOutlined />}
                style={{ marginLeft: 8 }}
              >
                {t.statistics.hiddenCards} ({hiddenCards.size})
              </Button>
            </Dropdown>
          )}
        </div>

        {/* Card grid */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 24,
          }}
        >
          {visibleCards.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                width: "100%",
                padding: "40px 0",
              }}
            >
              <Text type="secondary">{t.statistics.noCardsYet}</Text>
            </div>
          ) : (
            visibleCards.map((cardId) => {
              const CardComponent = CARD_COMPONENTS[cardId];
              if (!CardComponent) {
                return null;
              }
              return (
                <div
                  key={cardId}
                  ref={(el) => {
                    cardElRefs.current[cardId] = el;
                  }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, cardId)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, cardId)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, cardId)}
                  style={{
                    position: "relative",
                    width: "100%",
                    maxWidth: 320,
                    cursor: "grab",
                  }}
                >
                  {/* Left insertion indicator */}
                  {dropIndicator?.cardId === cardId &&
                    dropIndicator.side === "left" && (
                      <div
                        style={{
                          position: "absolute",
                          left: -13,
                          top: 0,
                          bottom: 0,
                          width: 3,
                          borderRadius: 2,
                          background: "#1677ff",
                          pointerEvents: "none",
                          zIndex: 1,
                        }}
                      />
                    )}
                  {/* Right insertion indicator */}
                  {dropIndicator?.cardId === cardId &&
                    dropIndicator.side === "right" && (
                      <div
                        style={{
                          position: "absolute",
                          right: -13,
                          top: 0,
                          bottom: 0,
                          width: 3,
                          borderRadius: 2,
                          background: "#1677ff",
                          pointerEvents: "none",
                          zIndex: 1,
                        }}
                      />
                    )}
                  <CardComponent
                    cardId={cardId}
                    leagueIds={leagueIds}
                    playerIds={
                      filterMode === "players" ? effectivePlayerIds : []
                    }
                    teamIds={filterMode === "teams" ? selectedTeams : []}
                    startDate={rankingStartDate}
                    endDate={rankingEndDate}
                    minGames={minGames}
                    invertRanking={invertRanking}
                    rankingsData={rankingsData}
                    rankingsLoading={rankingsLoading}
                    rankingsError={rankingsError}
                    pinnedPlayerId={effectivePinnedId}
                    onHide={() => handleHideCard(cardId)}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </Spin>
  );
}
