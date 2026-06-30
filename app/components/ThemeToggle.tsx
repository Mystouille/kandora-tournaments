import React from "react";
import { Button, Tooltip } from "antd";
import { SunOutlined, MoonOutlined } from "@ant-design/icons";
import { useAppTheme } from "../contexts/ThemeContext";
import { useLocale } from "../contexts/LocaleContext";

export function ThemeToggle() {
  const { toggleTheme, isDark, customTokens } = useAppTheme();
  const { buttonTextColor } = customTokens;
  const { t } = useLocale();

  return (
    <Tooltip title={isDark ? t.common.lightMode : t.common.darkMode}>
      <Button
        type="text"
        icon={isDark ? <MoonOutlined /> : <SunOutlined />}
        onClick={toggleTheme}
        style={{
          fontSize: "18px",
          color: buttonTextColor,
        }}
      />
    </Tooltip>
  );
}
