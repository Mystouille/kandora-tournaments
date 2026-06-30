import React from "react";
import { Button, Tooltip } from "antd";
import { useLocale } from "../contexts/LocaleContext";
import { useAppTheme } from "../contexts/ThemeContext";
import GB from "country-flag-icons/react/3x2/GB";
import FR from "country-flag-icons/react/3x2/FR";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const { customTokens } = useAppTheme();
  const { buttonTextColor } = customTokens;

  const toggleLocale = () => {
    setLocale(locale === "en" ? "fr" : "en");
  };

  const flagStyle = {
    width: 20,
    height: 14,
    borderRadius: 2,
    flexShrink: 0,
  } as const;

  return (
    <Tooltip
      title={locale === "en" ? "Passer en français" : "Switch to English"}
    >
      <Button
        type="text"
        onClick={toggleLocale}
        style={{
          fontSize: "14px",
          fontWeight: 600,
          color: buttonTextColor,
          minWidth: "36px",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        {locale === "en" ? <GB style={flagStyle} /> : <FR style={flagStyle} />}
        {locale === "en" ? "EN" : "FR"}
      </Button>
    </Tooltip>
  );
}
