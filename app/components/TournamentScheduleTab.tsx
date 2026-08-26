import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Collapse,
  Empty,
  Spin,
  Typography,
} from "antd";
import { useLocale } from "../contexts/LocaleContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { basePath } from "../utils/basePath";
import {
  buildSchedulePhaseGroups,
  partitionScheduledGames,
  TournamentScheduleGroups,
  type PublicScheduleData,
} from "./TournamentScheduleGroups";

const { Text } = Typography;
const REFRESH_INTERVAL_MS = 30_000;

export function TournamentScheduleTab({ leagueId }: { leagueId: string }) {
  const { t, locale } = useLocale();
  const isMobile = useIsMobile();
  const [data, setData] = useState<PublicScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const localeCode = locale === "fr" ? "fr-FR" : "en-US";

  useEffect(() => {
    let active = true;
    let inFlight = false;

    const load = async (initial: boolean) => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      if (initial) {
        setLoading(true);
      }
      try {
        const response = await fetch(
          `${basePath}/api/league-schedule?leagueId=${encodeURIComponent(leagueId)}`
        );
        if (!response.ok) {
          throw new Error("Failed to load schedule");
        }
        const schedule = (await response.json()) as PublicScheduleData;
        if (active) {
          setData(schedule);
          setError(false);
        }
      } catch {
        if (active) {
          setError(true);
        }
      } finally {
        if (active && initial) {
          setLoading(false);
        }
        inFlight = false;
      }
    };

    void load(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(false);
      }
    }, REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void load(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, [leagueId, reloadKey]);

  const { currentPhaseGroups, pastPhaseGroups, pastGameCount } = useMemo(() => {
    if (!data) {
      return {
        currentPhaseGroups: [],
        pastPhaseGroups: [],
        pastGameCount: 0,
      };
    }
    const partitioned = partitionScheduledGames(data.games);
    return {
      currentPhaseGroups: buildSchedulePhaseGroups(
        data.phases,
        partitioned.current
      ),
      pastPhaseGroups: buildSchedulePhaseGroups(data.phases, partitioned.past),
      pastGameCount: partitioned.past.length,
    };
  }, [data]);

  const scheduleLabels = {
    tournamentPhase: t.onlineTournaments.scheduleTournamentPhase,
    tbd: t.onlineTournaments.scheduleTbd,
    live: t.onlineTournaments.scheduleLive,
    watchLive: t.onlineTournaments.scheduleWatchLive,
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!data) {
    return (
      <Alert
        type="error"
        showIcon
        message={t.onlineTournaments.scheduleError}
        action={
          <Button size="small" onClick={() => setReloadKey((key) => key + 1)}>
            {t.onlineTournaments.scheduleRetry}
          </Button>
        }
      />
    );
  }

  return (
    <div>
      {error && (
        <Alert
          type="warning"
          showIcon
          message={t.onlineTournaments.scheduleRefreshError}
          style={{ marginBottom: 16 }}
          action={
            <Button
              size="small"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              {t.onlineTournaments.scheduleRetry}
            </Button>
          }
        />
      )}

      {currentPhaseGroups.length === 0 && pastPhaseGroups.length === 0 ? (
        <Empty description={t.onlineTournaments.scheduleEmpty} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {currentPhaseGroups.length > 0 && (
            <TournamentScheduleGroups
              groups={currentPhaseGroups}
              data={data}
              localeCode={localeCode}
              isMobile={isMobile}
              labels={scheduleLabels}
            />
          )}
          {pastGameCount > 0 && (
            <Collapse
              items={[
                {
                  key: "past-games",
                  label: (
                    <Text strong>
                      {t.onlineTournaments.schedulePastGames} ({pastGameCount})
                    </Text>
                  ),
                  children: (
                    <TournamentScheduleGroups
                      groups={pastPhaseGroups}
                      data={data}
                      localeCode={localeCode}
                      isMobile={isMobile}
                      labels={scheduleLabels}
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}