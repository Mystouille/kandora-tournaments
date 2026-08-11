import { useState } from "react";
import { Button, Tooltip } from "antd";
import { EyeOutlined, LoadingOutlined } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router";
import { useLocale } from "../../contexts/LocaleContext";

interface WatchReplayButtonProps {
  gameId: string;
  size?: "small" | "middle" | "large";
}

/**
 * Eye-icon button that navigates to `/watch/replay/:gameId`; the replay
 * loader fetches + persists the log on a cache miss. Shared between the
 * BracketTab stage-details popup and the GamesTab list.
 */
export function WatchReplayButton({
  gameId,
  size = "small",
}: WatchReplayButtonProps) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);

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
          // No `/review` prefetch route in tournaments — the replay
          // loader fetches + persists the log on a cache miss, so go
          // straight to the viewer. `?from=` is the viewer's close
          // fallback so it returns here on a shared / direct link.
          setLoading(true);
          const from = encodeURIComponent(location.pathname + location.search);
          void navigate(
            `/watch/replay/${encodeURIComponent(gameId)}?from=${from}`
          );
        }}
      />
    </Tooltip>
  );
}
