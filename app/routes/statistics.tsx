import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, Typography } from "antd";
import {
  LineChartOutlined,
  TrophyOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  TableOutlined,
  OrderedListOutlined,
  ApartmentOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import { HighlightProvider } from "../contexts/HighlightContext";
import GraphsTab from "../components/statistics/GraphsTab";
import RankingTab from "../components/statistics/RankingTab";
import GamesTab from "../components/statistics/GamesTab";
import PlayerStandingTab from "../components/statistics/PlayerStandingTab";
import YakuMapTab from "../components/statistics/YakuMapTab";
import BracketTab from "../components/statistics/BracketTab";
import type { BracketPhase } from "../components/statistics/BracketTab";
import type { TeamOption } from "../components/statistics/types";
import FilterBanner from "../components/statistics/FilterBanner";
import { useStatisticsFilters } from "../components/statistics/useStatisticsFilters";
import { useGroupedPlayerOptions } from "../components/statistics/useGroupedPlayerOptions";
import {
  DEFAULT_CARD_ORDER,
  MORE_DEFAULT_CARD_ORDER,
  getCardLabels,
  getMoreCardLabels,
  LS_ORDER_KEY,
  LS_HIDDEN_KEY,
  LS_MORE_ORDER_KEY,
  LS_MORE_HIDDEN_KEY,
} from "../components/statistics/cardConfig";
import type { RankingEntry } from "../components/StatRankingCard";
const { Text } = Typography;

export function meta() {
  return [
    { title: "Statistics - TNT Paris Mahjong" },
    {
      name: "description",
      content: "Player and game statistics",
    },
  ];
}

export default function Statistics({
  leagueSlug,
}: { leagueSlug?: string } = {}) {
  const { t } = useLocale();

  const filters = useStatisticsFilters(leagueSlug);
  const {
    selectedLeagueData,
    teams,
    users,
    eliminatedTeams,
    loading,
    filteredTeams,
    filterMode,
    phaseFilter,
    setPhaseFilter,
    selectedLeague,
    selectedTeams,
    setSelectedTeams,
    selectedPlayers,
    setSelectedPlayers,
    dateRange,
    setDateRange,
    minGames,
    setMinGames,
    invertRanking,
    setInvertRanking,
    activeTab,
    setActiveTab,
    pinnedPlayerId,
    setPinnedPlayerId,
    pinnedTeamId,
    setPinnedTeamId,
    minDate,
    maxDate,
    isPlayerMode,
    effectivePinnedId,
    handleFilterModeChange,
  } = filters;

  const {
    playerOptions,
    pinPlayerOptions,
    allPlayersSelected,
    handleToggleSelectAllPlayers,
  } = useGroupedPlayerOptions(
    users,
    teams,
    selectedLeague,
    selectedPlayers,
    setSelectedPlayers
  );

  // Card config (labels depend on locale)
  const CARD_LABELS = getCardLabels(t);
  const MORE_CARD_LABELS = getMoreCardLabels(t);

  // Build pin team options from filtered teams
  const pinTeamOptions = useMemo(
    () =>
      filteredTeams.map((team) => ({
        label: team.displayName,
        value: team._id,
      })),
    [filteredTeams]
  );

  // Derived query params
  const leagueIds = useMemo(
    () => (selectedLeague ? [selectedLeague] : []),
    [selectedLeague]
  );

  // Resolved cutoff for the selected league (when it has a finals boundary)
  const selectedLeagueCutoff = useMemo(
    () => selectedLeagueData?.phaseCutoffTimes?.[0] ?? null,
    [selectedLeagueData]
  );

  // Resolved multi-phase cutoffs for the selected league
  const selectedLeaguePhaseCutoffs = useMemo(
    () => selectedLeagueData?.phaseCutoffTimes ?? [],
    [selectedLeagueData]
  );

  // Phase-aware start/end: override user date range with cutoff boundaries
  // Date range values are converted to UTC day boundaries so the filter
  // is consistent regardless of the user's browser timezone.
  const phaseStartDate = useMemo(() => {
    if (
      selectedLeaguePhaseCutoffs.length > 0 &&
      phaseFilter.startsWith("phase")
    ) {
      const idx = parseInt(phaseFilter.replace("phase", ""), 10);
      if (idx > 0 && idx <= selectedLeaguePhaseCutoffs.length) {
        return new Date(selectedLeaguePhaseCutoffs[idx - 1]).toISOString();
      }
      return dateRange[0]
        ? new Date(
            Date.UTC(
              dateRange[0].year(),
              dateRange[0].month(),
              dateRange[0].date()
            )
          ).toISOString()
        : null;
    }
    return dateRange[0]
      ? new Date(
          Date.UTC(
            dateRange[0].year(),
            dateRange[0].month(),
            dateRange[0].date()
          )
        ).toISOString()
      : null;
  }, [selectedLeaguePhaseCutoffs, phaseFilter, dateRange[0]?.valueOf()]);

  const phaseEndDate = useMemo(() => {
    if (
      selectedLeaguePhaseCutoffs.length > 0 &&
      phaseFilter.startsWith("phase")
    ) {
      const idx = parseInt(phaseFilter.replace("phase", ""), 10);
      if (idx < selectedLeaguePhaseCutoffs.length) {
        return new Date(
          new Date(selectedLeaguePhaseCutoffs[idx]).getTime() - 1
        ).toISOString();
      }
      return dateRange[1]
        ? new Date(
            Date.UTC(
              dateRange[1].year(),
              dateRange[1].month(),
              dateRange[1].date(),
              23,
              59,
              59,
              999
            )
          ).toISOString()
        : null;
    }
    return dateRange[1]
      ? new Date(
          Date.UTC(
            dateRange[1].year(),
            dateRange[1].month(),
            dateRange[1].date(),
            23,
            59,
            59,
            999
          )
        ).toISOString()
      : null;
  }, [selectedLeaguePhaseCutoffs, phaseFilter, dateRange[1]?.valueOf()]);

  const rankingStartDate = phaseStartDate;
  const rankingEndDate = phaseEndDate;

  const chartEntityType: "player" | "team" =
    filterMode === "teams" ? "team" : "player";
  const chartEntityIds = useMemo(
    () => (filterMode === "players" ? selectedPlayers : selectedTeams),
    [filterMode, selectedPlayers, selectedTeams]
  );

  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Resolve highlighted player IDs for the Games tab
  const highlightedPlayerIds = useMemo(() => {
    if (filterMode === "players") {
      return new Set(selectedPlayers);
    }
    // Team mode: collect all members of selected teams
    const memberIds = new Set<string>();
    const effectiveTeams =
      selectedTeams.length > 0
        ? selectedTeams
        : filteredTeams.map((t) => t._id);
    for (const teamId of effectiveTeams) {
      const team = teams.find((t) => t._id === teamId);
      if (team) {
        for (const memberId of team.roster.members) {
          memberIds.add(memberId);
        }
        for (const memberId of team.roster.substitutes ?? []) {
          memberIds.add(memberId);
        }
      }
    }
    return memberIds;
  }, [filterMode, selectedPlayers, selectedTeams, filteredTeams, teams]);

  // Build ranking query params
  const rankingQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (leagueIds.length > 0) {
      params.set("leagueIds", leagueIds.join(","));
    }
    params.set("entityType", filterMode === "teams" ? "team" : "player");
    const entityIds =
      filterMode === "players" ? selectedPlayers : selectedTeams;
    if (entityIds.length > 0) {
      params.set("entityIds", entityIds.join(","));
    }
    if (rankingStartDate) {
      params.set("startDate", rankingStartDate);
    }
    if (rankingEndDate) {
      params.set("endDate", rankingEndDate);
    }
    if (selectedLeagueCutoff && phaseFilter !== "both") {
      params.set("phaseFilter", phaseFilter);
      params.set("finalsCutoffTime", selectedLeagueCutoff);
    }
    return params.toString();
  }, [
    selectedLeague,
    filterMode,
    selectedPlayers.join(","),
    selectedTeams.join(","),
    rankingStartDate,
    rankingEndDate,
    phaseFilter,
    selectedLeagueCutoff,
  ]);

  const {
    data: rankingsQueryData,
    isLoading: rankingsLoading,
    error: rankingsQueryError,
  } = useQuery({
    queryKey: ["ranking-data", rankingQueryParams],
    queryFn: async () => {
      const res = await fetch(
        `${basePath}/api/ranking-data?${rankingQueryParams}`
      );
      if (!res.ok) {
        throw new Error("Failed to fetch");
      }
      const data = await res.json();
      return (data.rankings ?? []) as RankingEntry[];
    },
  });

  const rankingsData = rankingsQueryData ?? null;
  const rankingsError = rankingsQueryError
    ? t.statistics.errorLoadingChart
    : null;

  // ---- Bracket tab visibility ----
  const showBracketTab = !!selectedLeagueData?.hasFinalPhase;
  const showGraphsTab = selectedLeagueData?.hasRegularPhase !== false;

  // ---- Eliminated entity IDs for the selected league ----
  const eliminatedEntityIds = eliminatedTeams;

  // ---- Fetch bracket scores ----
  const { data: bracketScoresData, isLoading: bracketScoresLoading } = useQuery(
    {
      queryKey: ["bracket-scores", selectedLeague],
      queryFn: async () => {
        const res = await fetch(
          `${basePath}/api/bracket-scores?leagueId=${selectedLeague}`
        );
        if (!res.ok) {
          throw new Error("Failed to fetch bracket scores");
        }
        return res.json() as Promise<{
          phases: Record<
            string,
            {
              groupIndex: number;
              stageOrder: number;
              advancingCount: number;
              sources: string[];
              gamesPlayed: number;
              totalGames: number;
              teamScores: Record<string, number>;
              slots?: {
                teamId: string | null;
                description: string;
                score: number | null;
              }[];
              games: {
                gameId: string | null;
                startTime: string;
                replayUrl: string | null;
                players: {
                  teamId: string;
                  teamName: string;
                  playerName: string;
                  platformName: string | null;
                  avatarUrl: string | null;
                  leaguePicture: import("../types/pictures").PicturePair | null;
                  score: number;
                  delta: number;
                  place: number;
                  isSub: boolean;
                }[];
              }[];
              plannedGames?: {
                roundIndex: number;
                players: {
                  teamId: string | null;
                  teamName: string;
                  playerName: string;
                  platformName: string | null;
                  avatarUrl: string | null;
                  leaguePicture: import("../types/pictures").PicturePair | null;
                }[];
              }[];
            }
          >;
        }>;
      },
      enabled: showBracketTab && !!selectedLeague,
      staleTime: 30 * 1000,
      refetchInterval: 60 * 1000,
    }
  );

  const enrichedBracketPhases: BracketPhase[] = useMemo(() => {
    if (!showBracketTab || !selectedLeague || !bracketScoresData?.phases) {
      return [];
    }

    const participantById = new Map<string, TeamOption>();
    for (const team of filteredTeams) {
      participantById.set(team._id, team);
    }

    const phaseValues = Object.values(bracketScoresData.phases);
    for (const phaseData of phaseValues) {
      for (const game of phaseData.games ?? []) {
        for (const player of game.players ?? []) {
          if (!participantById.has(player.teamId)) {
            participantById.set(player.teamId, {
              _id: player.teamId,
              displayName: player.teamName,
              simpleName: player.teamName,
              leagueId: selectedLeague,
              pictures: null,
              roster: { members: [], substitutes: [] },
            });
          }
        }
      }
    }

    const entries = Object.entries(bracketScoresData.phases);
    return entries.map(([phaseKey, phaseData]) => {
      const derivedSlots = Object.entries(phaseData.teamScores)
        .map(([participantId, score]) => {
          const participant = participantById.get(participantId) ?? {
            _id: participantId,
            displayName: participantId,
            simpleName: participantId,
            leagueId: selectedLeague,
            pictures: null,
            roster: { members: [], substitutes: [] },
          };
          return {
            team: participant,
            description: participant.displayName,
            score,
          };
        })
        .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

      const slots = (phaseData.slots ?? []).map((slot) => {
        if (!slot.teamId) {
          return {
            team: null,
            description: slot.description,
            score: slot.score,
          };
        }

        const participant = participantById.get(slot.teamId) ?? {
          _id: slot.teamId,
          displayName: slot.description,
          simpleName: slot.description,
          leagueId: selectedLeague,
          pictures: null,
          roster: { members: [], substitutes: [] },
        };

        return {
          team: participant,
          description: participant.displayName,
          score: slot.score,
        };
      });

      const sortedSlots =
        slots.length > 0
          ? [...slots].sort(
              (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)
            )
          : derivedSlots;

      const isComplete = phaseData.gamesPlayed >= phaseData.totalGames;
      const phaseTitle = t.statistics.bracketPhaseLabels[phaseKey] ?? phaseKey;
      return {
        key: phaseKey,
        title: phaseTitle,
        groupIndex: phaseData.groupIndex,
        stageOrder: phaseData.stageOrder,
        advancingCount: phaseData.advancingCount,
        sources: phaseData.sources ?? [],
        isComplete,
        gamesPlayed: phaseData.gamesPlayed,
        totalGames: phaseData.totalGames,
        games: phaseData.games ?? [],
        plannedGames: phaseData.plannedGames ?? [],
        slots: sortedSlots.map((slot, index) => ({
          ...slot,
          rank: isComplete ? index + 1 : null,
        })),
        // Stable order for the details popup columns (don't re-sort by score).
        columnSlots: (slots.length > 0 ? slots : derivedSlots).map((slot) => ({
          ...slot,
          rank: null,
        })),
      };
    });
  }, [showBracketTab, selectedLeague, bracketScoresData, filteredTeams]);

  // Shared ranking tab props
  const rankingTabProps = {
    leagueIds,
    filterMode,
    effectivePlayerIds: selectedPlayers,
    selectedTeams,
    rankingStartDate,
    rankingEndDate,
    minGames,
    onMinGamesChange: setMinGames,
    invertRanking,
    onInvertRankingChange: setInvertRanking,
    isPlayerMode,
    pinnedPlayerId,
    onPinnedPlayerChange: setPinnedPlayerId,
    pinnedTeamId,
    onPinnedTeamChange: setPinnedTeamId,
    pinPlayerOptions,
    pinTeamOptions,
    rankingsData,
    rankingsLoading,
    rankingsError,
    effectivePinnedId,
  };

  return (
    <HighlightProvider>
      <div style={{ width: "100%", minHeight: "100%" }}>
        <FilterBanner
          loading={loading}
          filteredTeams={filteredTeams}
          filterMode={filterMode}
          hasTeams={selectedLeagueData?.hasTeams !== false}
          phaseFilter={phaseFilter}
          phaseCutoffTimes={selectedLeaguePhaseCutoffs}
          selectedLeague={selectedLeague}
          selectedTeams={selectedTeams}
          selectedPlayers={selectedPlayers}
          dateRange={dateRange}
          minDate={minDate}
          maxDate={maxDate}
          playerOptions={playerOptions}
          allPlayersSelected={allPlayersSelected}
          onFilterModeChange={handleFilterModeChange}
          onPhaseFilterChange={setPhaseFilter}
          onTeamsChange={setSelectedTeams}
          onPlayersChange={setSelectedPlayers}
          onDateRangeChange={setDateRange}
          onToggleSelectAllPlayers={handleToggleSelectAllPlayers}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
        />

        {/* Content area */}
        <div>
          {!selectedLeague ? (
            <div style={{ textAlign: "center", padding: "80px 0" }}>
              <Text type="secondary" style={{ fontSize: "1.1rem" }}>
                {t.statistics.selectLeaguePrompt}
              </Text>
            </div>
          ) : (
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                ...(showBracketTab
                  ? [
                      {
                        key: "bracket",
                        label: (
                          <span>
                            <ApartmentOutlined style={{ marginRight: 6 }} />
                            {t.statistics.tabBracket}
                          </span>
                        ),
                        children: (
                          <BracketTab
                            phases={enrichedBracketPhases}
                            isLoading={bracketScoresLoading}
                          />
                        ),
                      },
                    ]
                  : []),
                ...(showGraphsTab
                  ? [
                      {
                        key: "graphs",
                        label: (
                          <span>
                            <LineChartOutlined style={{ marginRight: 6 }} />
                            {t.statistics.tabGraphs}
                          </span>
                        ),
                        children: (
                          <GraphsTab
                            leagueIds={leagueIds}
                            entityType={chartEntityType}
                            entityIds={chartEntityIds}
                            startDate={rankingStartDate}
                            endDate={rankingEndDate}
                            eliminatedEntityIds={eliminatedEntityIds}
                          />
                        ),
                      },
                    ]
                  : []),
                {
                  key: "standings",
                  label: (
                    <span>
                      <OrderedListOutlined style={{ marginRight: 6 }} />
                      {t.statistics.tabListing}
                    </span>
                  ),
                  children: (
                    <PlayerStandingTab
                      leagueIds={leagueIds}
                      entityType={chartEntityType}
                      entityIds={chartEntityIds}
                      startDate={rankingStartDate}
                      endDate={rankingEndDate}
                      pinPlayerOptions={pinPlayerOptions}
                      eliminatedEntityIds={eliminatedEntityIds}
                    />
                  ),
                },
                {
                  key: "rankings",
                  label: (
                    <span>
                      <TrophyOutlined style={{ marginRight: 6 }} />
                      {t.statistics.tabRankings}
                    </span>
                  ),
                  children: (
                    <RankingTab
                      localStorageOrderKey={LS_ORDER_KEY}
                      localStorageHiddenKey={LS_HIDDEN_KEY}
                      defaultOrder={[...DEFAULT_CARD_ORDER]}
                      cardLabels={CARD_LABELS}
                      {...rankingTabProps}
                    />
                  ),
                },
                {
                  key: "moreRankings",
                  label: (
                    <span>
                      <AppstoreOutlined style={{ marginRight: 6 }} />
                      {t.statistics.tabMoreRankings}
                    </span>
                  ),
                  children: (
                    <RankingTab
                      localStorageOrderKey={LS_MORE_ORDER_KEY}
                      localStorageHiddenKey={LS_MORE_HIDDEN_KEY}
                      defaultOrder={[...MORE_DEFAULT_CARD_ORDER]}
                      cardLabels={MORE_CARD_LABELS}
                      {...rankingTabProps}
                    />
                  ),
                },
                {
                  key: "games",
                  label: (
                    <span>
                      <UnorderedListOutlined style={{ marginRight: 6 }} />
                      {t.statistics.tabGames}
                    </span>
                  ),
                  children: (
                    <GamesTab
                      leagueIds={leagueIds}
                      entityType={chartEntityType}
                      entityIds={chartEntityIds}
                      startDate={rankingStartDate}
                      endDate={rankingEndDate}
                      highlightedPlayerIds={highlightedPlayerIds}
                      autoRefresh={autoRefresh}
                      teams={teams}
                    />
                  ),
                },
                {
                  key: "yakuMap",
                  label: (
                    <span>
                      <TableOutlined style={{ marginRight: 6 }} />
                      {t.statistics.tabYakuMap}
                    </span>
                  ),
                  children: (
                    <YakuMapTab
                      leagueIds={leagueIds}
                      entityType={chartEntityType}
                      entityIds={chartEntityIds}
                      startDate={rankingStartDate}
                      endDate={rankingEndDate}
                      autoRefresh={autoRefresh}
                      minGames={minGames}
                      onMinGamesChange={setMinGames}
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>
    </HighlightProvider>
  );
}
