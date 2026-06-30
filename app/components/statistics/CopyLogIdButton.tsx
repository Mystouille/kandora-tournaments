import { useState } from "react";
import { Button, Tooltip } from "antd";
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { useLocale } from "../../contexts/LocaleContext";

interface CopyLogIdButtonProps {
  gameId: string;
  size?: "small" | "middle" | "large";
}

export function CopyLogIdButton({
  gameId,
  size = "small",
}: CopyLogIdButtonProps) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  return (
    <Tooltip
      title={copied ? t.statistics.gameIdCopied : t.statistics.copyGameId}
    >
      <Button
        size={size}
        type="text"
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        onClick={() => {
          navigator.clipboard.writeText(gameId);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      />
    </Tooltip>
  );
}
