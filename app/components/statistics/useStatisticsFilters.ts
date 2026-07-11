import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { basePath } from "../../utils/basePath";
import { useTelemetry } from "../../contexts/TelemetryContext";
import { LS_LEAGUE_FILTERS_KEY } from "./cardConfig";
import type {
  LeagueOption,
  TeamOption,
  UserOption,
  BracketData,
  PhaseFilter,
} from "./types";

/** Shape of the per-league filter state stored in localStorage */
interface LeagueFilterState {
  filterMode?: "teams" | "players";
  phaseFilter?: PhaseFilter;
  activeTab?: string;
  selectedTeams?: string[];
  selectedPlayers?: string[];
  dateRange?: [string | null, string | null];
  minGames?: number;
  invertRanking?: boolean;
  pinnedPlayerId?: string | null;
  pinnedTeamId?: string | null;
}

const FILTER_DEFAULTS: Required<LeagueFilterState> = {
  filterMode: "teams",
  phaseFilter: "both",
  activeTab: "graphs",
  selectedTeams: [],
  selectedPlayers: [],
  dateRange: [null, null],
  minGames: 6,
  invertRanking: false,
  pinnedPlayerId: null,
  pinnedTeamId: null,
};

function loadAllLeagueFilters(): Record<string, LeagueFilterState> {
  try {
    const raw = localStorage.getItem(LS_LEAGUE_FILTERS_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    /* empty */
  }
  return {};
}

function loadLeagueFilters(leagueId: string): Required<LeagueFilterState> {
  const all = loadAllLeagueFilters();
  const stored = all[leagueId] ?? {};
  return { ...FILTER_DEFAULTS, ...stored };
}

function saveLeagueFilters(leagueId: string, state: LeagueFilterState) {
  const all = loadAllLeagueFilters();
  all[leagueId] = { ...all[leagueId], ...state };
  localStorage.setItem(LS_LEAGUE_FILTERS_KEY, JSON.stringify(all));
}

export function useStatisticsFilters(initialLeagueSlug?: string) {
  // Guard: don't persist filter values until initial restoration is done
  const filtersRestoredRef = useRef(false);
  const { track } = useTelemetry();

  const [selectedLeagueData, setSelectedLeagueData] =
    useState<LeagueOption | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [brackets, setBrackets] = useState<BracketData[]>([]);
  const [eliminatedTeams, setEliminatedTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterMode, setFilterMode] = useState<"teams" | "players">("teams");
  const [phaseFilter, _setPhaseFilter] = useState<PhaseFilter>("both");

  // Wrap setPhaseFilter to track phase filter changes
  const setPhaseFilter = useCallback(
    (phase: PhaseFilter) => {
      _setPhaseFilter((prev) => {
        if (prev !== phase) {
          track("stats_phase_filter_change", { from: prev, to: phase });
        }
        return phase;
      });
    },
    [track]
  );
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([
    null,
    null,
  ]);
  const [minGames, setMinGames] = useState<number>(FILTER_DEFAULTS.minGames);
  const [invertRanking, setInvertRanking] = useState(
    FILTER_DEFAULTS.invertRanking
  );
  const [activeTab, _setActiveTab] = useState<string>(
    FILTER_DEFAULTS.activeTab
  );
  const [pinnedPlayerId, setPinnedPlayerId] = useState<string | null>(null);
  const [pinnedTeamId, setPinnedTeamId] = useState<string | null>(null);

  // Wrap setActiveTab to track tab changes
  const setActiveTab = useCallback(
    (tab: string) => {
      _setActiveTab((prev) => {
        if (prev !== tab) {
          track("stats_tab_change", { from: prev, to: tab });
        }
        return tab;
      });
    },
    [track]
  );

  // ---- Persist per-league filter state to localStorage ----
  useEffect(() => {
    if (!filtersRestoredRef.current || !selectedLeague) {
      return;
    }
    saveLeagueFilters(selectedLeague, {
      filterMode,
      phaseFilter,
      activeTab,
      selectedTeams,
      selectedPlayers,
      dateRange: [
        dateRange[0] ? dateRange[0].toISOString() : null,
        dateRange[1] ? dateRange[1].toISOString() : null,
      ],
      minGames,
      invertRanking,
      pinnedPlayerId,
      pinnedTeamId,
    });
  }, [
    selectedLeague,
    filterMode,
    phaseFilter,
    activeTab,
    selectedTeams,
    selectedPlayers,
    dateRange,
    minGames,
    invertRanking,
    pinnedPlayerId,
    pinnedTeamId,
  ]);

  // ---- Load filter data and select the league by slug ----

  useEffect(() => {
    if (!initialLeagueSlug) {
      setLoading(false);
      return;
    }

    fetch(
      `${basePath}/api/statistics-filters?leagueSlug=${encodeURIComponent(initialLeagueSlug)}`
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch");
        }
        return res.json();
      })
      .then((data) => {
        const leagueData: LeagueOption | null = data.league ?? null;
        setSelectedLeagueData(leagueData);
        setTeams(data.teams ?? []);
        setUsers(data.users ?? []);
        setPlayerIds(data.playerIds ?? []);
        setBrackets(data.brackets ?? []);
        setEliminatedTeams(data.eliminatedTeams ?? []);

        if (leagueData) {
          const chosenLeagueId = leagueData._id;
          setSelectedLeague(chosenLeagueId);

          // Restore per-league filter state
          const hasCutoff = (leagueData.phaseCutoffTimes ?? []).length > 0;
          const saved = loadLeagueFilters(chosenLeagueId);
          // Individual (non-team) leagues have no teams, so team mode would
          // show nothing — always use player mode for them, ignoring any
          // stale saved preference.
          setFilterMode(
            leagueData.hasTeams === false ? "players" : saved.filterMode
          );
          _setPhaseFilter(hasCutoff ? saved.phaseFilter : "both");

          let restoredTab = saved.activeTab;
          const hasBracket = !!leagueData.hasFinalPhase;
          const hasGraphs = leagueData.hasRegularPhase !== false;
          if (!hasBracket && restoredTab === "bracket") {
            restoredTab = "graphs";
          }
          // "Finals only" leagues (bracket tab but no graphs tab): default to
          // the bracket tab so it isn't hidden behind a missing graphs tab.
          if (hasBracket && !hasGraphs) {
            restoredTab = "bracket";
          }
          _setActiveTab(restoredTab);

          setSelectedTeams(saved.selectedTeams);
          setSelectedPlayers(saved.selectedPlayers);
          setDateRange([
            saved.dateRange[0] ? dayjs(saved.dateRange[0]) : null,
            saved.dateRange[1] ? dayjs(saved.dateRange[1]) : null,
          ]);
          setMinGames(saved.minGames);
          setInvertRanking(saved.invertRanking);
          setPinnedPlayerId(saved.pinnedPlayerId);
          setPinnedTeamId(saved.pinnedTeamId);
        }

        filtersRestoredRef.current = true;
      })
      .catch((err) => console.error("Failed to load filters:", err))
      .finally(() => setLoading(false));
  }, []);

  // ---- Derived values ----

  // All teams are already scoped to this league by the API
  const filteredTeams = teams;

  const filteredUsers = useMemo(() => {
    if (!selectedLeague) {
      return [];
    }
    const playerIdSet = new Set<string>(playerIds);
    return users.filter((user) => playerIdSet.has(user._id));
  }, [users, selectedLeague, playerIds]);

  useEffect(() => {
    if (!selectedLeague) {
      return;
    }

    const allowedPlayerIds = new Set(filteredUsers.map((user) => user._id));
    setSelectedPlayers((current) =>
      current.filter((playerId) => allowedPlayerIds.has(playerId))
    );
  }, [selectedLeague, filteredUsers]);

  // Compute min/max dates from the selected league
  const { minDate, maxDate } = useMemo(() => {
    if (!selectedLeagueData) {
      return { minDate: undefined, maxDate: undefined };
    }
    return {
      minDate: selectedLeagueData.earliestGameDate
        ? dayjs(selectedLeagueData.earliestGameDate)
        : undefined,
      maxDate: selectedLeagueData.latestGameDate
        ? dayjs(selectedLeagueData.latestGameDate)
        : undefined,
    };
  }, [selectedLeagueData]);

  // Handle filter mode change
  const handleFilterModeChange = (newMode: "teams" | "players") => {
    track("stats_filter_mode_change", { mode: newMode });
    setFilterMode(newMode);
    if (newMode === "players") {
      setSelectedTeams([]);
    } else {
      setSelectedPlayers([]);
    }
  };

  const isPlayerMode = filterMode === "players";
  const effectivePinnedId = isPlayerMode ? pinnedPlayerId : pinnedTeamId;

  return {
    // Data
    selectedLeagueData,
    teams,
    users: filteredUsers,
    brackets,
    eliminatedTeams,
    loading,
    filteredTeams,

    // Filter state
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

    // Derived
    minDate,
    maxDate,
    isPlayerMode,
    effectivePinnedId,

    // Handlers
    handleFilterModeChange,
  };
}
