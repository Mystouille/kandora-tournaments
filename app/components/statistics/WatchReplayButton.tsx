import { useEffect, useState } from "react";
import { Button, Tooltip, message } from "antd";
import { EyeOutlined, LoadingOutlined } from "@ant-design/icons";
import { useFetcher, useNavigate } from "react-router";
import { useLocale } from "../../contexts/LocaleContext";

interface WatchReplayButtonProps {
  gameId: string;
  size?: "small" | "middle" | "large";
}

/**
 * Eye-icon button that imports a replay log on demand via the `/review`
 * action, then navigates to `/replays/:gameId`. Shared between the
 * BracketTab stage-details popup and the GamesTab list.
 */
export function WatchReplayButton({
  gameId,
  size = "small",
}: WatchReplayButtonProps) {
  const { t } = useLocale();
  const fetcher = useFetcher<{
    ok: boolean;
    gameId?: string;
    error?: string;
  }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) {
      return;
    }
    const data = fetcher.data;
    if (data.ok && data.gameId) {
      navigate(`/replays/${data.gameId}`);
    } else {
      message.error(
        data.error ? `Replay unavailable (${data.error})` : "Replay unavailable"
      );
      setLoading(false);
    }
  }, [fetcher.state, fetcher.data, navigate]);

  return (
    <Tooltip title={t.statistics.bracketWatchReplay}>
      <Button
        type="text"
        size={size}
        icon={loading ? <LoadingOutlined /> : <EyeOutlined />}
        disabled={loading}
        onClick={() => {
          if (loading) {
            return;
          }
          setLoading(true);
          const fd = new FormData();
          fd.set("gameId", gameId);
          fetcher.submit(fd, { method: "post", action: "/review" });
        }}
      />
    </Tooltip>
  );
}
