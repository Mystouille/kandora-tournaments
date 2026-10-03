import { AlignLeftOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useLocation } from "react-router";
import { useLocale } from "~/contexts/LocaleContext";
import { basePath } from "~/utils/basePath";

export function GameSummaryButton({ gameId }: { gameId: string }) {
  const { t } = useLocale();
  const location = useLocation();
  const from = encodeURIComponent(location.pathname + location.search);
  return (
    <Tooltip title={t.gameSummary.title}>
      <Button
        type="text"
        size="small"
        icon={<AlignLeftOutlined />}
        aria-label={t.gameSummary.title}
        href={`${basePath}/games/${encodeURIComponent(gameId)}/summary?from=${from}`}
      />
    </Tooltip>
  );
}
