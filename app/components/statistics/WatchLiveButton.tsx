import { useEffect, useState } from "react";
import { Button, Tooltip, message } from "antd";
import { EyeOutlined, LoadingOutlined } from "@ant-design/icons";
import { useFetcher, useNavigate } from "react-router";
import { useTelemetry } from "../../contexts/TelemetryContext";

interface WatchLiveButtonProps {
  watchId: string;
  /** Set when a relay is already running — skips the start round-trip. */
  matchId?: string | null;
  size?: "small" | "middle" | "large";
}

/**
 * Starts (or reuses) a live spectator relay for an ongoing game via
 * `/api/game/watch`, then navigates to `/spectate/:matchId`. Sibling of
 * `WatchReplayButton` (which opens finished-game replays).
 */
export function WatchLiveButton({
  watchId,
  matchId,
  size = "small",
}: WatchLiveButtonProps) {
  const fetcher = useFetcher<{
    ok: boolean;
    matchId?: string;
    error?: string;
  }>();
  const navigate = useNavigate();
  const { track } = useTelemetry();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) {
      return;
    }
    const data = fetcher.data;
    if (data.ok && data.matchId) {
      void navigate(`/spectate/${data.matchId}`);
    } else {
      message.error(
        data.error ? `Live unavailable (${data.error})` : "Live unavailable"
      );
      setLoading(false);
    }
  }, [fetcher.state, fetcher.data, navigate]);

  return (
    <Tooltip title="Watch live">
      <Button
        type="primary"
        size={size}
        icon={loading ? <LoadingOutlined /> : <EyeOutlined />}
        disabled={loading}
        onClick={() => {
          if (loading) {
            return;
          }
          track("spectate_watch_click", { watchId });
          if (matchId) {
            void navigate(`/spectate/${matchId}`);
            return;
          }
          setLoading(true);
          const fd = new FormData();
          fd.set("watchId", watchId);
          fetcher.submit(fd, { method: "post", action: "/api/game/watch" });
        }}
      >
        Live
      </Button>
    </Tooltip>
  );
}
