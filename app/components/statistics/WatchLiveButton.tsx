import { useState } from "react";
import { Button, Tooltip, message } from "antd";
import { EyeOutlined, LoadingOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { useTelemetry } from "../../contexts/TelemetryContext";
import { basePath } from "../../utils/basePath";

interface WatchLiveButtonProps {
  watchId: string;
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
 * Starts (or reuses) a live spectator relay for an ongoing game via
 * `/api/game/watch`, then navigates to `/spectate/:matchId`. Sibling of
 * `WatchReplayButton` (which opens finished-game replays).
 */
export function WatchLiveButton({
  watchId,
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
      if (response.ok && data.ok && data.matchId) {
        void navigate(`/spectate/${data.matchId}`);
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
