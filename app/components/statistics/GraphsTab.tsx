import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { basePath } from "../../utils/basePath";
import ScoreBreakdownChart from "../ScoreBreakdownChart";
import ScoreEvolutionChart from "../ScoreEvolutionChart";
import type { Series } from "../ScoreEvolutionChart";

interface GraphsTabProps {
  leagueIds: string[];
  entityType: "player" | "team";
  entityIds: string[];
  startDate: string | null;
  endDate: string | null;
  eliminatedEntityIds?: string[];
}

export default function GraphsTab({
  leagueIds,
  entityType,
  entityIds,
  startDate,
  endDate,
  eliminatedEntityIds,
}: GraphsTabProps) {
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (leagueIds.length > 0) {
      params.set("leagueIds", leagueIds.join(","));
    }
    const idsParam = entityType === "player" ? "playerIds" : "teamIds";
    if (entityIds.length > 0) {
      params.set(idsParam, entityIds.join(","));
    }
    if (startDate) {
      params.set("startDate", startDate);
    }
    if (endDate) {
      params.set("endDate", endDate);
    }
    return params.toString();
  }, [leagueIds, entityType, entityIds, startDate, endDate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["score-evolution", queryParams],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/score-evolution?${queryParams}`);
      if (!res.ok) {
        throw new Error("Failed to fetch");
      }
      const json = await res.json();
      return (json.series ?? []) as Series[];
    },
    enabled: leagueIds.length > 0,
  });

  // Shared active day state for syncing bar chart <-> line charts
  const [activeDay, setActiveDay] = useState<string | null>(null);

  const seriesData = data ?? [];

  return (
    <div style={{ padding: "24px 0" }}>
      <ScoreBreakdownChart
        series={seriesData}
        activeDay={activeDay}
        onActiveDayChange={setActiveDay}
        eliminatedEntityIds={eliminatedEntityIds}
      />
      <ScoreEvolutionChart
        series={seriesData}
        loading={isLoading}
        error={error ? error.message : null}
        activeDay={activeDay}
        onSliceClick={setActiveDay}
        eliminatedEntityIds={eliminatedEntityIds}
      />
    </div>
  );
}
