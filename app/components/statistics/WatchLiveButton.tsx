import { Button, Tooltip } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import { useTelemetry } from "../../contexts/TelemetryContext";

interface WatchLiveButtonProps {
  watchId: string;
  leagueSlug?: string;
  size?: "small" | "middle" | "large";
}

/**
 * Opens the canonical watch-id URL. The route starts or reuses the relay.
 * Sibling of `WatchReplayButton` for finished games.
 */
export function WatchLiveButton({
  watchId,
  leagueSlug,
  size = "small",
}: WatchLiveButtonProps) {
  const { track } = useTelemetry();
  const returnTo = leagueSlug
    ? `/online-tournaments/${encodeURIComponent(leagueSlug)}/statistics`
    : "/";
  const href = `/watch/live/${encodeURIComponent(
    watchId
  )}?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <Tooltip title="Watch live">
      <Button
        type="primary"
        size={size}
        icon={<EyeOutlined />}
        href={href}
        onClick={() => track("spectate_watch_click", { watchId })}
      >
        Live
      </Button>
    </Tooltip>
  );
}
