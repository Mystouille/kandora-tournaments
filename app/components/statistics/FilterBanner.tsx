import { useEffect, useMemo, useState } from "react";
import {
  DatePicker,
  Segmented,
  Select,
  Spin,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import { SyncOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { useLocale } from "../../contexts/LocaleContext";
import { useAppTheme } from "../../contexts/ThemeContext";
import type { PhaseFilter, TeamOption } from "./types";

const { Text } = Typography;
const { RangePicker } = DatePicker;

interface GroupedOption {
  label: any;
  options: { label: any; value: string; searchLabel: string }[];
}

interface FilterBannerProps {
  loading: boolean;
  filteredTeams: TeamOption[];
  filterMode: "teams" | "players";
  hasTeams: boolean;
  phaseFilter: PhaseFilter;
  phaseCutoffTimes: string[];
  selectedLeague: string | null;
  selectedTeams: string[];
  selectedPlayers: string[];
  dateRange: [Dayjs | null, Dayjs | null];
  minDate?: Dayjs;
  maxDate?: Dayjs;
  playerOptions: GroupedOption[];
  allPlayersSelected: boolean;
  onFilterModeChange: (value: "teams" | "players") => void;
  onPhaseFilterChange: (value: PhaseFilter) => void;
  onTeamsChange: (teams: string[]) => void;
  onPlayersChange: (players: string[]) => void;
  onDateRangeChange: (dates: [Dayjs | null, Dayjs | null]) => void;
  onToggleSelectAllPlayers: () => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (checked: boolean) => void;
}

export default function FilterBanner({
  loading,
  filteredTeams,
  filterMode,
  hasTeams,
  phaseFilter,
  phaseCutoffTimes,
  selectedLeague,
  selectedTeams,
  selectedPlayers,
  dateRange,
  minDate,
  maxDate,
  playerOptions,
  allPlayersSelected,
  onFilterModeChange,
  onPhaseFilterChange,
  onTeamsChange,
  onPlayersChange,
  onDateRangeChange,
  onToggleSelectAllPlayers,
  autoRefresh,
  onAutoRefreshChange,
}: FilterBannerProps) {
  const { t } = useLocale();
  const { isDark } = useAppTheme();

  const bannerBg = isDark
    ? "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)"
    : "linear-gradient(135deg, #f0f2f5 0%, #e6e9ef 100%)";

  const bannerBorder = isDark ? "1px solid #303030" : "1px solid #d9d9d9";

  const teamOptions = useMemo(
    () =>
      filteredTeams.map((team) => ({
        label: team.displayName,
        value: team._id,
      })),
    [filteredTeams]
  );

  return (
    <div
      style={{
        background: bannerBg,
        border: bannerBorder,
        borderRadius: 8,
        padding: "16px 24px",
        marginBottom: 24,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
      }}
    >
      {loading ? (
        <Spin size="small" />
      ) : (
        <>
          {/* Filter mode: Teams / Players (hidden for individual leagues) */}
          {hasTeams && (
            <Segmented
              value={filterMode}
              onChange={onFilterModeChange}
              disabled={!selectedLeague}
              options={[
                { label: t.statistics.filterTeams, value: "teams" },
                { label: t.statistics.filterPlayers, value: "players" },
              ]}
            />
          )}

          {/* Team filter (shown in teams mode) */}
          {filterMode === "teams" && (
            <Select
              mode="multiple"
              placeholder={t.statistics.selectTeam}
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ minWidth: 200 }}
              value={selectedTeams}
              onChange={onTeamsChange}
              disabled={!selectedLeague || filteredTeams.length === 0}
              options={teamOptions}
              notFoundContent={
                selectedLeague ? t.statistics.noTeamsInLeague : undefined
              }
              maxTagCount="responsive"
              suffixIcon={null}
            />
          )}

          {/* Player filter (shown in players mode) */}
          {filterMode === "players" && (
            <Select
              mode="multiple"
              placeholder={t.statistics.selectPlayer}
              allowClear
              showSearch
              optionFilterProp="searchLabel"
              style={{ minWidth: 220 }}
              value={selectedPlayers}
              onChange={onPlayersChange}
              disabled={!selectedLeague}
              options={playerOptions}
              maxTagCount="responsive"
              suffixIcon={null}
              dropdownRender={(menu) => (
                <>
                  <div
                    style={{
                      padding: "4px 12px",
                      cursor: "pointer",
                      color: isDark ? "#1890ff" : "#1677ff",
                      borderBottom: `1px solid ${isDark ? "#303030" : "#f0f0f0"}`,
                      userSelect: "none",
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelectAllPlayers();
                    }}
                  >
                    {allPlayersSelected
                      ? t.statistics.deselectAll
                      : t.statistics.selectAll}
                  </div>
                  {menu}
                </>
              )}
            />
          )}

          {/* Phase filter dropdown (for leagues with phaseCutoffTimes) */}
          {phaseCutoffTimes.length > 0 && (
            <Select
              disabled={!selectedLeague}
              value={phaseFilter}
              onChange={(v) => onPhaseFilterChange(v as PhaseFilter)}
              style={{ minWidth: 100 }}
              options={[
                { label: t.statistics.phaseFilterAll, value: "both" },
                ...Array.from(
                  { length: phaseCutoffTimes.length + 1 },
                  (_, i) => ({
                    label: `${t.statistics.phaseFilterPhaseN} ${i + 1}`,
                    value: `phase${i}`,
                  })
                ),
              ]}
            />
          )}

          {/* Date range filter */}
          <RangePicker
            placeholder={[t.statistics.startDate, t.statistics.endDate]}
            style={{ minWidth: 240 }}
            value={dateRange}
            onChange={(dates) =>
              onDateRangeChange(dates ? [dates[0], dates[1]] : [null, null])
            }
            disabled={!selectedLeague}
            minDate={minDate}
            maxDate={maxDate}
            allowClear
          />

          {/* Auto-refresh toggle */}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {autoRefresh && <Countdown key="countdown" seconds={60} />}
            <Tooltip title={t.statistics.autoRefresh}>
              <Switch
                checked={autoRefresh}
                onChange={onAutoRefreshChange}
                checkedChildren={<SyncOutlined spin />}
                unCheckedChildren={<SyncOutlined />}
              />
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          return seconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [seconds]);

  return (
    <Text type="secondary" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
      {remaining}s
    </Text>
  );
}
