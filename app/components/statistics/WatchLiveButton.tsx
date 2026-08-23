import { useState } from "react";
import { Button, Tooltip, message } from "antd";
import { EyeOutlined, LoadingOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { useTelemetry } from "../../contexts/TelemetryContext";
import { basePath } from "../../utils/basePath";

interface WatchLiveButtonProps {
  watchId: string;
  leagueSlug?: string;
  size?: "small" | "middle" | "large";
}

function liveErrorMessage(error?: string): string {
  switch (error) {
    case "game_disabled":
      return "Live viewing is disabled";
    case "relay_not_configured":
      return "Live viewing is not configured";
    case "relay_unauthorized":
      return "The live-view server rejected its credentials";
    case "relay_endpoint_not_found":
      return "The live-view server does not support relays";
    case "relay_unreachable":
      return "The live-view server is unreachable";
    case "game_server_disabled":
      return "Live viewing is disabled on the game server";
    case "relay_capacity":
      return "The live-view server is at capacity";
    case "relay_invalid_request":
      return "The live-view server rejected this game identifier";
    default:
      return "Live viewing is currently unavailable";
  }
}

/**
 * Verifies that a live spectator relay can start, then opens the canonical
 * watch-id URL. Sibling of `WatchReplayButton` for finished games.
 */
export function WatchLiveButton({
  watchId,
  leagueSlug,
  size = "small",
}: WatchLiveButtonProps) {
  const navigate = useNavigate();
  const { track } = useTelemetry();
  const [loading, setLoading] = useState(false);

  const startWatching = async (): Promise<void> => {
    if (loading) {
      return;
    }
    track("spectate_watch_click", { watchId });
    setLoading(true);
    const formData = new FormData();
    formData.set("watchId", watchId);
    const returnTo = leagueSlug
      ? `/online-tournaments/${encodeURIComponent(leagueSlug)}/statistics`
      : "/";
    const livePath = `/watch/live/${encodeURIComponent(
      watchId
    )}?returnTo=${encodeURIComponent(returnTo)}`;
    try {
      const response = await fetch(`${basePath}/api/game/watch`, {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as {
        ok: boolean;
        matchId?: string;
        error?: string;
      };
      if (response.status === 401 || response.status === 403) {
        void navigate(livePath);
        return;
      }
      if (response.ok && data.ok) {
        void navigate(livePath);
        return;
      }
      message.error(liveErrorMessage(data.error));
    } catch {
      message.error("Live viewing is currently unavailable");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tooltip title="Watch live">
      <Button
        type="primary"
        size={size}
        icon={loading ? <LoadingOutlined /> : <EyeOutlined />}
        disabled={loading}
        onClick={() => void startWatching()}
      >
        Live
      </Button>
    </Tooltip>
  );
}
