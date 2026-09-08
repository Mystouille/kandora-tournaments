import { Button, Tooltip } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import { useLocation } from "react-router";
import { useLocale } from "../../contexts/LocaleContext";

interface WatchReplayButtonProps {
  gameId: string;
  size?: "small" | "middle" | "large";
}

/**
 * Eye-icon link to `/watch/replay/:gameId`; the replay
 * loader fetches + persists the log on a cache miss. Shared between the
 * BracketTab stage-details popup and the GamesTab list.
 */
export function WatchReplayButton({
  gameId,
  size = "small",
}: WatchReplayButtonProps) {
  const { t } = useLocale();
  const location = useLocation();
  const from = encodeURIComponent(location.pathname + location.search);
  const href = `/watch/replay/${encodeURIComponent(gameId)}?from=${from}`;

  return (
    <Tooltip title={t.statistics.bracketWatchReplay}>
      <Button type="text" size={size} icon={<EyeOutlined />} href={href} />
    </Tooltip>
  );
}
